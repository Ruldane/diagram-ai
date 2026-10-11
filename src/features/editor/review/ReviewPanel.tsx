"use client";

import { Check, GitCompareArrows, MessageSquare, Move, Spline, Square, Undo2, X } from "lucide-react";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { Id } from "@/core/model/types";
import { changeLabel, describeFields, type ReviewChange, type ReviewChangeKind } from "@/core/review";
import { Button, IconButton } from "@/components/ui/button";
import { actorColor } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { useEditor, useEditorStore } from "../store/context";
import { acceptChanges, closeComparison, focusIds, plural, rejectChanges } from "./review-state";
import { useReviewDiff } from "./use-review";

const KIND_COLOR: Record<Exclude<ReviewChangeKind, "layout">, string> = {
  added: "var(--success)",
  modified: "var(--warn)",
  removed: "var(--danger)",
};

const ELEMENT_ICON = { node: <Square />, edge: <Spline />, comment: <MessageSquare /> } as const;

interface RowProps {
  /** The ids the row stands for: one element, or all the rearranged ones. */
  ids: Id[];
  kind: ReviewChangeKind;
  element: ReviewChange["element"];
  title: string;
  detail?: string;
  /** No accepting (comparing with a checkpoint). */
  revertOnly: boolean;
  disabled: boolean;
  onFocus: (ids: Id[]) => void;
  onAccept: (ids: Id[]) => void;
  onReject: (ids: Id[]) => void;
}

