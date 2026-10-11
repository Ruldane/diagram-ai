import { patchStats } from "@/core/model/patch";
import type { Actor, DiagramDoc, Id, Patch } from "@/core/model/types";
import type { ReviewInfo } from "@/core/protocol";
import { acceptIntoBase, changeLabel, diffForReview, sameValue, type ReviewChange, type ReviewCounts } from "@/core/review";

import type { Hub } from "../realtime/hub";
import type { DiagramRepository, ReviewBase } from "../store/repository";

/**
 * Review of agent changes, server side.
 *
 * The repository holds one baseline per diagram: the document as it was before
 * agents started changing it, until a person accepts. This class decides when
 * that baseline appears, moves it forward on accept and tells the browsers.
 * It never touches the live document — rejecting is an ordinary edit made by
 * the browser.
 */

/** An element of the agents' that a person has since put back or deleted. */
export interface RevertedElement {
  id: Id;
  label: string;
  /** `removed`: the person deleted it (an addition rejected). `restored`: it is back to how it was before the agent's change. */
  how: "removed" | "restored";
  at: string;
}

interface Ledger {
  /** Elements agents created or changed since the baseline. */
  touched: Set<Id>;
  reverted: Map<Id, RevertedElement>;
}

/** Plain data that outlives the classes using it (see `server/context.ts`). Kept in memory only. */
export interface ReviewMemory {
  ledgers: Map<Id, Ledger>;
}

export const createReviewMemory = (): ReviewMemory => ({ ledgers: new Map() });

export interface ReviewState {
  review: ReviewInfo;
  /** The baseline, for the browser to diff against its live document. */
  base: DiagramDoc | null;
}

export interface ReviewStatus {
  review: ReviewInfo;
  counts: ReviewCounts;
  /** Shapes and connectors whose position or route changed (not listed in `changes`). */
  rearranged: { nodes: number; edges: number };
  changes: (Pick<ReviewChange, "id" | "element" | "kind"> & { label: string })[];
  reverted: RevertedElement[];
}

export const INACTIVE: ReviewInfo = { active: false };

export function reviewInfo(base: ReviewBase | null): ReviewInfo {
  return base ? { active: true, ...(base.by ? { by: base.by } : {}), since: base.since } : INACTIVE;
}

const COLLECTIONS = ["nodes", "edges", "comments"] as const;

export class ReviewTracker {
  constructor(
    private readonly repo: DiagramRepository,
    private readonly hub: Hub,
    private readonly memory: ReviewMemory,
  ) {}

  private ledger(id: Id): Ledger {
    let ledger = this.memory.ledgers.get(id);
    if (!ledger) this.memory.ledgers.set(id, (ledger = { touched: new Set(), reverted: new Map() }));
    return ledger;
  }

  /** A failed write must not block editing: the review is a convenience, the diagram is the product. */
  private async persist(id: Id, base: ReviewBase | null): Promise<void> {
    try {
      await this.repo.setReviewBase(id, base);
    } catch (error) {
      console.error(`[diagram-ai] Could not save the review baseline of ${id}:`, error);
    }
  }

  async read(id: Id): Promise<ReviewState> {
    const base = await this.repo.getReviewBase(id);
    return { review: reviewInfo(base), base: base?.doc ?? null };
  }

  /**
   * Called by the service just before a change is saved, with the document as
   * it is now. An agent's first change creates the baseline from it; every
   * change after that is noted so agents can be told what was put back.
   */
  async beforeChange(doc: DiagramDoc, patch: Patch, actor: Actor): Promise<void> {
    const stats = patchStats(patch);
    const touchesContent = stats.nodesSet + stats.nodesRemoved + stats.edgesSet + stats.edgesRemoved + stats.commentsSet + stats.commentsRemoved > 0;
    if (!touchesContent) return;

    let base = await this.repo.getReviewBase(doc.id);
    if (!base) {
      if (actor.kind !== "agent") return;
      base = { doc, by: actor, since: new Date().toISOString() };
      await this.persist(doc.id, base);
      this.hub.publish(doc.id, { type: "review", review: reviewInfo(base) });
    }
    this.note(doc, base.doc, patch, actor);
  }

  /** An agent replacing the whole diagram (restoring a checkpoint) is reviewable like any other change. */
  async beforeReplace(doc: DiagramDoc, actor: Actor): Promise<void> {
    if (actor.kind !== "agent" || (await this.repo.getReviewBase(doc.id))) return;
    const base: ReviewBase = { doc, by: actor, since: new Date().toISOString() };
    await this.persist(doc.id, base);
    this.hub.publish(doc.id, { type: "review", review: reviewInfo(base) });
  }

