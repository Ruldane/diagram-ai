"use client";

import { useEffect, useMemo } from "react";

import type { ReviewDiff } from "@/core/review";

import { useEditor, useEditorStore } from "../store/context";
import type { Comparison } from "../store/editor-store";
import { applyReviewResponse, fetchReview, reviewDiff } from "./review-state";

/** How long a review may show nothing before the server is asked to close it. */
const TIDY_DELAY_MS = 1500;

export interface ReviewView {
  compare: Comparison;
  diff: ReviewDiff;
}

/** The live document compared with whatever is being compared against (a review baseline or a checkpoint). */
export function useReviewDiff(): ReviewView | null {
  const compare = useEditor((state) => state.compare);
  const doc = useEditor((state) => state.doc);
  return useMemo(() => (compare && doc ? { compare, diff: reviewDiff(compare.base, doc) } : null), [compare, doc]);
}

/**
 * Keeps `compare` in step with the server's review baseline: fetched when a
 * review becomes active, when the server announces a change to it, and when
 * the Review tab opens. A checkpoint comparison takes precedence and is left
 * alone. Mounted once, by the canvas overlay.
 */
export function useReviewSync(): void {
  const store = useEditorStore();
  const ready = useEditor((state) => state.status === "ready");
  const diagramId = useEditor((state) => state.diagramId);
  // A new object for every `review` event (the server announces partial accepts too), so this refetches.
  const review = useEditor((state) => state.review);
  const comparingCheckpoint = useEditor((state) => state.compare?.source === "checkpoint");
  const tabOpen = useEditor((state) => state.panel === "review");

  useEffect(() => {
    if (!ready || comparingCheckpoint) return;
    if (!review?.active) {
      if (store.getState().compare?.source === "review") store.setState({ compare: null });
      return;
    }
    const controller = new AbortController();
    fetchReview(diagramId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        // Only the baseline matters here: the pending flag in the store is kept up to date by the event stream.
        applyReviewResponse(store, { review: store.getState().review ?? response.review, base: response.base });
      })
      .catch(() => {
        // Offline or the diagram is gone; the next `review` event or the tab opening retries.
      });
    return () => controller.abort();
  }, [store, ready, diagramId, review, comparingCheckpoint, tabOpen]);

  // A review whose changes were all reverted by hand has nothing left to show: let the server close it.
  const drained = useEditor((state) => {
    const { compare, doc } = state;
    return Boolean(state.review?.active && compare?.source === "review" && doc && reviewDiff(compare.base, doc).changes.length === 0);
  });
  useEffect(() => {
    if (!drained) return;
    const timer = window.setTimeout(() => {
      const { diagramId: id, compare } = store.getState();
      if (compare?.source !== "review") return;
      // An empty selection accepts nothing; the server closes the review only if it truly has no differences left.
      void fetch(`/api/diagrams/${encodeURIComponent(id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", ids: [] }),
      }).catch(() => undefined);
    }, TIDY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [store, drained]);
}
