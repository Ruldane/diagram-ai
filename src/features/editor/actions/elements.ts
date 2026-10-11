import { getDiagramType } from "@/core/catalog";
import { edgeKindStyle, type EdgeKind } from "@/core/edges/kinds";
import { snap, union } from "@/core/geometry/basics";
import { newId } from "@/core/model/ids";
import { removalPatch } from "@/core/model/integrity";
import { descendantsOf, edgesWithin, maxZ, minZ, nodeBounds } from "@/core/model/queries";
import type { DEdge, DiagramDoc, DNode, EdgeStyle, Id, NodeStyle, Patch, Point, Rect } from "@/core/model/types";
import { fitSize, getShape } from "@/core/shapes/registry";

import type { EditorStore } from "../store/editor-store";

/**
 * Document edits triggered by the UI. Each function reads the current state,
 * builds a patch and applies it through the store, so every edit is undoable
 * and synced the same way.
 */

const HUMAN = { kind: "human", id: "browser", name: "You" } as const;

function strip<T extends object>(value: T): T {
  const out = {} as T;
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

export function selectedNodes(doc: DiagramDoc, selection: Id[]): DNode[] {
  return selection.map((id) => doc.nodes[id]).filter(Boolean);
}

export function selectedEdges(doc: DiagramDoc, selection: Id[]): DEdge[] {
  return selection.map((id) => doc.edges[id]).filter(Boolean);
}

/** Shape used for nodes created without an explicit choice. */
export function defaultShape(doc: DiagramDoc): string {
  return getDiagramType(doc.type).defaultShape;
}

/* ---------------------------------------------------------------- create */

export interface NewNodeOptions {
  /** Centre the node on this point (default) or use it as the top-left corner. */
  at: Point;
  topLeft?: boolean;
  size?: { w: number; h: number };
  text?: string;
  /** Start editing the label right away. */
  edit?: boolean;
  select?: boolean;
}

export function createNode(store: EditorStore, shapeId: string, options: NewNodeOptions): DNode | null {
  const { doc } = store.getState();
  if (!doc) return null;
  const def = getShape(shapeId);
  const text = options.text ?? def.text ?? "";
  const size = options.size ?? fitSize({ shape: def.id, text }, def);
  const grid = doc.settings.snap ? doc.settings.gridSize : 0;
  const x = options.topLeft ? options.at.x : options.at.x - size.w / 2;
  const y = options.topLeft ? options.at.y : options.at.y - size.h / 2;
  const node: DNode = strip({
    id: newId("node"),
    shape: def.id,
    x: snap(x, grid),
    y: snap(y, grid),
    w: Math.round(size.w),
    h: Math.round(size.h),
    z: def.container ? minZ(doc.nodes) - 1 : maxZ(doc.nodes) + 1,
    text: text || undefined,
    createdBy: HUMAN,
  });
  store.getState().apply({ nodes: { set: [node] } });
  if (options.select !== false) store.getState().select([node.id]);
  if (options.edit) store.setState({ editing: node.id });
  return node;
}

export function newEdge(doc: DiagramDoc, from: DEdge["from"], to: DEdge["to"]): DEdge {
  const kind = getDiagramType(doc.type).edgeKind;
  const style = edgeKindStyle(kind);
  const isDefault = style.startMarker === "none" && style.endMarker === "arrow" && style.dash === "solid";
  return strip({
    id: newId("edge"),
    from,
    to,
    routing: doc.settings.routing,
    style: isDefault ? undefined : style,
    createdBy: HUMAN,
  });
}

export function createEdge(store: EditorStore, from: Id, to: Id): DEdge | null {
  const { doc } = store.getState();
  if (!doc || !doc.nodes[from] || !doc.nodes[to]) return null;
  const edge = newEdge(doc, { node: from }, { node: to });
  store.getState().apply({ edges: { set: [edge] } });
  store.getState().select([edge.id]);
  return edge;
}

const FOLLOWED_BY_DEFAULT = new Set(["flowchart/terminator", "flowchart/decision"]);
const DIRECTIONS = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
export type Direction = keyof typeof DIRECTIONS;

/**
 * Quick-connect: adds a node of the same kind next to `sourceId`, connects
 * them and starts editing the new label. The fastest way to grow a flow.
 */
export function addConnectedNode(store: EditorStore, sourceId: Id, direction: Direction): void {
  const { doc } = store.getState();
  const source = doc?.nodes[sourceId];
  if (!doc || !source) return;
  const sourceDef = getShape(source.shape);
  // Containers, markers, start/end and decisions are usually followed by a regular step.
  const followWithDefault = sourceDef.container || sourceDef.keepAspect || FOLLOWED_BY_DEFAULT.has(source.shape);
  const shapeId = followWithDefault ? defaultShape(doc) : source.shape;
  const def = getShape(shapeId);
  const size = shapeId === source.shape ? { w: source.w, h: source.h } : def.size;
  const d = DIRECTIONS[direction];
  const gap = doc.settings.layout.rankSpacing ?? 72;
  const box = nodeBounds(source);
  let x = box.x + box.w / 2 - size.w / 2 + d.x * (box.w / 2 + size.w / 2 + gap);
  let y = box.y + box.h / 2 - size.h / 2 + d.y * (box.h / 2 + size.h / 2 + gap);

  // Slide sideways until the spot does not overlap an existing node.
  const others = Object.values(doc.nodes).filter((n) => !getShape(n.shape).container).map(nodeBounds);
  const overlaps = (r: Rect) => others.some((o) => r.x < o.x + o.w + 10 && r.x + r.w + 10 > o.x && r.y < o.y + o.h + 10 && r.y + r.h + 10 > o.y);
  const step = d.x !== 0 ? size.h + 24 : size.w + 24;
  for (let i = 0; i < 12 && overlaps({ x, y, w: size.w, h: size.h }); i++) {
    if (d.x !== 0) y += step;
    else x += step;
  }

  const node: DNode = strip({
    id: newId("node"),
    shape: shapeId,
    x: Math.round(x),
    y: Math.round(y),
    w: size.w,
    h: size.h,
    z: maxZ(doc.nodes) + 1,
    parent: source.parent,
    style: shapeId === source.shape ? source.style : undefined,
    data: shapeId === source.shape ? source.data : undefined,
    createdBy: HUMAN,
  });
  const edge = newEdge(doc, { node: source.id }, { node: node.id });
  store.getState().apply({ nodes: { set: [node] }, edges: { set: [edge] } });
  store.getState().select([node.id]);
  store.setState({ editing: node.id });
}

/* ---------------------------------------------------------------- remove */

export function deleteSelection(store: EditorStore): void {
  const { doc, selection } = store.getState();
  if (!doc || !selection.length) return;
  const deletable = selection.filter((id) => !doc.nodes[id]?.locked);
  if (deletable.length) store.getState().apply(removalPatch(doc, deletable));
}

/* ------------------------------------------------------------- duplicate */

/** Copies nodes (with their children) and the connectors between them under fresh ids. */
export function cloneElements(doc: DiagramDoc, ids: Id[], offset: Point, zStart: number): { nodes: DNode[]; edges: DEdge[]; map: Map<Id, Id> } {
  const roots = ids.filter((id) => doc.nodes[id]);
  const all = new Map<Id, DNode>();
  for (const id of roots) all.set(id, doc.nodes[id]);
  for (const child of descendantsOf(doc.nodes, roots)) all.set(child.id, child);

  const map = new Map<Id, Id>();
  for (const id of all.keys()) map.set(id, newId("node"));
  let z = zStart;
  const nodes = [...all.values()]
    .sort((a, b) => a.z - b.z)
    .map((node) => {
      const copy: DNode = { ...node, id: map.get(node.id)!, x: node.x + offset.x, y: node.y + offset.y, z: getShape(node.shape).container ? node.z : ++z };
      if (node.parent && map.has(node.parent)) copy.parent = map.get(node.parent);
      return copy;
    });

  const edges = edgesWithin(doc.edges, new Set(all.keys())).map((edge) => ({
    ...edge,
    id: newId("edge"),
    from: { ...edge.from, node: map.get(edge.from.node!) },
    to: { ...edge.to, node: map.get(edge.to.node!) },
    waypoints: edge.waypoints?.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
  }));
  return { nodes, edges: edges.map(strip), map };
}

export function duplicateSelection(store: EditorStore, offset: Point = { x: 30, y: 30 }): void {
  const { doc, selection } = store.getState();
  if (!doc || !selection.length) return;
  const { nodes, edges, map } = cloneElements(doc, selection, offset, maxZ(doc.nodes));
  if (!nodes.length) return;
  store.getState().apply({ nodes: { set: nodes }, edges: { set: edges } });
  store.getState().select(selection.filter((id) => map.has(id)).map((id) => map.get(id)!));
}

/* ---------------------------------------------------------------- update */

export function updateNodes(store: EditorStore, ids: Id[], change: (node: DNode) => DNode): void {
  const { doc } = store.getState();
  if (!doc) return;
  const set = ids.map((id) => doc.nodes[id]).filter(Boolean).map(change);
  if (set.length) store.getState().apply({ nodes: { set } });
}

export function updateEdges(store: EditorStore, ids: Id[], change: (edge: DEdge) => DEdge): void {
  const { doc } = store.getState();
  if (!doc) return;
  const set = ids.map((id) => doc.edges[id]).filter(Boolean).map(change);
  if (set.length) store.getState().apply({ edges: { set } });
}

export function styleNodes(store: EditorStore, ids: Id[], style: NodeStyle): void {
  updateNodes(store, ids, (node) => ({ ...node, style: strip({ ...node.style, ...style }) }));
}

export function styleEdges(store: EditorStore, ids: Id[], style: EdgeStyle): void {
  updateEdges(store, ids, (edge) => ({ ...edge, style: strip({ ...edge.style, ...style }) }));
}

export function setEdgeKind(store: EditorStore, ids: Id[], kind: EdgeKind): void {
  styleEdges(store, ids, edgeKindStyle(kind));
}

/** Applies a style to whatever is selected, splitting node and edge fields. */
export function styleSelection(store: EditorStore, style: NodeStyle & EdgeStyle): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  const nodes = selection.filter((id) => doc.nodes[id]).map((id) => doc.nodes[id]);
  const edges = selection.filter((id) => doc.edges[id]).map((id) => doc.edges[id]);
  const { startMarker, endMarker, animated, fill, radius, shadow, ...shared } = style;
  const patch: Patch = {};
  if (nodes.length) patch.nodes = { set: nodes.map((n) => ({ ...n, style: strip({ ...n.style, ...shared, fill, radius, shadow }) })) };
  if (edges.length) patch.edges = { set: edges.map((e) => ({ ...e, style: strip({ ...e.style, ...shared, startMarker, endMarker, animated }) })) };
  store.getState().apply(patch);
}

