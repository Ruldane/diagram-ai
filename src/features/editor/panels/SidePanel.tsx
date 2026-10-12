"use client";

import { Activity, CodeXml, GitCompareArrows, MessageSquare, SlidersHorizontal, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { AskPanel } from "../chat/AskPanel";
import { CodePanel } from "../code/CodePanel";
import { ReviewPanel } from "../review/ReviewPanel";
import { useEditor, useEditorStore } from "../store/context";
import type { SidePanel as PanelId } from "../store/editor-store";
import { ActivityPanel } from "./ActivityPanel";
import { CommentsPanel } from "./CommentsPanel";
import { Inspector } from "./inspector/Inspector";

const TABS: { id: PanelId; label: string; icon: ReactNode }[] = [
  { id: "design", label: "Design", icon: <SlidersHorizontal /> },
  { id: "ask", label: "Ask", icon: <Sparkles /> },
  { id: "review", label: "Review", icon: <GitCompareArrows /> },
  { id: "comments", label: "Comments", icon: <MessageSquare /> },
  { id: "code", label: "Code", icon: <CodeXml /> },
  { id: "activity", label: "Activity", icon: <Activity /> },
];

const PANELS: Record<PanelId, () => ReactNode> = {
  design: () => <Inspector />,
  ask: () => <AskPanel />,
  review: () => <ReviewPanel />,
  comments: () => <CommentsPanel />,
  code: () => <CodePanel />,
  activity: () => <ActivityPanel />,
};

/** Right-hand panel: properties, assistant, review, comments, code and the agent activity feed. */
export function SidePanel() {
  const store = useEditorStore();
  const panel = useEditor((state) => state.panel);
  const openComments = useEditor((state) => Object.values(state.doc!.comments).filter((c) => !c.resolved).length);
  const working = useEditor((state) => state.agents.some((agent) => agent.status === "working"));
  const reviewing = useEditor((state) => Boolean(state.review?.active));
  const readOnly = useEditor((state) => state.readOnly);
  if (!panel) return null;

  /** Small indicator on a tab that has something waiting. */
  const badge = (id: PanelId): ReactNode => {
    if (id === "comments" && openComments) return <span className="font-mono text-[10.5px] text-accent">{openComments}</span>;
    if (id === "activity" && working) return <span className="agent-dot size-1.5 rounded-full bg-[var(--agent-claude)]" />;
    if (id === "review" && reviewing) return <span className="size-1.5 rounded-full bg-[var(--warn)]" />;
    return null;
  };

  return (
    <aside aria-label="Side panel" className="flex h-full w-[312px] flex-col rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-panel)]">
      <header className="flex shrink-0 items-center gap-0.5 border-b border-line px-1.5 py-1.5">
        <div role="tablist" className="flex flex-1 gap-0.5">
          {TABS.map((tab) => {
            const active = panel === tab.id;
            return (
              <Tip key={tab.id} label={tab.label}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={tab.label}
                  onClick={() => store.setState({ panel: tab.id })}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium transition-colors [&>svg]:size-4",
                    active ? "bg-sunken pr-2 text-ink" : "text-ink-3 hover:bg-sunken/60 hover:text-ink",
                  )}
                >
                  {tab.icon}
                  {active ? tab.label : null}
                  {badge(tab.id)}
                </button>
              </Tip>
            );
          })}
        </div>
        <IconButton size="sm" label="Close panel" onClick={() => store.setState({ panel: null })}>
          <X className="size-3.5" />
        </IconButton>
      </header>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {/* A viewer reads everything and changes nothing: every control inside is disabled in one place. */}
        <fieldset disabled={readOnly} className="contents">
          {PANELS[panel]()}
        </fieldset>
      </div>
    </aside>
  );
}
