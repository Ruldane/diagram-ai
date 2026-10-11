import { edgeKindStyle, isEdgeKind, type EdgeKind } from "../edges/kinds";
import { newId, slugify, isSafeId } from "../model/ids";
import { isPaletteName, normalizeColor, PALETTE, type PaletteName } from "../model/palette";
import { boundsOfNodes, maxZ, minZ } from "../model/queries";
import type {
  Actor,
  Anchor,
  DEdge,
  DiagramDoc,
  DNode,
  EdgeRouting,
  EdgeStyle,
  Id,
  NodeStyle,
  Patch,
} from "../model/types";
import { hasIcon } from "../shapes/icons";
import { fitSize, getShape, resolveShape, suggestShapes } from "../shapes/registry";

/**
 * The "spec" is the friendly, forgiving input format used by AI agents (MCP
 * tools), templates and importers. It is turned into a regular `Patch` here:
 * ids are generated, shapes resolved by name or alias, sizes fitted to the
 * text, colours expanded from palette names.
 */

export type AnchorName = "auto" | "top" | "right" | "bottom" | "left";

export interface NodeSpec {
  id?: string;
  /** Shape id, short name or alias (`decision`, `uml/class`, `postgres`…). */
  shape?: string;
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Id of the container node; `null` detaches on update. */
  parent?: string | null;
  /** Palette name (`blue`, `green`…) setting fill, stroke and text colour. */
  color?: string;
  /** Icon name for icon-based shapes. */
  icon?: string;
  style?: NodeStyle;
  data?: Record<string, unknown>;
  rotation?: number;
  link?: string;
  note?: string;
  locked?: boolean;
}

export interface EdgeSpec {
  id?: string;
  from?: string;
  to?: string;
  text?: string;
  /** Semantic preset: `inheritance`, `one-to-many`, `dashed`… */
  kind?: string;
  routing?: EdgeRouting;
  startText?: string;
  endText?: string;
  /** Palette name or `#rrggbb` for the line. */
  color?: string;
  style?: EdgeStyle;
  fromAnchor?: AnchorName | { x: number; y: number };
  toAnchor?: AnchorName | { x: number; y: number };
  note?: string;
}

export interface ElementsSpec {
  nodes?: NodeSpec[];
  edges?: EdgeSpec[];
}

export interface ApplyOptions {
  actor?: Actor;
  /** Shape used when a node spec has none. */
  defaultShape?: string;
  /** Libraries tried first when a shape name is ambiguous (the diagram type's pinned libraries). */
  preferLibraries?: readonly string[];
  /** Relationship preset for new edges that name no `kind`. */
  defaultEdgeKind?: EdgeKind;
  /**
   * `create` rejects ids that already exist, `update` rejects unknown ids,
   * `upsert` accepts both.
   */
  mode?: "create" | "update" | "upsert";
}

export interface ApplyResult {
  patch: Patch;
  created: { nodes: Id[]; edges: Id[] };
  updated: { nodes: Id[]; edges: Id[] };
  /** New nodes that were given no position and still need a layout pass. */
  unplaced: Id[];
  /** Recoverable problems, phrased so an agent can fix its next call. */
  warnings: string[];
}