  /** Keeps track of which of the agents' elements a person put back (for `diagram_review_status`). */
  private note(before: DiagramDoc, base: DiagramDoc, patch: Patch, actor: Actor): void {
    const ledger = this.ledger(before.id);
    const at = new Date().toISOString();
    for (const key of COLLECTIONS) {
      const part = patch[key] as { set?: { id: Id }[]; remove?: Id[] } | undefined;
      if (!part) continue;
      const original = base[key] as Record<Id, object>;
      const existing = before[key] as Record<Id, object>;
      const label = (id: Id) => {
        const element = key === "nodes" ? "node" : key === "edges" ? "edge" : "comment";
        return changeLabel({ id, element, kind: "modified" }, base, before);
      };
      if (actor.kind === "agent") {
        for (const element of part.set ?? []) {
          ledger.touched.add(element.id);
          ledger.reverted.delete(element.id);
        }
        for (const id of part.remove ?? []) {
          ledger.touched.delete(id);
          ledger.reverted.delete(id);
        }
        continue;
      }
      for (const element of part.set ?? []) {
        if (!ledger.touched.has(element.id)) continue;
        if (original[element.id] && sameValue(original[element.id], element)) {
          ledger.reverted.set(element.id, { id: element.id, label: label(element.id), how: "restored", at });
        } else {
          ledger.reverted.delete(element.id);
        }
      }
      for (const id of part.remove ?? []) {
        if (ledger.touched.has(id) && existing[id]) ledger.reverted.set(id, { id, label: label(id), how: "removed", at });
      }
    }
  }

  /**
   * Moves the baseline forward so the given elements (or everything) count as
   * reviewed. Clears it when nothing is left to review, which is also what an
   * empty `ids` does for a baseline that no longer differs from the diagram.
   */
  async accept(doc: DiagramDoc, ids: Id[] | "all"): Promise<ReviewState & { accepted: Id[] }> {
    const base = await this.repo.getReviewBase(doc.id);
    if (!base) return { review: INACTIVE, base: null, accepted: [] };

    const result = acceptIntoBase(base.doc, doc, ids);
    if (result.remaining.changes.length === 0) {
      await this.persist(doc.id, null);
      this.memory.ledgers.delete(doc.id);
      this.hub.publish(doc.id, { type: "review", review: INACTIVE });
      return { review: INACTIVE, base: null, accepted: result.accepted };
    }
    if (result.accepted.length === 0) return { review: reviewInfo(base), base: base.doc, accepted: [] };

    const next: ReviewBase = { ...base, doc: result.base };
    await this.persist(doc.id, next);
    const ledger = this.memory.ledgers.get(doc.id);
    for (const id of result.accepted) {
      ledger?.touched.delete(id);
      ledger?.reverted.delete(id);
    }
    // Other tabs refetch the baseline when they hear this.
    this.hub.publish(doc.id, { type: "review", review: reviewInfo(next) });
    return { review: reviewInfo(next), base: next.doc, accepted: result.accepted };
  }

  /** What is waiting for review, in terms an agent can act on. */
  async status(doc: DiagramDoc): Promise<ReviewStatus> {
    const base = await this.repo.getReviewBase(doc.id);
    if (!base) {
      return { review: INACTIVE, counts: { added: 0, removed: 0, modified: 0, layout: 0, rows: 0 }, rearranged: { nodes: 0, edges: 0 }, changes: [], reverted: [] };
    }
    const diff = diffForReview(base.doc, doc);
    const layout = diff.changes.filter((change) => change.kind === "layout");
    const reverted = [...(this.memory.ledgers.get(doc.id)?.reverted.values() ?? [])];
    return {
      review: reviewInfo(base),
      counts: diff.counts,
      rearranged: { nodes: layout.filter((c) => c.element === "node").length, edges: layout.filter((c) => c.element === "edge").length },
      changes: diff.changes
        .filter((change) => change.kind !== "layout")
        .map((change) => ({ id: change.id, element: change.element, kind: change.kind, label: changeLabel(change, base.doc, doc) })),
      reverted,
    };
  }

  /** Drops what is remembered about a deleted diagram (the repository removes the baseline itself). */
  forget(id: Id): void {
    this.memory.ledgers.delete(id);
  }
}
