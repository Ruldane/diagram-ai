"use client";

import { RotateCw } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DiagramSummary } from "@/core/model/types";
import { cn } from "@/lib/cn";

import { DeleteDiagramDialog } from "./DeleteDiagramDialog";
import { DiagramCard } from "./DiagramCard";
import { Reveal } from "./Reveal";
import { Section } from "./Section";
import { jumpTo, SECTION, TYPE_SEARCH_ID } from "./sections";
import { useDiagrams } from "./use-diagrams";
import { useNow } from "./use-now";
import { useReturnFocus } from "./use-return-focus";

/** Cards shown before "Show all": two rows on a wide screen, and fewer on a phone's single column. */
const INITIAL_COUNT = 8;
const PHONE_COUNT = 4;

const GRID = "grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function Skeletons() {
  return (
    <div aria-busy className={GRID}>
      <span className="sr-only">Loading your diagrams</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} aria-hidden className="rounded-xl border border-line bg-surface p-2">
          <div className="aspect-[16/10] rounded-lg bg-sunken" />
          <div className="px-1.5 pt-3.5 pb-2">
            <div className="h-3.5 w-3/5 rounded bg-sunken" />
            <div className="mt-2.5 h-2.5 w-4/5 rounded bg-sunken" />
            <div className="mt-2.5 h-2.5 w-2/5 rounded bg-sunken" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-display text-[26px] leading-tight text-ink">
        Nothing on the table <em>yet</em>.
      </p>
      <p className="mx-auto mt-2 max-w-[54ch] text-[13px] leading-relaxed text-ink-3">
        Pick a diagram type to start from a worked example, or connect an agent and ask it to draw one. Whatever gets created shows up here by itself.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={() => jumpTo(SECTION.create, TYPE_SEARCH_ID)}>Choose a type</Button>
        <Button variant="ghost" onClick={() => jumpTo(SECTION.agents)}>
          Connect an agent
        </Button>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-line bg-surface px-6 py-8 text-center">
      <p className="text-[14px] font-semibold text-ink">Your diagrams could not be loaded.</p>
      <p className="mx-auto mt-1 max-w-[60ch] text-[13px] break-words text-ink-3">{message}</p>
      <Button className="mt-4" onClick={onRetry}>
        <RotateCw aria-hidden className="size-3.5" />
        Try again
      </Button>
    </div>
  );
}

/** "Your diagrams": the live gallery of saved diagrams, most recent first. */
export function DiagramsSection() {
  const { state, retry, remove } = useDiagrams();
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState<DiagramSummary | null>(null);

  // A dialog is transient: do not come back to it open after navigating away.
  useLayoutEffect(() => () => setDeleting(null), []);

  // After a cancelled delete, focus goes back to that card's menu button.
  const lastTarget = useRef<string | null>(null);
  useReturnFocus(deleting !== null, () =>
    lastTarget.current ? document.querySelector<HTMLElement>(`[data-diagram-menu="${CSS.escape(lastTarget.current)}"]`) : null,
  );
  const askDelete = (diagram: DiagramSummary) => {
    lastTarget.current = diagram.id;
    setDeleting(diagram);
  };

  const diagrams = state.status === "ready" ? state.diagrams : [];
  const visible = expanded ? diagrams : diagrams.slice(0, INITIAL_COUNT);

  return (
    <Section
      id={SECTION.diagrams}
      index="01"
      title="Your diagrams"
      aside={
        diagrams.length > 0 ? (
          <p className="font-mono text-[11px] text-ink-3">
            {diagrams.length} {diagrams.length === 1 ? "diagram" : "diagrams"} · most recent first
          </p>
        ) : null
      }
    >
      {state.status === "loading" ? <Skeletons /> : null}
      {state.status === "error" ? <ErrorState message={state.message} onRetry={retry} /> : null}
      {state.status === "ready" && diagrams.length === 0 ? <EmptyState /> : null}

      {visible.length > 0 ? (
        <ul className={GRID}>
          {visible.map((diagram, index) => (
            <li key={diagram.id} className={expanded ? undefined : "max-[519px]:nth-[n+5]:hidden"}>
              <Reveal delay={index < INITIAL_COUNT ? index * 40 : 0} className="h-full">
                <DiagramCard diagram={diagram} now={now} onDelete={() => askDelete(diagram)} />
              </Reveal>
            </li>
          ))}
        </ul>
      ) : null}

      {diagrams.length > PHONE_COUNT ? (
        <div className={cn("mt-5 flex justify-center", diagrams.length <= INITIAL_COUNT && "min-[520px]:hidden")}>
          <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show fewer" : `Show all ${diagrams.length}`}
          </Button>
        </div>
      ) : null}

      {deleting ? <DeleteDiagramDialog diagram={deleting} onClose={() => setDeleting(null)} onDeleted={remove} /> : null}
    </Section>
  );
}
