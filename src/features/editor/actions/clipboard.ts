import { union } from "@/core/geometry/basics";
import { removalPatch } from "@/core/model/integrity";
import { descendantsOf, edgesWithin, maxZ, nodeBounds } from "@/core/model/queries";
import { edgeSchema, nodeSchema } from "@/core/model/schema";
import type { DEdge, DiagramDoc, DNode, Id, Point } from "@/core/model/types";

import type { EditorStore } from "../store/editor-store";
import { cloneElements, createNode } from "./elements";

const MARKER = "diagram-ai/clipboard";

interface ClipboardPayload {
  type: typeof MARKER;
  nodes: DNode[];
  edges: DEdge[];
}

/** Serialises the selection (with children and the connectors between them). */
export function copyPayload(doc: DiagramDoc, selection: Id[]): string | null {
  const roots = selection.filter((id) => doc.nodes[id]);
  if (!roots.length) return null;
  const nodes = new Map<Id, DNode>();
  for (const id of roots) nodes.set(id, doc.nodes[id]);
  for (const child of descendantsOf(doc.nodes, roots)) nodes.set(child.id, child);
  const payload: ClipboardPayload = { type: MARKER, nodes: [...nodes.values()], edges: edgesWithin(doc.edges, new Set(nodes.keys())) };
  return JSON.stringify(payload);
}

function parsePayload(text: string): ClipboardPayload | null {
  if (!text.includes(MARKER)) return null;
  try {
    const raw = JSON.parse(text) as { type?: unknown; nodes?: unknown; edges?: unknown };
    if (raw.type !== MARKER) return null;
    // Clipboard content is untrusted input: validate it like any other.
    const nodes = nodeSchema.array().max(2000).parse(raw.nodes) as DNode[];
    const edges = edgeSchema.array().max(4000).parse(raw.edges) as DEdge[];
    return { type: MARKER, nodes, edges };
  } catch {
    return null;
  }
}

/**
 * Pastes clipboard text: diagram elements are re-created under fresh ids
 * centred on `at`; any other text becomes a text node.
 */
export function pasteText(store: EditorStore, text: string, at: Point): void {
  const { doc } = store.getState();
  if (!doc || !text.trim()) return;
  const payload = parsePayload(text);
  if (!payload) {
    createNode(store, "basic/text", { at, text: text.trim().slice(0, 4000) });
    return;
  }
  const bounds = union(payload.nodes.map(nodeBounds));
  if (!bounds) return;
  // Build a scratch document so the cloning helper can be reused as is.
  const scratch: DiagramDoc = {
    ...doc,
    nodes: Object.fromEntries(payload.nodes.map((n) => [n.id, n])),
    edges: Object.fromEntries(payload.edges.map((e) => [e.id, e])),
  };
  const offset = { x: Math.round(at.x - (bounds.x + bounds.w / 2)), y: Math.round(at.y - (bounds.y + bounds.h / 2)) };
  const roots = payload.nodes.filter((n) => !n.parent || !scratch.nodes[n.parent]).map((n) => n.id);
  const { nodes, edges, map } = cloneElements(scratch, roots, offset, maxZ(doc.nodes));
  // Parents that were not copied do not exist here.
  const cleaned = nodes.map((node) => {
    if (!node.parent || doc.nodes[node.parent] || nodes.some((n) => n.id === node.parent)) return node;
    const free = { ...node };
    delete free.parent;
    return free;
  });
  store.getState().apply({ nodes: { set: cleaned }, edges: { set: edges } });
  store.getState().select(roots.map((id) => map.get(id)!).filter(Boolean));
}

export function cutPayload(store: EditorStore): string | null {
  const { doc, selection } = store.getState();
  if (!doc) return null;
  const payload = copyPayload(doc, selection);
  if (payload) store.getState().apply(removalPatch(doc, selection.filter((id) => !doc.nodes[id]?.locked)));
  return payload;
}