/** Commits an edited label, growing the node if the text no longer fits. */
export function commitText(store: EditorStore, id: Id, text: string): void {
  const { doc } = store.getState();
  if (!doc) return;
  const node = doc.nodes[id];
  if (node) {
    if ((node.text ?? "") === text) return;
    const next: DNode = { ...node, text: text || undefined };
    const def = getShape(node.shape);
    if (!def.container && !def.keepAspect) {
      const fitted = fitSize(next, def);
      // Grow only: never shrink something the user sized by hand.
      const grewW = Math.max(node.w, fitted.w);
      const grewH = Math.max(node.h, fitted.h);
      next.x = node.x - (grewW - node.w) / 2;
      next.w = grewW;
      next.h = grewH;
    }
    store.getState().apply({ nodes: { set: [strip(next)] } });
    return;
  }
  const edge = doc.edges[id];
  if (edge && (edge.text ?? "") !== text) store.getState().apply({ edges: { set: [strip({ ...edge, text: text || undefined })] } });
}

export function changeShape(store: EditorStore, ids: Id[], shapeId: string): void {
  const def = getShape(shapeId);
  updateNodes(store, ids, (node) => {
    const next = { ...node, shape: def.id };
    delete next.data;
    if (def.keepAspect) next.h = next.w = Math.max(node.w, node.h);
    return next;
  });
}

