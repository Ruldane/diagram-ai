import { mergePatches } from "./patch";
import { descendantsOf } from "./queries";
import type { DComment, DEdge, DiagramDoc, DNode, Id, Patch } from "./types";

/**
 * Extends a patch so the document stays consistent once it is applied:
 * removing a node also removes the connectors attached to it, releases its
 * children and unpins its comments. Used by the editor (so undo restores
 * everything in one step) and by the server (as the last line of defence).
 */
export function withIntegrity(doc: DiagramDoc, patch: Patch): Patch {
  const removedNodes = new Set(patch.nodes?.remove ?? []);
  const removedEdges = new Set(patch.edges?.remove ?? []);
  const removed = new Set<Id>([...removedNodes, ...removedEdges]);
  if (removed.size === 0) return patch;

  const settingNodes = new Map((patch.nodes?.set ?? []).map((n) => [n.id, n]));
  const settingEdges = new Map((patch.edges?.set ?? []).map((e) => [e.id, e]));
  const settingComments = new Map((patch.comments?.set ?? []).map((c) => [c.id, c]));
  const extra: Patch = {};

  if (removedNodes.size) {
    const dangling: Id[] = [];
    for (const stored of Object.values(doc.edges)) {
      if (removedEdges.has(stored.id)) continue;
      const edge: DEdge = settingEdges.get(stored.id) ?? stored;
      if ((edge.from.node && removedNodes.has(edge.from.node)) || (edge.to.node && removedNodes.has(edge.to.node))) {
        dangling.push(edge.id);
        removed.add(edge.id);
      }
    }
    if (dangling.length) extra.edges = { remove: dangling };

    const orphans: DNode[] = [];
    for (const stored of Object.values(doc.nodes)) {
      if (removedNodes.has(stored.id)) continue;
      const node = settingNodes.get(stored.id) ?? stored;
      if (node.parent && removedNodes.has(node.parent)) {
        const released = { ...node };
        delete released.parent;
        orphans.push(released);
      }
    }
    if (orphans.length) extra.nodes = { set: orphans };
  }

  const unpinned: DComment[] = [];
  for (const stored of Object.values(doc.comments)) {
    const comment = settingComments.get(stored.id) ?? stored;
    if (comment.target && removed.has(comment.target) && !patch.comments?.remove?.includes(comment.id)) {
      const free = { ...comment };
      delete free.target;
      unpinned.push(free);
    }
  }
  if (unpinned.length) extra.comments = { set: unpinned };

  return extra.nodes || extra.edges || extra.comments ? mergePatches(patch, extra) : patch;
}

/** Patch that deletes the given elements; `cascade` also deletes everything inside removed containers. */
export function removalPatch(doc: DiagramDoc, ids: Iterable<Id>, cascade = true): Patch {
  const nodes = new Set<Id>();
  const edges = new Set<Id>();
  const comments = new Set<Id>();
  for (const id of ids) {
    if (id in doc.nodes) nodes.add(id);
    else if (id in doc.edges) edges.add(id);
    else if (id in doc.comments) comments.add(id);
  }
  if (cascade) for (const child of descendantsOf(doc.nodes, nodes)) nodes.add(child.id);
  return withIntegrity(doc, {
    ...(nodes.size ? { nodes: { remove: [...nodes] } } : {}),
    ...(edges.size ? { edges: { remove: [...edges] } } : {}),
    ...(comments.size ? { comments: { remove: [...comments] } } : {}),
  });
}
