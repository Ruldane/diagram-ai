"use client";

import {
  ChevronDown,
  CloudOff,
  Download,
  History,
  Keyboard,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Redo2,
  Search,
  Sun,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CATEGORIES, getDiagramType, listDiagramTypes } from "@/core/catalog";
import type { AgentInfo } from "@/core/protocol";
import { Button, IconButton } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";
import { actorColor } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

import { runCommand, shortcutOf } from "../commands/commands";
import { PresentButton } from "../present/PresentButton";
import { ReviewPill } from "../review/ReviewPill";
import { useEditor, useEditorStore } from "../store/context";

const ISLAND = "pointer-events-auto flex h-11 items-center gap-0.5 rounded-[var(--radius-panel)] border border-line bg-surface px-1.5 shadow-[var(--shadow-panel)]";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <rect x="2.5" y="3" width="8" height="6.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="14.5" width="8" height="6.5" rx="3.25" fill="var(--accent)" />
      <path d="M6.5 9.5v5.2a3 3 0 0 0 3 3h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Inline-editable diagram title. */
function DiagramName() {
  const store = useEditorStore();
  const name = useEditor((state) => state.doc!.name);
  const [draft, setDraft] = useState(name);
  // Follow renames made elsewhere (another tab, an agent, undo).
  const [synced, setSynced] = useState(name);
  if (synced !== name) {
    setSynced(name);
    setDraft(name);
  }

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) store.getState().apply({ doc: { name: next } });
    else setDraft(name);
  };
  return (
    <input
      value={draft}
      aria-label="Diagram name"
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(name);
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
        }
      }}
      style={{ width: `${Math.min(Math.max(draft.length, 8), 36) + 2}ch` }}
      className="h-8 min-w-0 rounded-md bg-transparent px-2 text-[13.5px] font-semibold text-ink outline-none hover:bg-sunken focus:bg-raised focus:ring-2 focus:ring-accent/25"
    />
  );
}

