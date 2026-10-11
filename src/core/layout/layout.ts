import { clamp } from "../geometry/basics";
import { boundsOfNodes, nodeLabel } from "../model/queries";
import type { DEdge, DiagramDoc, DNode, Id, LayoutOptions, Patch, Point } from "../model/types";
import { containerInsets, getShape, isContainer } from "../shapes/registry";
import { measureBlock } from "../text/layout";

/** The slice of the ELK API this module needs (keeps `elkjs` out of the core's types). */
export interface ElkLike {
  layout(graph: ElkGraphNode): Promise<ElkGraphNode>;
}

interface ElkPoint {
  x: number;
  y: number;
}

interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: { text: string; width: number; height: number }[];
  sections?: { startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[] }[];
}

interface ElkGraphNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkGraphNode[];
  edges?: ElkGraphEdge[];
  layoutOptions?: Record<string, string>;
}

/** Id of the synthetic top-level graph. Contains a character node ids cannot have, so it never collides with one. */
const ROOT = "$root";

/** An ELK end point within this many px of a node border is on that border. */
const BORDER_SNAP = 1.5;

const DIRECTION = { down: "DOWN", right: "RIGHT", up: "UP", left: "LEFT" } as const;

function rootOptions(options: LayoutOptions): Record<string, string> {
  const spacing = String(options.spacing ?? 48);
  const rank = String(options.rankSpacing ?? 72);
  const common = {
    "elk.direction": DIRECTION[options.direction],
    "elk.spacing.nodeNode": spacing,
    "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    "org.eclipse.elk.json.shapeCoords": "ROOT",
    "org.eclipse.elk.json.edgeCoords": "ROOT",
  };
  switch (options.algorithm) {
    case "tree":
      return { ...common, "elk.algorithm": "mrtree", "elk.mrtree.spacing.nodeNode": spacing, "elk.spacing.edgeNode": rank };
    case "force":
      return { ...common, "elk.algorithm": "stress", "elk.stress.desiredEdgeLength": String(Number(rank) * 2) };
    case "radial":
      return { ...common, "elk.algorithm": "radial", "elk.radial.radius": String(Number(rank) * 2) };
    default:
      return {
        ...common,
        "elk.algorithm": "layered",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": rank,
        "elk.layered.spacing.edgeNodeBetweenLayers": "24",
        "elk.spacing.edgeNode": "24",
        "elk.spacing.edgeEdge": "14",
        "elk.spacing.edgeLabel": "6",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
        "elk.separateConnectedComponents": "true",
        "elk.spacing.componentComponent": String(Number(spacing) * 1.5),
      };
  }
}

/** Spacing options that must be set on each nested graph of a layered layout. */
function spacingOptions(options: LayoutOptions): Record<string, string> {
  return {
    "elk.spacing.nodeNode": String(options.spacing ?? 48),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(options.rankSpacing ?? 72),
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.spacing.edgeNode": "24",
    "elk.spacing.edgeEdge": "14",
    "elk.spacing.edgeLabel": "6",
  };
}

/** Simple deterministic grid, used for `grid` and as a fallback. */
function gridPositions(nodes: DNode[], spacing: number): Map<Id, Point> {
  const out = new Map<Id, Point>();
  if (!nodes.length) return out;
  const columns = Math.ceil(Math.sqrt(nodes.length));
  const cellW = Math.max(...nodes.map((n) => n.w)) + spacing;
  let y = 0;
  for (let row = 0; row * columns < nodes.length; row++) {
    const slice = nodes.slice(row * columns, (row + 1) * columns);
    slice.forEach((node, column) => out.set(node.id, { x: column * cellW + (cellW - spacing - node.w) / 2, y }));
    y += Math.max(...slice.map((n) => n.h)) + spacing;
  }
  return out;
}

export interface LayoutScope {
  /** Lay out only these nodes (and edges between them). Defaults to everything. */
  ids?: Set<Id>;
}

/**
 * Computes an automatic layout and returns it as a patch (positions, container
 * sizes and connector routes). The document itself is not modified.
 */
