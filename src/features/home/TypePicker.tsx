"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/fields";
import { CATEGORIES, listDiagramTypes, searchDiagramTypes, type CategoryId, type DiagramTypeDef } from "@/core/catalog";
import { cn } from "@/lib/cn";

import { Section } from "./Section";
import { SECTION, TYPE_SEARCH_ID } from "./sections";
import { TypeCard } from "./TypeCard";

type Filter = CategoryId | "all";

function Chip({ selected, count, onSelect, children }: { selected: boolean; count: number; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors",
        selected ? "border-ink bg-ink text-bg" : "border-line-strong text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      {children}
      <span className={cn("font-mono text-[10.5px]", selected ? "opacity-70" : "text-ink-3")}>{count}</span>
    </button>
  );
}

/**
 * "New diagram": every diagram type, searchable and filterable. With no search
 * or filter the types are grouped by category so a long catalog stays scannable.
 */
export function TypePicker() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const types = listDiagramTypes();
  /** Categories that have at least one type, in catalog order, with their types. */
  const groups = useMemo(() => {
    const byCategory = new Map<CategoryId, DiagramTypeDef[]>();
    for (const type of types) byCategory.set(type.category, [...(byCategory.get(type.category) ?? []), type]);
    return CATEGORIES.flatMap((category) => {
      const members = byCategory.get(category.id);
      return members ? [{ category, types: members }] : [];
    });
  }, [types]);

  const term = query.trim();
  const grouped = term === "" && filter === "all";
  const matches = useMemo(() => {
    const found = term ? searchDiagramTypes(term, types.length) : types;
    return filter === "all" ? found : found.filter((type) => type.category === filter);
  }, [term, filter, types]);
  const active = groups.find((group) => group.category.id === filter)?.category;

  const reset = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <Section
      id={SECTION.create}
      index="02"
      title="New diagram"
      lead="A type opens with a small worked example when it has one. Use Blank to start from an empty canvas instead."
    >
      <div className="flex flex-col gap-3">
        <div className="relative w-full sm:max-w-[340px]">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <TextInput
            id={TYPE_SEARCH_ID}
            role="searchbox"
            aria-label="Search diagram types"
            placeholder="Search types: sequence, ERD, swimlane…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            className="pr-8 pl-8"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Scrolls sideways on narrow screens; the padding leaves room for focus rings. */}
        <div role="group" aria-label="Filter by category" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <Chip selected={filter === "all"} count={types.length} onSelect={() => setFilter("all")}>
            All
          </Chip>
          {groups.map(({ category, types: members }) => (
            <Chip key={category.id} selected={filter === category.id} count={members.length} onSelect={() => setFilter(category.id)}>
              {category.name}
            </Chip>
          ))}
        </div>
      </div>

      {grouped ? (
        <div className="mt-6">
          {groups.map(({ category, types: members }) => (
            <div key={category.id} className="grid grid-cols-1 gap-x-10 gap-y-3 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0 lg:grid-cols-[200px_minmax(0,1fr)]">
              <div>
                <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
                  {category.name}
                  <span className="font-mono text-[10.5px] font-normal text-ink-3">{members.length}</span>
                </h3>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{category.description}</p>
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {members.map((type) => (
                  <TypeCard key={type.id} type={type} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <p aria-live="polite" className="mb-3 text-[12px] text-ink-3">
            <span className="font-mono text-[11px] text-ink-2">
              {matches.length} {matches.length === 1 ? "type" : "types"}
            </span>
            {term ? <> matching “{term}”</> : null}
            {active ? <> in {active.name}</> : null}
            {active && !term ? <span className="hidden sm:inline"> · {active.description}</span> : null}
          </p>
          {matches.length > 0 ? (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {matches.map((type) => (
                <TypeCard key={type.id} type={type} showCategory={filter === "all"} />
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong px-6 py-8 text-center">
              <p className="text-[13px] text-ink-2">Nothing fits that yet. Try a different word, or look through every type.</p>
              <Button size="sm" className="mt-3" onClick={reset}>
                Show all types
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
