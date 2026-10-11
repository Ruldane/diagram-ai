"use client";

import { ArrowRight } from "lucide-react";

import { listDiagramTypes } from "@/core/catalog";
import { cn } from "@/lib/cn";

import { useCreateDiagram } from "./HomeProviders";
import { jumpTo, SECTION, TYPE_SEARCH_ID } from "./sections";

const COUNT = 5;

/** The first few catalog types as one-click starts, so the common cases need no scrolling. */
export function QuickStart({ className }: { className?: string }) {
  const { pending, create } = useCreateDiagram();
  const total = listDiagramTypes().length;
  const types = listDiagramTypes().slice(0, COUNT);
  if (types.length === 0) return null;

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-sm)]", className)}>
      <p className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2.5 font-mono text-[11px] tracking-[0.08em] text-ink-3 uppercase">
        <span id="quick-start-label">Quick start</span>
        <a
          href={`#${SECTION.create}`}
          onClick={(event) => {
            event.preventDefault();
            jumpTo(SECTION.create, TYPE_SEARCH_ID);
          }}
          className="rounded tracking-normal normal-case underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink-3"
        >
          all {total} types
        </a>
      </p>
      <ul aria-labelledby="quick-start-label" className="border-t border-line">
        {types.map((type, index) => {
          const creating = pending?.typeId === type.id;
          return (
            <li key={type.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                disabled={pending !== null}
                aria-busy={creating}
                onClick={() => create(type.id, true)}
                className={cn(
                  "group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:-outline-offset-2",
                  "enabled:hover:bg-raised disabled:cursor-default",
                  pending && !creating && "opacity-50",
                )}
              >
                <span aria-hidden className="w-5 shrink-0 font-mono text-[11px] text-ink-4">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{type.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">{type.description}</span>
                </span>
                {creating ? (
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-accent">
                    <span aria-hidden className="agent-dot size-1.5 rounded-full bg-accent" />
                    Creating…
                  </span>
                ) : (
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-4 transition-[color,translate] group-hover:translate-x-0.5 group-hover:text-accent" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