export function nudgeSelection(store: EditorStore, dx: number, dy: number): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  const roots = selection.filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
  if (!roots.length) return;
  const moving = new Map<Id, DNode>();
  for (const id of roots) moving.set(id, doc.nodes[id]);
  for (const child of descendantsOf(doc.nodes, roots)) moving.set(child.id, child);
  const ids = new Set(moving.keys());
  const edges: DEdge[] = [];
  for (const edge of Object.values(doc.edges)) {
    const from = Boolean(edge.from.node && ids.has(edge.from.node));
    const to = Boolean(edge.to.node && ids.has(edge.to.node));
    if (from && to && edge.waypoints?.length) {
      // The whole connector moves: carry its bend points along.
      edges.push({ ...edge, waypoints: edge.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
    } else if ((from || to) && edge.autoRoute) {
      // One end moves: a layout-computed route no longer fits, let it re-route.
      const released: DEdge = { ...edge, from: { node: edge.from.node }, to: { node: edge.to.node } };
      delete released.waypoints;
      delete released.autoRoute;
      edges.push(released);
    }
  }
  store.getState().apply({
    nodes: { set: [...moving.values()].map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) },
    ...(edges.length ? { edges: { set: edges } } : {}),
    doc: { settings: { autoLayout: false } },
  });
}

