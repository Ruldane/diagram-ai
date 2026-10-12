"use client";

import type { DiagramAccess } from "@/core/auth";
import type { DiagramSummary } from "@/core/model/types";
import { cn } from "@/lib/cn";

export type OwnershipFilter = "all" | "mine" | "shared";

const OPTIONS: { id: OwnershipFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "shared", label: "Shared with me" },
];

/** Diagrams the person owns are "mine"; the rest were shared with them. Without access data (solo mode) everything is mine. */
export function filterDiagrams(diagrams: DiagramSummary[], access: Record<string, DiagramAccess>, filter: OwnershipFilter): DiagramSummary[] {
  if (filter === "all") return diagrams;
  return diagrams.filter((diagram) => {
    const mine = (access[diagram.id]?.role ?? "owner") === "owner";
    return filter === "mine" ? mine : !mine;
  });
}

/** Segmented control for the home page's diagram list. Shown only when accounts are on. */
export function DiagramFilter({ value, onChange, counts }: { value: OwnershipFilter; onChange: (value: OwnershipFilter) => void; counts: Record<OwnershipFilter, number> }) {
  return (
    <div role="radiogroup" aria-label="Show diagrams" className="inline-flex h-8 rounded-lg border border-line-strong bg-sunken p-0.5">
      {OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
              selected ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink",
            )}
          >
            {option.label}
            <span className="font-mono text-[10.5px] text-ink-4">{counts[option.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
