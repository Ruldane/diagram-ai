"use client";

import { useId } from "react";

import { Tip } from "@/components/ui/tooltip";
import { getCategory, type DiagramTypeDef } from "@/core/catalog";
import { cn } from "@/lib/cn";

import { useCreateDiagram } from "./HomeProviders";

export interface TypeCardProps {
  type: DiagramTypeDef;
  /** Show the category above the name (flat result lists; redundant under a category heading). */
  showCategory?: boolean;
}

/**
 * One diagram type. The whole card starts a diagram from the type's example;
 * the small "Blank" button starts it empty.
 */
export function TypeCard({ type, showCategory }: TypeCardProps) {
  const { pending, create } = useCreateDiagram();
  const descriptionId = useId();
  const creating = pending?.typeId === type.id;
  const locked = pending !== null;

  return (
    <li
      className={cn(
        "relative flex flex-col rounded-xl border bg-surface px-3 py-2.5 transition-[border-color,box-shadow,opacity] duration-150",
        creating ? "border-accent" : "border-line",
        !locked && "hover:border-line-strong hover:shadow-[var(--shadow-sm)]",
        locked && !creating && "opacity-50",
      )}
    >
      {showCategory ? <p className="mb-1 truncate font-mono text-[10.5px] tracking-[0.06em] text-ink-3 uppercase">{getCategory(type.category).name}</p> : null}
      <div className="flex min-h-6 items-start gap-2">
        <button
          type="button"
          disabled={locked}
          aria-busy={creating}
          aria-describedby={descriptionId}
          onClick={() => create(type.id, true)}
          className={cn(
            "min-w-0 flex-1 py-0.5 text-left text-[13.5px] leading-5 font-semibold text-ink outline-none disabled:cursor-default",
            "after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-solid focus-visible:after:outline-accent",
          )}
        >
          {type.name}
        </button>
        {creating ? (
          <span className="flex h-6 shrink-0 items-center gap-1.5 font-mono text-[11px] text-accent">
            <span aria-hidden className="agent-dot size-1.5 rounded-full bg-accent" />
            Creating…
          </span>
        ) : type.template ? (
          <Tip label="Start empty, without the example" side="top">
            <button
              type="button"
              disabled={locked}
              aria-label={`New blank ${type.name}`}
              onClick={() => create(type.id, false)}
              className="relative z-10 h-6 shrink-0 rounded-md border border-line px-1.5 font-mono text-[11px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink disabled:pointer-events-none"
            >
              Blank
            </button>
          </Tip>
        ) : null}
      </div>
      <p id={descriptionId} className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">
        {type.description}
      </p>
    </li>
  );
}
