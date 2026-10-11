import { withIntegrity } from "../model/integrity";
import type { DComment, DEdge, DiagramDoc, DNode, Id, Patch } from "../model/types";
import { diffForReview, type ReviewContent, type ReviewDiff } from "./diff";

/**
 * The patch that puts the given elements back the way they were in `base`.
 *
 * "Back the way they were" has to stay a valid diagram, so the patch carries
 * whatever the restored elements need and drops whatever depends on elements
 * that go away:
 *
 *  - an added node is removed, together with the connectors attached to it
 *    (a connector that existed in `base` is re-attached to its old ends instead);
 *  - a removed node is restored with its removed connectors, and with any
 *    removed container it sits in, first;
 *  - a changed connector gets back the nodes it was attached to;
 *  - a comment gets back the element it was pinned to.
 *
 * Elements the person edited after the agent are reverted too: that is what
 * rejecting means. Ids that are not part of the difference are ignored.
 */
export function revertPatch(base: ReviewContent, current: DiagramDoc, ids: Iterable<Id>, diff: ReviewDiff = diffForReview(base, current)): Patch {
  const wanted = new Set(ids);

  const restoreNodes = new Map<Id, DNode>();
  const restoreEdges = new Map<Id, DEdge>();
  const restoreComments = new Map<Id, DComment>();
  const removeNodes = new Set<Id>();
  const removeEdges = new Set<Id>();
  const removeComments = new Set<Id>();

  for (const change of diff.changes) {
    if (!wanted.has(change.id)) continue;
    const { id, element, kind } = change;
    if (kind === "added") {
      (element === "node" ? removeNodes : element === "edge" ? removeEdges : removeComments).add(id);
    } else if (element === "node") {
      restoreNodes.set(id, base.nodes[id]);
    } else if (element === "edge") {
      restoreEdges.set(id, base.edges[id]);
    } else {
      restoreComments.set(id, base.comments[id]);
    }
  }

  const nodeWillExist = (id: Id): boolean => (id in current.nodes && !removeNodes.has(id)) || restoreNodes.has(id);
  const edgeWillExist = (id: Id): boolean => (id in current.edges && !removeEdges.has(id)) || restoreEdges.has(id);

  /** Brings a node (and what it hangs from) back from `base`; false when `base` never had it. */
  function needNode(id: Id): boolean {
    if (nodeWillExist(id)) return true;
    const original = base.nodes[id];
    if (!original) return false;
    restoreNodes.set(id, original);
    return true;
  }

  function needEdge(id: Id): boolean {
    if (edgeWillExist(id)) return true;
    const original = base.edges[id];
    if (!original) return false;
    restoreEdges.set(id, original);
    return true;
  }

  // Connectors that are still attached to a node about to disappear go back to their old ends
  // when `base` had them; the rest are removed by the integrity pass below.
  if (removeNodes.size) {
    for (const edge of Object.values(current.edges)) {
      if (removeEdges.has(edge.id) || restoreEdges.has(edge.id)) continue;
      const attached = (edge.from.node && removeNodes.has(edge.from.node)) || (edge.to.node && removeNodes.has(edge.to.node));
      if (attached && base.edges[edge.id]) restoreEdges.set(edge.id, base.edges[edge.id]);
    }
  }

  // Close over what the restored elements depend on, until nothing new is pulled in.
  const dropped = new Set<Id>();
  const settled = { nodes: new Set<Id>(), edges: new Set<Id>(), comments: new Set<Id>() };
  for (let progress = true; progress; ) {
    progress = false;

    for (const node of [...restoreNodes.values()]) {
      if (settled.nodes.has(node.id)) continue;
      settled.nodes.add(node.id);
      progress = true;
      if (node.parent) needNode(node.parent);
    }

    for (const edge of [...restoreEdges.values()]) {
      if (settled.edges.has(edge.id)) continue;
      settled.edges.add(edge.id);
      progress = true;
      for (const end of [edge.from, edge.to]) {
        if (end.node && !needNode(end.node)) dropped.add(edge.id);
      }
    }

    for (const comment of [...restoreComments.values()]) {
      if (settled.comments.has(comment.id)) continue;
      settled.comments.add(comment.id);
      progress = true;
      if (comment.target && !needNode(comment.target) && !needEdge(comment.target)) dropped.add(comment.id);
    }
  }
  for (const id of dropped) {
    restoreEdges.delete(id);
    restoreComments.delete(id);
  }

  // A node that comes back with the connectors it lost, when their other end is there too.
  for (const node of restoreNodes.values()) {
    if (node.id in current.nodes) continue;
    for (const edge of Object.values(base.edges)) {
      if (edge.id in current.edges || restoreEdges.has(edge.id)) continue;
      if (edge.from.node !== node.id && edge.to.node !== node.id) continue;
      if ([edge.from.node, edge.to.node].every((end) => !end || nodeWillExist(end))) restoreEdges.set(edge.id, edge);
    }
  }

  // Children of a node that is going away return to the container they had.
  for (const child of Object.values(current.nodes)) {
    if (!child.parent || !removeNodes.has(child.parent)) continue;
    if (removeNodes.has(child.id) || restoreNodes.has(child.id)) continue;
    const original = base.nodes[child.id];
    if (!original || original.parent === child.parent) continue;
    if (original.parent && !nodeWillExist(original.parent)) continue;
    const moved: DNode = { ...child };
    if (original.parent) moved.parent = original.parent;
    else delete moved.parent;
    restoreNodes.set(child.id, moved);
  }

  // A restored node whose container cannot come back is released rather than left dangling.
  for (const node of restoreNodes.values()) {
    if (node.parent && !nodeWillExist(node.parent)) {
      const released: DNode = { ...node };
      delete released.parent;
      restoreNodes.set(node.id, released);
    }
  }

  const patch: Patch = {};
  if (restoreNodes.size || removeNodes.size) {
    patch.nodes = {
      ...(restoreNodes.size ? { set: [...restoreNodes.values()] } : {}),
      ...(removeNodes.size ? { remove: [...removeNodes] } : {}),
    };
  }
  if (restoreEdges.size || removeEdges.size) {
    patch.edges = {
      ...(restoreEdges.size ? { set: [...restoreEdges.values()] } : {}),
      ...(removeEdges.size ? { remove: [...removeEdges] } : {}),
    };
  }
  if (restoreComments.size || removeComments.size) {
    patch.comments = {
      ...(restoreComments.size ? { set: [...restoreComments.values()] } : {}),
      ...(removeComments.size ? { remove: [...removeComments] } : {}),
    };
  }
  return withIntegrity(current, patch);
}
