import { toast } from "sonner";

import { union } from "@/core/geometry/basics";
import { isEmptyPatch } from "@/core/model/patch";
import { nodeBounds } from "@/core/model/queries";
import type { DiagramDoc, Id, Rect } from "@/core/model/types";
import type { ReviewInfo } from "@/core/protocol";
import { changeIds, diffForReview, revertPatch, type ReviewChange, type ReviewContent, type ReviewDiff } from "@/core/review";
import type { ReviewResponse, SnapshotResponse } from "@/core/review/protocol";

import type { Comparison, EditorState, EditorStore } from "../store/editor-store";

/**
 * Review logic that is not React: the shared diff, talking to the server, and
 * the actions behind the panel's buttons. Rejecting is an ordinary local edit
 * (synced, validated and undoable); accepting only moves the server's baseline.
 */

/** Server limit for ids in one accept request; beyond it "everything" is sent. */
const MAX_IDS = 5000;

/* -------------------------------------------------------------------- diff */

let memo: { base: DiagramDoc; nodes: DiagramDoc["nodes"]; edges: DiagramDoc["edges"]; comments: DiagramDoc["comments"]; diff: ReviewDiff } | null = null;

/** The panel, the pill and the canvas overlay all ask for the same diff: compute it once per change. */
export function reviewDiff(base: DiagramDoc, doc: ReviewContent): ReviewDiff {
  if (memo && memo.base === base && memo.nodes === doc.nodes && memo.edges === doc.edges && memo.comments === doc.comments) return memo.diff;
  const diff = diffForReview(base, doc);
  memo = { base, nodes: doc.nodes, edges: doc.edges, comments: doc.comments, diff };
  return diff;
}

/* ------------------------------------------------------------------ labels */

/** "14:02" today, "12 Mar, 14:02" otherwise. */
export function formatSince(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

export function reviewHeading(review: ReviewInfo): string {
  const who = review.by?.name ?? "an agent";
  return review.since ? `Changes by ${who} since ${formatSince(review.since)}` : `Changes by ${who}`;
}

export const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ server */

export async function fetchReview(diagramId: Id, signal?: AbortSignal): Promise<ReviewResponse> {
  const response = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/review`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`The review could not be loaded (${response.status})`);
  return (await response.json()) as ReviewResponse;
}

async function postAccept(diagramId: Id, ids: Id[] | "all"): Promise<ReviewResponse> {
  const response = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept", ids }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `The changes could not be accepted (${response.status})`);
  }
  return (await response.json()) as ReviewResponse;
}

/** Puts a server answer into the store: the baseline (when it is what is being shown) and the pending flag. */
export function applyReviewResponse(store: EditorStore, { review, base }: ReviewResponse): void {
  const state = store.getState();
  const patch: Partial<EditorState> = {};
  const current = state.review;
  if (current?.active !== review.active || current?.since !== review.since) patch.review = review;
  if (state.compare?.source !== "checkpoint") {
    patch.compare = base ? { base, label: reviewHeading(review), source: "review" } : null;
  }
  store.setState(patch);
}

/* ----------------------------------------------------------------- actions */

/** Accepts changes: the baseline moves forward, the diagram does not change. Returns how many were accepted. */
export async function acceptChanges(store: EditorStore, ids: Id[] | "all"): Promise<number> {
  const { diagramId, compare, doc, readOnly } = store.getState();
  if (readOnly || !doc || compare?.source !== "review") return 0;
  // Naming the elements (rather than "all") keeps anything an agent added since this list was drawn pending.
  const explicit = ids === "all" ? changeIds(reviewDiff(compare.base, doc)) : ids;
  try {
    const response = await postAccept(diagramId, explicit.length > MAX_IDS ? "all" : explicit);
    applyReviewResponse(store, response);
    return explicit.length;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The changes could not be accepted.");
    return 0;
  }
}

/** Reverts changes with an ordinary edit, so Ctrl+Z brings them back. Returns how many elements changed. */
export function rejectChanges(store: EditorStore, ids: Id[] | "all"): number {
  const { doc, compare, readOnly, apply } = store.getState();
  if (!doc || !compare || readOnly) return 0;
  const diff = reviewDiff(compare.base, doc);
  const wanted = ids === "all" ? changeIds(diff) : ids;
  const patch = revertPatch(compare.base, doc, wanted, diff);
  if (isEmptyPatch(patch)) return 0;
  apply(patch);
  return wanted.length;
}

/** Selects what a change is about and brings it into view (removed elements are framed where they used to be). */
export function focusChanges(store: EditorStore, changes: readonly ReviewChange[]): void {
  const { doc, compare, select, zoomTo, viewport } = store.getState();
  if (!doc || !compare || !changes.length) return;

  const rects: Rect[] = [];
  const present: Id[] = [];
  for (const change of changes) {
    const source = change.kind === "removed" ? compare.base : doc;
    if (change.element === "node") {
      const node = source.nodes[change.id];
      if (node) rects.push(nodeBounds(node));
    } else if (change.element === "edge") {
      const edge = source.edges[change.id];
      const ends = [edge?.from.node, edge?.to.node].flatMap((id) => (id && source.nodes[id] ? [nodeBounds(source.nodes[id])] : []));
      const points = [...(edge?.waypoints ?? []), edge?.from.point, edge?.to.point].flatMap((p) => (p ? [{ x: p.x, y: p.y, w: 0, h: 0 }] : []));
      rects.push(...ends, ...points);
    } else {
      const comment = source.comments[change.id];
      if (comment) {
        const target = comment.target ? source.nodes[comment.target] : undefined;
        rects.push(target ? nodeBounds(target) : { x: comment.x, y: comment.y, w: 0, h: 0 });
      }
    }
    if (change.kind !== "removed" && (doc.nodes[change.id] || doc.edges[change.id])) present.push(change.id);
  }

  if (present.length) select(present);
  else store.setState({ selection: [] });
  if (changes.length === 1 && changes[0].element === "comment" && doc.comments[changes[0].id]) store.setState({ activeComment: changes[0].id });
  const bounds = union(rects);
  if (bounds) zoomTo(bounds, 140, Math.max(1, viewport.zoom));
}

/** `focusChanges` for ids, looked up in the current diff (ids that are no longer part of it are skipped). */
export function focusIds(store: EditorStore, ids: readonly Id[]): void {
  const { doc, compare } = store.getState();
  if (!doc || !compare) return;
  const { byId } = reviewDiff(compare.base, doc);
  focusChanges(
    store,
    ids.flatMap((id) => {
      const change = byId.get(id);
      return change ? [change] : [];
    }),
  );
}

/** Opens the review tab; the baseline itself is fetched by the sync hook. */
export function openReview(store: EditorStore): void {
  store.setState({ panel: "review" });
}

/** Compares the diagram with one of its checkpoints, on the same canvas overlay and list as a review. */
export async function compareWithCheckpoint(store: EditorStore, snapshotId: Id): Promise<Comparison> {
  const { diagramId } = store.getState();
  const response = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/snapshots/${encodeURIComponent(snapshotId)}`, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `The checkpoint could not be loaded (${response.status})`);
  }
  const { snapshot } = (await response.json()) as SnapshotResponse;
  const comparison: Comparison = { base: snapshot.doc, label: snapshot.name, source: "checkpoint" };
  store.setState({ compare: comparison, panel: "review" });
  return comparison;
}

/** Ends a checkpoint comparison; a pending review (if any) is shown again by the sync hook. */
export function closeComparison(store: EditorStore): void {
  store.setState({ compare: null });
}
