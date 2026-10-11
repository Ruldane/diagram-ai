import type { DiagramDoc, Id } from "../model/types";
import { diffForReview, type ReviewDiff } from "./diff";

export interface AcceptResult {
  /** The new baseline: the old one with the accepted elements brought up to date. */
  base: DiagramDoc;
  /** Everything that was accepted, including elements pulled in to keep the baseline consistent. */
  accepted: Id[];
  /** What is still waiting for review against the new baseline. */
  remaining: ReviewDiff;
}

/**
 * Moves the review baseline forward so the given elements equal the current
 * state. Accepting never touches the live document.
 *
 * The baseline has to remain a valid diagram on its own, so accepting an
 * element can accept others with it: a connector brings the nodes it is
 * attached to, a node its container, a comment the element it is pinned to —
 * and accepting a removal accepts the changes that detached everything that
 * used to hang from the removed element.
 *
 * Ids that are not part of the difference are ignored.
 */
export function acceptIntoBase(base: DiagramDoc, current: DiagramDoc, ids: Iterable<Id> | "all"): AcceptResult {
  const diff = diffForReview(base, current);

  if (ids === "all") {
    const next: DiagramDoc = { ...base, nodes: current.nodes, edges: current.edges, comments: current.comments };
    return { base: next, accepted: diff.changes.map((change) => change.id), remaining: diffForReview(next, current) };
  }

  const accepted = new Set<Id>();
  for (const id of ids) if (diff.byId.has(id)) accepted.add(id);

  const build = (): DiagramDoc => {
    const next: DiagramDoc = { ...base, nodes: { ...base.nodes }, edges: { ...base.edges }, comments: { ...base.comments } };
    for (const change of diff.changes) {
      if (!accepted.has(change.id)) continue;
      const key = change.element === "node" ? "nodes" : change.element === "edge" ? "edges" : "comments";
      const target = next[key] as Record<Id, unknown>;
      const source = current[key] as Record<Id, unknown>;
      if (change.id in source) target[change.id] = source[change.id];
      else delete target[change.id];
    }
    return next;
  };

  /** Pulls an element into the accepted set; false when it was already in or is not changed. */
  const take = (id: Id): boolean => {
    if (accepted.has(id) || !diff.byId.has(id)) return false;
    accepted.add(id);
    return true;
  };

  let next = build();
  for (let again = true; again; ) {
    again = false;
    const exists = (id: Id): boolean => id in next.nodes;

    for (const node of Object.values(next.nodes)) {
      if (!node.parent || exists(node.parent)) continue;
      // Either the container is new (take it) or it was removed and this node was released or removed with it.
      again = (node.parent in current.nodes ? take(node.parent) : take(node.id)) || again;
    }
    for (const edge of Object.values(next.edges)) {
      for (const end of [edge.from, edge.to]) {
        if (!end.node || exists(end.node)) continue;
        again = (end.node in current.nodes ? take(end.node) : take(edge.id)) || again;
      }
    }
    for (const comment of Object.values(next.comments)) {
      const target = comment.target;
      if (!target || exists(target) || target in next.edges) continue;
      const inCurrent = target in current.nodes || target in current.edges;
      again = (inCurrent ? take(target) : take(comment.id)) || again;
    }
    if (again) next = build();
  }

  return { base: next, accepted: [...accepted], remaining: diffForReview(next, current) };
}
