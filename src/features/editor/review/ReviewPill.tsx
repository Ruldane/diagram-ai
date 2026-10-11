"use client";

import { GitCompareArrows, X } from "lucide-react";

import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { useEditor, useEditorStore } from "../store/context";
import { closeComparison, openReview, plural } from "./review-state";
import { useReviewDiff } from "./use-review";

/**
 * Top-bar entry to the review: "Review 7 changes" while agent changes are
 * pending, or the name of the checkpoint being compared (with a way out).
 * Renders nothing when there is nothing to review.
 */
export function ReviewPill() {
  const store = useEditorStore();
  const view = useReviewDiff();
  const panel = useEditor((state) => state.panel);
  if (!view) return null;

  const { compare, diff } = view;

  if (compare.source === "checkpoint") {
    return (
      <span className="flex h-8 max-w-[220px] items-center rounded-lg bg-sunken text-[12.5px] font-medium text-ink">
        <button
          type="button"
          onClick={() => openReview(store)}
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg pr-1 pl-2.5 hover:text-ink"
          aria-label={`Comparing with checkpoint ${compare.label}. Open the review`}
        >
          <GitCompareArrows aria-hidden className="size-3.5 shrink-0 text-ink-3" />
          <span className="hidden truncate md:inline">{compare.label}</span>
        </button>
        <Tip label="Close comparison">
          <button
            type="button"
            aria-label="Close comparison"
            onClick={() => closeComparison(store)}
            className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-line hover:text-ink"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </Tip>
      </span>
    );
  }

  const rows = diff.counts.rows;
  if (rows === 0) return null;
  return (
    <Tip label="Accept or revert what agents changed">
      <button
        type="button"
        onClick={() => openReview(store)}
        aria-pressed={panel === "review"}
        className={cn(
          "flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors",
          panel === "review" ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
        )}
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--warn)]" />
        <span className="hidden md:inline">Review {plural(rows, "change")}</span>
        <span className="md:hidden">{rows}</span>
      </button>
    </Tip>
  );
}