/** Primitive props only, so a row does not re-render while a drag re-computes the diff. */
const Row = memo(function Row({ ids, kind, element, title, detail, revertOnly, disabled, onFocus, onAccept, onReject }: RowProps) {
  const color = kind === "layout" ? "var(--ink-3)" : KIND_COLOR[kind];
  const icon = kind === "layout" ? <Move /> : ELEMENT_ICON[element];
  return (
    <li className="group flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-sunken focus-within:bg-sunken">
      <button type="button" onClick={() => onFocus(ids)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5"
          style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[12.5px] text-ink", kind === "removed" && "line-through decoration-ink-3")}>{title}</span>
          {detail ? <span className="block truncate text-[11px] text-ink-3">{detail}</span> : null}
        </span>
      </button>
      <span className="flex shrink-0 gap-0.5">
        {revertOnly ? null : (
          <IconButton size="sm" label="Accept" aria-label={`Accept ${title}`} disabled={disabled} onClick={() => onAccept(ids)}>
            <Check className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          size="sm"
          label={kind === "removed" ? "Restore" : "Revert"}
          aria-label={`${kind === "removed" ? "Restore" : "Revert"} ${title}`}
          disabled={disabled}
          onClick={() => onReject(ids)}
        >
          <Undo2 className="size-3.5" />
        </IconButton>
      </span>
    </li>
  );
});

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-0.5 flex items-baseline gap-1.5 px-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        {title}
        <span className="font-mono text-[10.5px] font-normal">{count}</span>
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function Placeholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="m-3 rounded-xl border border-dashed border-line-strong px-3 py-6 text-center">
      <p className="font-display text-[18px] text-ink-2">{title}</p>
      {children}
    </div>
  );
}

/** Reviews what agents changed: a list to accept or revert one by one, matched by an overlay on the canvas. */
export function ReviewPanel() {
  const store = useEditorStore();
  const view = useReviewDiff();
  const review = useEditor((state) => state.review);
  const readOnly = useEditor((state) => state.readOnly);
  const [busy, setBusy] = useState(false);

  const onFocus = useCallback((ids: Id[]) => focusIds(store, ids), [store]);

  const onAccept = useCallback(
    async (ids: Id[] | "all") => {
      setBusy(true);
      const accepted = await acceptChanges(store, ids);
      setBusy(false);
      if (ids === "all" && accepted) toast.success(`Accepted ${plural(accepted, "change")}`);
    },
    [store],
  );

  const onReject = useCallback(
    (ids: Id[] | "all") => {
      const reverted = rejectChanges(store, ids);
      if (reverted && (ids === "all" || ids.length > 1)) {
        toast(`Reverted ${plural(reverted, "change")}`, { action: { label: "Undo", onClick: () => store.getState().undo() } });
      }
    },
    [store],
  );

  const rows = useMemo(() => {
    if (!view) return null;
    const { base } = view.compare;
    const current = store.getState().doc;
    if (!current) return null;
    const label = (change: ReviewChange) => changeLabel(change, base, current);
    const pick = (kind: ReviewChangeKind) => view.diff.changes.filter((change) => change.kind === kind);
    const rowOf = (change: ReviewChange) => ({
      key: change.id,
      ids: [change.id],
      kind: change.kind,
      element: change.element,
      title: label(change),
      detail: change.kind === "modified" ? `Changed ${describeFields(change.fields)}` : undefined,
    });
    const layout = pick("layout");
    const counts = {
      nodes: layout.filter((change) => change.element === "node").length,
      edges: layout.filter((change) => change.element === "edge").length,
      comments: layout.filter((change) => change.element === "comment").length,
    };
    const parts = [
      counts.nodes ? plural(counts.nodes, "shape") : "",
      counts.edges ? plural(counts.edges, "connector") : "",
      counts.comments ? plural(counts.comments, "comment") : "",
    ].filter(Boolean);
    const rearranged = layout.length
      ? {
          ids: layout.map((change) => change.id),
          kind: "layout" as const,
          element: "node" as const,
          title: counts.nodes ? `Rearranged ${parts[0]}` : counts.edges ? `Re-routed ${parts[0]}` : `Moved ${parts[0]}`,
          detail: parts.length > 1 ? `and ${parts.slice(1).join(", ")}` : undefined,
        }
      : null;
    return { added: pick("added").map(rowOf), modified: pick("modified").map(rowOf), removed: pick("removed").map(rowOf), rearranged };
  }, [view, store]);

  if (!view || !rows) {
    if (review?.active) {
      return (
        <div role="status" className="flex flex-col gap-2 p-3">
          <span className="sr-only">Loading changes…</span>
          {[0, 1, 2].map((row) => (
            <div key={row} aria-hidden className="h-9 animate-pulse rounded-lg bg-sunken" />
          ))}
        </div>
      );
    }
    return (
      <Placeholder title="Nothing to review">
        <p className="mx-auto mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-ink-3">
          When an agent changes this diagram, its changes are listed here so you can accept or revert them one by one.
        </p>
        <Button size="sm" className="mt-3" onClick={() => store.setState({ dialog: "history" })}>
          <GitCompareArrows className="size-3.5" />
          Compare with a checkpoint
        </Button>
      </Placeholder>
    );
  }

  const { compare, diff } = view;
  const checkpoint = compare.source === "checkpoint";
  const { counts } = diff;
  const summary = [
    counts.added ? `${counts.added} added` : "",
    counts.modified ? `${counts.modified} changed` : "",
    counts.removed ? `${counts.removed} removed` : "",
    counts.layout ? `${counts.layout} rearranged` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const disabled = readOnly || busy;
  const byAgent = !checkpoint && review?.by ? review.by : null;

  const rowProps = { revertOnly: checkpoint, disabled, onFocus, onAccept, onReject };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-3 py-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          {byAgent ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: actorColor(byAgent) }} /> : null}
          <span className="min-w-0 flex-1 truncate">{checkpoint ? `Comparing with “${compare.label}”` : compare.label}</span>
        </p>
        <p aria-live="polite" className="mt-0.5 text-[12px] text-ink-3">
          {summary || (checkpoint ? "The diagram matches this checkpoint." : "No differences")}
        </p>
        {diff.changes.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {checkpoint ? null : (
              <Button size="sm" variant="primary" disabled={disabled} onClick={() => void onAccept("all")}>
                <Check className="size-3.5" />
                Accept all
              </Button>
            )}
            <Button size="sm" disabled={disabled} onClick={() => onReject("all")}>
              <Undo2 className="size-3.5" />
              {checkpoint ? "Revert all" : "Reject all"}
            </Button>
            {checkpoint ? (
              <Button size="sm" variant="ghost" onClick={() => closeComparison(store)}>
                <X className="size-3.5" />
                Close comparison
              </Button>
            ) : null}
          </div>
        ) : checkpoint ? (
          <Button size="sm" className="mt-2.5" onClick={() => closeComparison(store)}>
            <X className="size-3.5" />
            Close comparison
          </Button>
        ) : null}
        {diff.changes.length && !checkpoint ? (
          <p className="mt-2 text-[11px] leading-snug text-ink-4">Accept keeps a change. Reject undoes it — Ctrl+Z brings it back.</p>
        ) : null}
      </header>

      {diff.changes.length ? (
        <div className="flex flex-col gap-3 p-2">
          {rows.added.length ? (
            <Group title="Added" count={rows.added.length}>
              {rows.added.map(({ key, ...row }) => (
                <Row key={key} {...row} {...rowProps} />
              ))}
            </Group>
          ) : null}
          {rows.modified.length ? (
            <Group title="Changed" count={rows.modified.length}>
              {rows.modified.map(({ key, ...row }) => (
                <Row key={key} {...row} {...rowProps} />
              ))}
            </Group>
          ) : null}
          {rows.removed.length ? (
            <Group title="Removed" count={rows.removed.length}>
              {rows.removed.map(({ key, ...row }) => (
                <Row key={key} {...row} {...rowProps} />
              ))}
            </Group>
          ) : null}
          {rows.rearranged ? (
            <Group title="Rearranged" count={counts.layout}>
              <Row key="layout" {...rows.rearranged} {...rowProps} />
            </Group>
          ) : null}
        </div>
      ) : (
        <Placeholder title="Nothing to review">
          <p className="mx-auto mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-ink-3">
            {checkpoint ? "Nothing has changed since this checkpoint." : "Every change has been accepted or reverted."}
          </p>
        </Placeholder>
      )}
    </div>
  );
}