/* --------------------------------------------------------------- arrange */

export function reorder(store: EditorStore, where: "front" | "back"): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  let z = where === "front" ? maxZ(doc.nodes) : minZ(doc.nodes);
  updateNodes(store, selection, (node) => ({ ...node, z: where === "front" ? ++z : --z }));
  updateEdges(store, selection, (edge) => ({ ...edge, z: where === "front" ? 1 : 0 }));
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

export function alignSelection(store: EditorStore, alignment: Alignment): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  const nodes = selectedNodes(doc, selection).filter((n) => !n.locked);
  const bounds = union(nodes.map(nodeBounds));
  if (nodes.length < 2 || !bounds) return;
  const moved = nodes.map((node) => {
    const box = nodeBounds(node);
    let dx = 0;
    let dy = 0;
    if (alignment === "left") dx = bounds.x - box.x;
    else if (alignment === "right") dx = bounds.x + bounds.w - (box.x + box.w);
    else if (alignment === "center") dx = bounds.x + bounds.w / 2 - (box.x + box.w / 2);
    else if (alignment === "top") dy = bounds.y - box.y;
    else if (alignment === "bottom") dy = bounds.y + bounds.h - (box.y + box.h);
    else dy = bounds.y + bounds.h / 2 - (box.y + box.h / 2);
    return { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) };
  });
  store.getState().apply({ nodes: { set: moved }, doc: { settings: { autoLayout: false } } });
}

export function distributeSelection(store: EditorStore, axis: "horizontal" | "vertical"): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  const nodes = selectedNodes(doc, selection).filter((n) => !n.locked);
  if (nodes.length < 3) return;
  const horizontal = axis === "horizontal";
  const sorted = [...nodes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const total = sorted.reduce((sum, n) => sum + (horizontal ? n.w : n.h), 0);
  const span = horizontal ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (sorted.length - 1);
  let cursor = horizontal ? first.x : first.y;
  const moved = sorted.map((node) => {
    const next = horizontal ? { ...node, x: Math.round(cursor) } : { ...node, y: Math.round(cursor) };
    cursor += (horizontal ? node.w : node.h) + gap;
    return next;
  });
  store.getState().apply({ nodes: { set: moved }, doc: { settings: { autoLayout: false } } });
}

/** Wraps the selected nodes in a new frame. */
export function frameSelection(store: EditorStore): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  const nodes = selectedNodes(doc, selection);
  const bounds = union(nodes.map(nodeBounds));
  if (!nodes.length || !bounds) return;
  const def = getShape("basic/frame");
  const frame: DNode = {
    id: newId("node"),
    shape: def.id,
    x: Math.round(bounds.x - 24),
    y: Math.round(bounds.y - 56),
    w: Math.round(bounds.w + 48),
    h: Math.round(bounds.h + 80),
    z: minZ(doc.nodes) - 1,
    text: "Frame",
    createdBy: HUMAN,
  };
  const selected = new Set(selection);
  const children = nodes.filter((n) => !n.parent || !selected.has(n.parent)).map((n) => ({ ...n, parent: frame.id }));
  store.getState().apply({ nodes: { set: [frame, ...children] } });
  store.getState().select([frame.id]);
  store.setState({ editing: frame.id });
}

export function toggleLock(store: EditorStore): void {
  const { doc, selection } = store.getState();
  if (!doc) return;
  const nodes = selectedNodes(doc, selection);
  const lock = !nodes.every((n) => n.locked);
  updateNodes(store, selection, (node) => strip({ ...node, locked: lock || undefined }));
}

export function selectAll(store: EditorStore): void {
  const { doc } = store.getState();
  if (doc) store.getState().select([...Object.keys(doc.nodes), ...Object.keys(doc.edges)]);
}