const ANCHORS: Record<Exclude<AnchorName, "auto">, { x: number; y: number }> = {
  top: { x: 0.5, y: 0 },
  right: { x: 1, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
};

function toAnchor(value: EdgeSpec["fromAnchor"]): Anchor | undefined {
  if (value === undefined || value === "auto") return undefined;
  return typeof value === "string" ? ANCHORS[value] : value;
}

function colorStyle(color: string | undefined, warnings: string[], subject: string): NodeStyle {
  if (!color) return {};
  if (isPaletteName(color)) {
    const swatch = PALETTE[color as PaletteName];
    return { fill: swatch.fill, stroke: swatch.stroke, textColor: swatch.text };
  }
  const hex = normalizeColor(color);
  if (hex) return { fill: hex };
  warnings.push(`${subject}: unknown color "${color}". Use one of ${Object.keys(PALETTE).join(", ")} or a #rrggbb value.`);
  return {};
}

function edgeColorStyle(color: string | undefined, warnings: string[], subject: string): EdgeStyle {
  if (!color) return {};
  if (isPaletteName(color)) return { stroke: PALETTE[color as PaletteName].stroke };
  const hex = normalizeColor(color);
  if (hex && hex !== "none") return { stroke: hex };
  warnings.push(`${subject}: unknown color "${color}".`);
  return {};
}

function clean<T extends object>(value: T): T {
  const out = {} as T;
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

/** Applies a spec to a document and returns the resulting patch (the doc is not modified). */
export function applySpec(doc: DiagramDoc, spec: ElementsSpec, options: ApplyOptions = {}): ApplyResult {
  const mode = options.mode ?? "upsert";
  const warnings: string[] = [];
  const result: ApplyResult = {
    patch: {},
    created: { nodes: [], edges: [] },
    updated: { nodes: [], edges: [] },
    unplaced: [],
    warnings,
  };

  const taken = new Set<Id>([...Object.keys(doc.nodes), ...Object.keys(doc.edges), ...Object.keys(doc.comments)]);
  const uniqueId = (base: string, kind: "node" | "edge"): Id => {
    if (!base) return newId(kind);
    let candidate = base;
    for (let i = 2; taken.has(candidate); i++) candidate = `${base}-${i}`;
    return candidate;
  };

  const nodes = new Map<Id, DNode>();
  const lookupNode = (id: Id): DNode | undefined => nodes.get(id) ?? doc.nodes[id];
  // Agents refer to nodes by the id or label they sent, which may have been normalised ("Auth Service" → "auth-service").
  const names = new Map<string, Id>();
  const resolveRef = (ref: string): Id => (lookupNode(ref) ? ref : (names.get(ref) ?? ref));
  let nextZ = maxZ(doc.nodes) + 1;
  const containerFloor = minZ(doc.nodes) - 1;

  // Free spot for nodes without coordinates: a row to the right of existing content.
  const existing = boundsOfNodes(Object.values(doc.nodes));
  const cursor = { x: existing ? existing.x + existing.w + 80 : 0, y: existing ? existing.y : 0, rowHeight: 0, count: 0 };
  const startX = cursor.x;

  /* ------------------------------------------------------------- nodes */
  const pendingParents: { id: Id; parent: string }[] = [];

  for (const [index, input] of (spec.nodes ?? []).entries()) {
    const subject = `nodes[${index}]${input.id ? ` "${input.id}"` : ""}`;
    const current = input.id ? lookupNode(input.id) : undefined;

    if (current && mode === "create") {
      warnings.push(`${subject}: id already exists. Use diagram_update_elements to change it, or pick another id.`);
      continue;
    }
    if (!current && mode === "update") {
      warnings.push(`${subject}: no node with this id. Use diagram_read to list ids.`);
      continue;
    }

    let shapeId = current?.shape ?? options.defaultShape ?? "basic/rounded";
    if (input.shape) {
      const def = resolveShape(input.shape, options.preferLibraries);
      if (def) shapeId = def.id;
      else {
        const suggestions = suggestShapes(input.shape);
        warnings.push(
          `${subject}: unknown shape "${input.shape}"${suggestions.length ? ` — did you mean ${suggestions.join(", ")}?` : ""}. Kept "${shapeId}". Use diagram_list_shapes to browse.`,
        );
      }
    }
    const def = getShape(shapeId);

    const data = { ...current?.data, ...input.data };
    if (input.icon) {
      if (hasIcon(input.icon)) data.icon = input.icon;
      else warnings.push(`${subject}: unknown icon "${input.icon}". Use diagram_list_shapes with library "icons" to see icon names.`);
    }

    const style = clean({ ...current?.style, ...colorStyle(input.color, warnings, subject), ...input.style });
    const text = input.text ?? current?.text ?? (current ? undefined : "");

    if (current) {
      const shapeChanged = shapeId !== current.shape;
      const textChanged = input.text !== undefined && input.text !== current.text;
      let { w, h } = current;
      if (input.w === undefined && input.h === undefined && (shapeChanged || textChanged)) {
        const fitted = fitSize({ shape: shapeId, text, style, data }, def);
        w = shapeChanged ? fitted.w : Math.max(w, fitted.w);
        h = shapeChanged ? fitted.h : Math.max(h, fitted.h);
      }
      const next: DNode = clean({
        ...current,
        shape: shapeId,
        text,
        x: input.x ?? current.x,
        y: input.y ?? current.y,
        w: input.w ?? w,
        h: input.h ?? h,
        rotation: input.rotation ?? current.rotation,
        link: input.link ?? current.link,
        note: input.note ?? current.note,
        locked: input.locked ?? current.locked,
        style: Object.keys(style).length ? style : undefined,
        data: Object.keys(data).length ? data : undefined,
      });
      if (input.parent === null) delete next.parent;
      else if (input.parent) pendingParents.push({ id: next.id, parent: input.parent });
      nodes.set(next.id, next);
      if (!result.created.nodes.includes(next.id)) result.updated.nodes.push(next.id);
      continue;
    }

    let id: Id;
    if (input.id) {
      id = isSafeId(input.id) ? input.id : uniqueId(slugify(input.id), "node");
      if (taken.has(id)) id = uniqueId(id, "node");
    } else {
      id = uniqueId(slugify((input.text ?? "").split("\n")[0], 24), "node");
    }
    taken.add(id);
    const label = (input.text ?? "").split("\n")[0].trim();
    if (input.id && input.id !== id) names.set(input.id, id);
    else if (!input.id && label && !names.has(label)) names.set(label, id);

    const fitted = fitSize({ shape: shapeId, text, style, data }, def);
    const w = input.w ?? fitted.w;
    const h = input.h ?? fitted.h;
    const placed = input.x !== undefined && input.y !== undefined;
    let x = input.x ?? 0;
    let y = input.y ?? 0;
    if (!placed) {
      if (cursor.count > 0 && cursor.count % 6 === 0) {
        cursor.x = startX;
        cursor.y += cursor.rowHeight + 60;
        cursor.rowHeight = 0;
      }
      x = cursor.x;
      y = cursor.y;
      cursor.x += w + 60;
      cursor.rowHeight = Math.max(cursor.rowHeight, h);
      cursor.count++;
      result.unplaced.push(id);
    }

    const node: DNode = clean({
      id,
      shape: shapeId,
      x,
      y,
      w,
      h,
      z: def.container ? containerFloor : nextZ++,
      text: text || undefined,
      rotation: input.rotation,
      link: input.link,
      note: input.note,
      locked: input.locked,
      style: Object.keys(style).length ? style : undefined,
      data: Object.keys(data).length ? data : undefined,
      createdBy: options.actor,
    });
    if (input.parent) pendingParents.push({ id, parent: input.parent });
    nodes.set(id, node);
    result.created.nodes.push(id);
  }

  // Parents are resolved after all nodes exist so order inside the spec does not matter.
  for (const { id, parent: reference } of pendingParents) {
    const parent = resolveRef(reference);
    const node = nodes.get(id)!;
    const container = lookupNode(parent);
    if (!container) {
      warnings.push(`Node "${id}": parent "${parent}" does not exist; left at top level.`);
    } else if (!getShape(container.shape).container) {
      warnings.push(`Node "${id}": parent "${parent}" (${container.shape}) is not a container shape; left at top level. Use basic/frame or basic/group.`);
    } else if (parent === id) {
      warnings.push(`Node "${id}" cannot be its own parent.`);
    } else {
      nodes.set(id, { ...node, parent });
    }
  }
  // Nested containers must paint above the container that holds them.
  for (const node of nodes.values()) {
    if (!getShape(node.shape).container || !node.parent) continue;
    const parent = lookupNode(node.parent);
    if (parent && node.z <= parent.z) nodes.set(node.id, { ...node, z: parent.z + 1 });
  }

  /* ------------------------------------------------------------- edges */
  const edges = new Map<Id, DEdge>();

  for (const [index, input] of (spec.edges ?? []).entries()) {
    const subject = `edges[${index}]${input.id ? ` "${input.id}"` : ""}`;
    const current = input.id ? (edges.get(input.id) ?? doc.edges[input.id]) : undefined;

    if (current && mode === "create") {
      warnings.push(`${subject}: id already exists. Use diagram_update_elements to change it.`);
      continue;
    }
    if (!current && (mode === "update" || (!input.from && !input.to))) {
      warnings.push(`${subject}: ${input.id ? "no edge with this id" : "an edge needs `from` and `to` node ids"}.`);
      continue;
    }

    const fromId = input.from !== undefined ? resolveRef(input.from) : current?.from.node;
    const toId = input.to !== undefined ? resolveRef(input.to) : current?.to.node;
    const missing = [fromId, toId].filter((nodeId) => !nodeId || !lookupNode(nodeId));
    if (missing.length) {
      warnings.push(`${subject}: unknown node id ${missing.map((m) => `"${m ?? "(missing)"}"`).join(" and ")}; edge skipped. Node ids are returned when nodes are created.`);
      continue;
    }

    let kindStyle: EdgeStyle = {};
    if (!input.kind && !current && options.defaultEdgeKind && options.defaultEdgeKind !== "flow") {
      kindStyle = edgeKindStyle(options.defaultEdgeKind);
    } else if (input.kind) {
      if (isEdgeKind(input.kind)) kindStyle = edgeKindStyle(input.kind as EdgeKind);
      else warnings.push(`${subject}: unknown kind "${input.kind}". Use diagram_list_shapes with library "edge-kinds" to see valid kinds.`);
    }
    const style = clean({ ...current?.style, ...kindStyle, ...edgeColorStyle(input.color, warnings, subject), ...input.style });

    const endpointsChanged = current && (fromId !== current.from.node || toId !== current.to.node);
    const fromAnchor = toAnchor(input.fromAnchor);
    const toAnchorValue = toAnchor(input.toAnchor);
    const next: DEdge = clean({
      ...current,
      id: current?.id ?? (input.id && isSafeId(input.id) && !taken.has(input.id) ? input.id : uniqueId("", "edge")),
      from: clean({
        node: fromId,
        anchor: input.fromAnchor !== undefined ? fromAnchor : endpointsChanged ? undefined : current?.from.anchor,
      }),
      to: clean({
        node: toId,
        anchor: input.toAnchor !== undefined ? toAnchorValue : endpointsChanged ? undefined : current?.to.anchor,
      }),
      routing: input.routing ?? current?.routing ?? doc.settings.routing,
      text: input.text ?? current?.text,
      startText: input.startText ?? current?.startText,
      endText: input.endText ?? current?.endText,
      note: input.note ?? current?.note,
      style: Object.keys(style).length ? style : undefined,
      createdBy: current?.createdBy ?? options.actor,
    });
    // A route computed for the old endpoints or routing no longer applies.
    if (endpointsChanged || (input.routing && input.routing !== current?.routing)) {
      delete next.waypoints;
      delete next.autoRoute;
    }
    taken.add(next.id);
    edges.set(next.id, next);
    (current ? result.updated.edges : result.created.edges).push(next.id);
  }

  result.patch = {
    ...(nodes.size ? { nodes: { set: [...nodes.values()] } } : {}),
    ...(edges.size ? { edges: { set: [...edges.values()] } } : {}),
  };
  return result;
}