/** Switches the diagram type (palette, defaults and agent guidance), grouped by category. */
function TypeMenu() {
  const store = useEditorStore();
  const typeId = useEditor((state) => state.doc!.type);
  const current = getDiagramType(typeId);
  const types = listDiagramTypes();
  return (
    <Menu
      trigger={
        <button type="button" className="flex h-7 max-w-[180px] items-center gap-1 rounded-md px-2 text-[12px] text-ink-3 hover:bg-sunken hover:text-ink">
          <span className="truncate">{current.name}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto">
        {CATEGORIES.map((category) => {
          const items = types.filter((type) => type.category === category.id);
          if (!items.length) return null;
          return (
            <div key={category.id}>
              <MenuLabel>{category.name}</MenuLabel>
              {items.map((type) => (
                <MenuItem
                  key={type.id}
                  checked={type.id === typeId}
                  onSelect={() =>
                    store.getState().apply({ doc: { type: type.id, settings: { routing: type.routing, layout: type.layout } } })
                  }
                >
                  {type.name}
                </MenuItem>
              ))}
            </div>
          );
        })}
      </div>
    </Menu>
  );
}

function describeAgents(agents: AgentInfo[]): { label: string; working: AgentInfo | undefined } {
  const working = agents.find((agent) => agent.status === "working");
  if (working) return { label: `${working.name} is working…`, working };
  if (agents.length === 1) return { label: `${agents[0].name} connected`, working };
  if (agents.length > 1) return { label: `${agents.length} agents connected`, working };
  return { label: "Connect an agent", working };
}

/** Shows which agents are on this diagram; opens the connection instructions. */
function AgentPill() {
  const store = useEditorStore();
  const agents = useEditor((state) => state.agents);
  const { label, working } = describeAgents(agents);
  return (
    <Tip label={agents.length ? "Agent activity and connection" : "Let Claude Code or Codex draw here"}>
      <button
        type="button"
        onClick={() => store.setState(agents.length ? { panel: "activity" } : { dialog: "agent" })}
        className={cn(
          "flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors",
          working ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
        )}
      >
        <span className="flex -space-x-1">
          {agents.length ? (
            agents.slice(0, 3).map((agent) => (
              <span
                key={agent.id}
                className={cn("size-2.5 rounded-full ring-2 ring-[var(--surface)]", agent.status === "working" && "agent-dot")}
                style={{ background: actorColor({ kind: "agent", id: agent.id }) }}
              />
            ))
          ) : (
            <span className="size-2.5 rounded-full border-[1.5px] border-dashed border-ink-3" />
          )}
        </span>
        <span className="hidden whitespace-nowrap md:inline">{label}</span>
      </button>
    </Tip>
  );
}

export function TopBar() {
  const store = useEditorStore();
  const { theme, toggle } = useTheme();
  const canUndo = useEditor((state) => state.undoStack.length > 0);
  const canRedo = useEditor((state) => state.redoStack.length > 0);
  const undoActor = useEditor((state) => state.undoStack[state.undoStack.length - 1]?.actor);
  const offline = useEditor((state) => state.connection === "offline");
  const paletteOpen = useEditor((state) => state.paletteOpen);
  const panel = useEditor((state) => state.panel);
  const openComments = useEditor((state) => Object.values(state.doc!.comments).filter((c) => !c.resolved).length);
  const run = (id: string) => runCommand(store, id);

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex items-start justify-between gap-3">
      <div className={cn(ISLAND, "min-w-0")}>
        <Tip label="All diagrams">
          <Link href="/" aria-label="All diagrams" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-sunken">
            <Logo />
          </Link>
        </Tip>
        <IconButton label={paletteOpen ? "Hide shape library" : "Show shape library"} shortcut={shortcutOf("view.palette")} active={false} onClick={() => run("view.palette")}>
          <PanelLeft className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
        <DiagramName />
        <TypeMenu />
        {offline ? (
          <Tip label="Connection lost. Reconnecting — your changes are kept and re-sent.">
            <span className="ml-1 flex h-7 items-center gap-1.5 rounded-md bg-danger-soft px-2 text-[11.5px] font-medium text-danger">
              <CloudOff className="size-3.5" />
              Offline
            </span>
          </Tip>
        ) : null}
      </div>

      <div className={cn(ISLAND, "shrink-0")}>
        <ReviewPill />
        <AgentPill />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <IconButton
          label={undoActor && undoActor !== "you" ? `Undo ${undoActor}'s change` : "Undo"}
          shortcut={shortcutOf("edit.undo")}
          disabled={!canUndo}
          onClick={() => run("edit.undo")}
        >
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo" shortcut={shortcutOf("edit.redo")} disabled={!canRedo} onClick={() => run("edit.redo")}>
          <Redo2 className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <IconButton label="Search and commands" shortcut={shortcutOf("diagram.command")} onClick={() => run("diagram.command")}>
          <Search className="size-4" />
        </IconButton>
        <IconButton label="Comments" active={panel === "comments"} onClick={() => store.setState({ panel: panel === "comments" ? null : "comments" })} className="relative">
          <MessageSquare className="size-4" />
          {openComments ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-mono text-[9px] font-semibold text-accent-ink">
              {openComments}
            </span>
          ) : null}
        </IconButton>
        <IconButton label="Checkpoints" shortcut={shortcutOf("diagram.history")} onClick={() => run("diagram.history")}>
          <History className="size-4" />
        </IconButton>
        <PresentButton />
        <IconButton label="Keyboard shortcuts" shortcut="?" onClick={() => run("diagram.shortcuts")}>
          <Keyboard className="size-4" />
        </IconButton>
        <IconButton label={theme === "dark" ? "Light theme" : "Dark theme"} onClick={toggle}>
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconButton>
        <IconButton label={panel ? "Hide side panel" : "Show side panel"} shortcut={shortcutOf("view.inspector")} onClick={() => run("view.inspector")}>
          <PanelRight className="size-4" />
        </IconButton>
        <Button variant="primary" size="sm" className="ml-1 h-8 rounded-lg px-3" onClick={() => run("diagram.export")}>
          <Download className="size-3.5" />
          Export
        </Button>
      </div>
    </div>
  );
}