export async function computeLayout(
  doc: Pick<DiagramDoc, "nodes" | "edges" | "settings">,
  options: LayoutOptions,
  elk: ElkLike,
  scope: LayoutScope = {},
): Promise<Patch> {
  const included = Object.values(doc.nodes).filter((node) => !scope.ids || scope.ids.has(node.id));
  if (included.length === 0) return {};
  const ids = new Set(included.map((n) => n.id));
  const before = boundsOfNodes(included);
  const origin = scope.ids && before ? { x: before.x, y: before.y } : { x: 0, y: 0 };

  const positions = new Map<Id, { x: number; y: number; w: number; h: number }>();
  const routes = new Map<Id, { start: ElkPoint; end: ElkPoint; bends: ElkPoint[] }>();
  const edges = Object.values(doc.edges).filter(
    (e) => e.from.node && e.to.node && e.from.node !== e.to.node && ids.has(e.from.node) && ids.has(e.to.node),
  );

  if (options.algorithm === "grid") {
    const top = included.filter((n) => !n.parent || !ids.has(n.parent));
    for (const [id, p] of gridPositions(top, options.spacing ?? 48)) {
      const node = doc.nodes[id];
      positions.set(id, { x: p.x, y: p.y, w: node.w, h: node.h });
    }
  } else {
    const hierarchical = options.algorithm === "layered";
    const childrenOf = new Map<Id, DNode[]>();
    for (const node of included) {
      const parent = hierarchical && node.parent && ids.has(node.parent) && isContainer(doc.nodes[node.parent]) ? node.parent : ROOT;
      const list = childrenOf.get(parent);
      if (list) list.push(node);
      else childrenOf.set(parent, [node]);
    }
    // Stable input order keeps layouts deterministic between runs.
    const ordered = (list: DNode[]) => [...list].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));

    const toElk = (node: DNode): ElkGraphNode => {
      const children = childrenOf.get(node.id);
      if (!children?.length) return { id: node.id, width: node.w, height: node.h };
      const { header, padding } = containerInsets(getShape(node.shape));
      return {
        id: node.id,
        children: ordered(children).map(toElk),
        layoutOptions: {
          // Spacing is not inherited by nested graphs, so repeat it on every container.
          ...spacingOptions(options),
          "elk.padding": `[top=${header + padding},left=${padding},bottom=${padding},right=${padding}]`,
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.nodeSize.minimum": `(${Math.min(node.w, 160)},${Math.min(node.h, 80)})`,
        },
      };
    };

    const graph: ElkGraphNode = {
      id: ROOT,
      layoutOptions: rootOptions(options),
      children: ordered(childrenOf.get(ROOT) ?? []).map(toElk),
      edges: edges.map((edge) => {
        const label = edge.text?.trim();
        const size = label ? measureBlock(label, { family: "sans", size: edge.style?.fontSize ?? 12 }, 180) : null;
        return {
          id: edge.id,
          sources: [edge.from.node!],
          targets: [edge.to.node!],
          ...(size ? { labels: [{ text: label!, width: size.w + 12, height: size.h + 6 }] } : {}),
        };
      }),
    };

    let result: ElkGraphNode;
    try {
      result = await elk.layout(graph);
    } catch (error) {
      const names = included.slice(0, 3).map(nodeLabel).join(", ");
      throw new Error(`Layout failed for ${included.length} nodes (${names}…): ${error instanceof Error ? error.message : String(error)}`);
    }

    const collect = (node: ElkGraphNode) => {
      for (const child of node.children ?? []) {
        const source = doc.nodes[child.id];
        positions.set(child.id, {
          x: child.x ?? 0,
          y: child.y ?? 0,
          w: child.children?.length ? (child.width ?? source.w) : source.w,
          h: child.children?.length ? (child.height ?? source.h) : source.h,
        });
        collect(child);
      }
      for (const edge of node.edges ?? []) {
        const section = edge.sections?.[0];
        if (section) routes.set(edge.id, { start: section.startPoint, end: section.endPoint, bends: section.bendPoints ?? [] });
      }
    };
    collect(result);
  }

  // Anchor the result: keep a partial layout where it was, start full layouts at the origin.
  let minX = Infinity;
  let minY = Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  const dx = Math.round(origin.x - minX);
  const dy = Math.round(origin.y - minY);

  const movedNodes: DNode[] = [];
  const placed = new Map<Id, DNode>();
  for (const node of included) {
    const p = positions.get(node.id);
    if (!p) continue;
    const next: DNode = { ...node, x: Math.round(p.x + dx), y: Math.round(p.y + dy), w: Math.round(p.w), h: Math.round(p.h) };
    placed.set(node.id, next);
    if (next.x !== node.x || next.y !== node.y || next.w !== node.w || next.h !== node.h) movedNodes.push(next);
  }
  // Children of containers that were not laid out hierarchically follow their parent.
  for (const node of included) {
    if (placed.has(node.id) || !node.parent) continue;
    const parentBefore = doc.nodes[node.parent];
    const parentAfter = placed.get(node.parent);
    if (!parentBefore || !parentAfter) continue;
    const next = { ...node, x: node.x + parentAfter.x - parentBefore.x, y: node.y + parentAfter.y - parentBefore.y };
    placed.set(node.id, next);
    movedNodes.push(next);
  }

  const useRoutes = options.algorithm === "layered";
  const updatedEdges: DEdge[] = [];
  for (const edge of edges) {
    const route = useRoutes && edge.routing === "orthogonal" ? routes.get(edge.id) : undefined;
    const from = placed.get(edge.from.node!);
    const to = placed.get(edge.to.node!);
    let next: DEdge;
    if (route && from && to) {
      // ELK works in fractions of a pixel while node boxes are rounded: an end point that sits on a
      // border must stay exactly on it, or it would be treated as an anchor inside the shape.
      const fraction = (offset: number, size: number): number => {
        if (Math.abs(offset) <= BORDER_SNAP) return 0;
        if (Math.abs(offset - size) <= BORDER_SNAP) return 1;
        return clamp(offset / size, 0, 1);
      };
      const anchor = (p: ElkPoint, node: DNode): Point => ({
        x: fraction(p.x + dx - node.x, node.w),
        y: fraction(p.y + dy - node.y, node.h),
      });
      next = {
        ...edge,
        from: { node: from.id, anchor: anchor(route.start, from) },
        to: { node: to.id, anchor: anchor(route.end, to) },
        waypoints: route.bends.map((b) => ({ x: Math.round(b.x + dx), y: Math.round(b.y + dy) })),
        autoRoute: true,
      };
      if (!next.waypoints!.length) delete next.waypoints;
    } else {
      // No route from this layout: drop one computed by an earlier layout, keep anchors the author chose.
      if (!edge.autoRoute) continue;
      next = { ...edge, from: { node: edge.from.node }, to: { node: edge.to.node } };
      delete next.waypoints;
      delete next.autoRoute;
    }
    updatedEdges.push(next);
  }

  return {
    ...(movedNodes.length ? { nodes: { set: movedNodes } } : {}),
    ...(updatedEdges.length ? { edges: { set: updatedEdges } } : {}),
    doc: { settings: { layout: options, autoLayout: true } },
  };
}
