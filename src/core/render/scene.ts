import { routeEdges, type EdgeGeometry } from "../edges/geometry";
import { edgePrims } from "../edges/render";
import { applyMatrix, expand, nodeMatrix, union, type Matrix } from "../geometry/basics";
import { pathBounds, translatePath } from "../geometry/path";
import { nodesInOrder } from "../model/queries";
import type { Color, DashStyle, DiagramDoc, DNode, Id, Rect } from "../model/types";
import { fontOf } from "../shapes/kit";
import { getShape, labelSpec, registryVersion, shapeContext, shapeOutline } from "../shapes/registry";
import type { Prim } from "../shapes/types";
import { layoutText } from "../text/layout";

/**
 * The scene is the single display list every renderer consumes: the React
 * canvas, the SVG serializer, the PDF writer and the PowerPoint writer.
 */
export interface SceneLayer {
  /** Element id this layer belongs to. */
  id: Id;
  kind: "node" | "edge" | "edge-labels";
  /** Local → world transform. Absent for layers already in world space. */
  matrix?: Matrix;
  prims: Prim[];
  opacity: number;
  link?: string;
}

export interface Scene {
  layers: SceneLayer[];
  /** Tight bounds of everything drawn, or null for an empty scene. */
  bounds: Rect | null;
  background: Color;
}

const SHADOW_OFFSET = { x: 3, y: 4 };
const SHADOW_OPACITY = 0.14;

let primCache = new WeakMap<DNode, Prim[]>();
/** Registry state the cache was filled under: an icon pack being added or removed changes what a shape id draws. */
let primCacheVersion = registryVersion();

/** Display list of a node in its local space. Cached per (immutable) node object. */
export function nodePrims(node: DNode): Prim[] {
  if (primCacheVersion !== registryVersion()) {
    primCache = new WeakMap();
    primCacheVersion = registryVersion();
  }
  const cached = primCache.get(node);
  if (cached) return cached;

  const def = getShape(node.shape);
  const ctx = shapeContext(node, def);
  const prims: Prim[] = [];

  // A hard offset shadow renders identically in SVG, PDF and PowerPoint (no blur filters).
  if (ctx.style.shadow) {
    prims.push({
      kind: "path",
      d: translatePath(shapeOutline(node, def), SHADOW_OFFSET.x, SHADOW_OFFSET.y),
      fill: "#000000",
      opacity: SHADOW_OPACITY,
    });
  }
  prims.push(...def.draw(ctx));

  const label = labelSpec(ctx, def);
  if (label && ctx.text.trim()) {
    prims.push({
      kind: "text",
      text: ctx.text,
      box: label.box,
      font: fontOf(ctx.style, label.font),
      color: label.color ?? ctx.style.textColor,
      align: label.align ?? ctx.style.align,
      valign: label.valign ?? ctx.style.valign,
      padding: label.padding,
      wrap: label.wrap,
      underline: ctx.style.underline,
    });
  }
  primCache.set(node, prims);
  return prims;
}

function transformRect(rect: Rect, matrix?: Matrix): Rect {
  if (!matrix) return rect;
  const corners = [
    applyMatrix(matrix, { x: rect.x, y: rect.y }),
    applyMatrix(matrix, { x: rect.x + rect.w, y: rect.y }),
    applyMatrix(matrix, { x: rect.x + rect.w, y: rect.y + rect.h }),
    applyMatrix(matrix, { x: rect.x, y: rect.y + rect.h }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** World-space bounds of a list of primitives, including stroke widths and text. */
export function primsBounds(prims: Prim[], matrix?: Matrix): Rect | null {
  const rects: Rect[] = [];
  for (const prim of prims) {
    if (prim.kind === "path") {
      const bounds = pathBounds(prim.d);
      if (bounds) rects.push(expand(bounds, prim.stroke && prim.stroke !== "none" ? (prim.strokeWidth ?? 1) / 2 : 0));
    } else {
      rects.push(prim.background ? prim.box : layoutText(prim).bounds);
    }
  }
  const local = union(rects);
  return local ? transformRect(local, matrix) : null;
}

export interface SceneOptions {
  /** Restrict the scene to these element ids (export selection / frame). */
  only?: Set<Id>;
  /** Pre-computed edge routes, to avoid routing twice. */
  routes?: Map<Id, EdgeGeometry>;
}

/**
 * Builds the display list for a document.
 *
 * Paint order: containers → connectors → other nodes → connector labels, so
 * lines tuck under the nodes they connect while their labels stay readable.
 * Connectors with a positive `z` are drawn above nodes.
 */
export function buildScene(doc: Pick<DiagramDoc, "nodes" | "edges" | "settings">, options: SceneOptions = {}): Scene {
  const { only } = options;
  const background = doc.settings.background;
  const routes = options.routes ?? routeEdges(doc);

  const containers: SceneLayer[] = [];
  const nodes: SceneLayer[] = [];
  for (const node of nodesInOrder(doc.nodes)) {
    if (only && !only.has(node.id)) continue;
    const def = getShape(node.shape);
    const style = shapeContext(node, def).style;
    const layer: SceneLayer = {
      id: node.id,
      kind: "node",
      matrix: nodeMatrix(node),
      prims: nodePrims(node),
      opacity: style.opacity,
      link: node.link,
    };
    (def.container ? containers : nodes).push(layer);
  }

  const under: SceneLayer[] = [];
  const over: SceneLayer[] = [];
  const labels: SceneLayer[] = [];
  const edges = Object.values(doc.edges).sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : 1));
  for (const edge of edges) {
    if (only && !only.has(edge.id)) continue;
    const geometry = routes.get(edge.id);
    if (!geometry) continue;
    const prims = edgePrims(edge, geometry, background);
    const opacity = edge.style?.opacity ?? 1;
    ((edge.z ?? 0) > 0 ? over : under).push({ id: edge.id, kind: "edge", prims: prims.line, opacity });
    if (prims.labels.length) labels.push({ id: edge.id, kind: "edge-labels", prims: prims.labels, opacity });
  }

  const layers = [...containers, ...under, ...nodes, ...over, ...labels];
  const bounds = union(layers.map((l) => primsBounds(l.prims, l.matrix)).filter((r): r is Rect => r !== null));
  return { layers, bounds, background };
}

/* --------------------------------------------------------- shared styling */

export interface DashSpec {
  array: number[];
  round: boolean;
}

/** Dash pattern for a line of the given weight, shared by every renderer. */
export function dashSpec(dash: DashStyle | undefined, strokeWidth: number): DashSpec | null {
  if (dash === "dashed") return { array: [strokeWidth * 4, strokeWidth * 2.8], round: false };
  if (dash === "dotted") return { array: [0.01, strokeWidth * 2.4], round: true };
  return null;
}

export const isPaint = (color: Color | undefined): color is Color => Boolean(color) && color !== "none";
