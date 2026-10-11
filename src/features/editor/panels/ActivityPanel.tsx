"use client";

import { Download, Eye, FolderInput, History, LayoutGrid, MessageSquare, MousePointerClick, Pencil, Plus, ScanEye, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { union } from "@/core/geometry/basics";
import { nodeBounds } from "@/core/model/queries";
import type { ActivityAction, ActivityEntry, AgentInfo } from "@/core/protocol";
import { Button } from "@/components/ui/button";
import { actorColor, timeAgo } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { useEditor, useEditorStore } from "../store/context";

const ICONS: Record<ActivityAction, ReactNode> = {
  create: <Sparkles />,
  read: <Eye />,
  add: <Plus />,
  update: <Pencil />,
  delete: <Trash2 />,
  layout: <LayoutGrid />,
  comment: <MessageSquare />,
  preview: <ScanEye />,
  export: <Download />,
  snapshot: <History />,
  restore: <History />,
  import: <FolderInput />,
  highlight: <MousePointerClick />,
};

const TOOL_LABELS: Record<string, string> = {
  diagram_read: "reading the diagram",
  diagram_add_elements: "drawing",
  diagram_update_elements: "editing",
  diagram_delete_elements: "removing elements",
  diagram_layout: "arranging",
  diagram_build_sequence: "building a sequence",
  diagram_preview: "looking at the result",
  diagram_export: "exporting",
  diagram_list_comments: "reading comments",
  diagram_add_comment: "commenting",
  diagram_get_selection: "checking your selection",
  diagram_list_shapes: "browsing shapes",
  diagram_list_types: "browsing diagram types",
};

function AgentCard({ agent }: { agent: AgentInfo }) {
  const color = actorColor({ kind: "agent", id: agent.id });
  const working = agent.status === "working";
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-raised px-2.5 py-2">
      <span className={cn("size-2.5 shrink-0 rounded-full", working && "agent-dot")} style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">{agent.name}</p>
        <p className="truncate text-[11.5px] text-ink-3">
          {working ? (TOOL_LABELS[agent.tool ?? ""] ?? "working") + "…" : `idle · last seen ${timeAgo(agent.lastSeen)}`}
        </p>
      </div>
    </div>
  );
}

function Entry({ entry }: { entry: ActivityEntry }) {
  const store = useEditorStore();
  const human = entry.actor.kind !== "agent";
  /** Jump to the elements an entry touched. */
  const reveal = () => {
    const state = store.getState();
    if (!state.doc || !entry.ids?.length) return;
    const existing = entry.ids.filter((id) => state.doc!.nodes[id] || state.doc!.edges[id]);
    if (!existing.length) return;
    state.select(existing);
    const bounds = union(existing.map((id) => state.doc!.nodes[id]).filter(Boolean).map(nodeBounds));
    if (bounds) state.zoomTo(bounds, 160, Math.max(state.viewport.zoom, 1));
  };
  const clickable = Boolean(entry.ids?.length);
  return (
    <li>
      <button
        type="button"
        disabled={!clickable}
        onClick={reveal}
        className={cn("flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left", clickable ? "hover:bg-sunken" : "cursor-default")}
      >
        <span
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-white [&>svg]:size-3"
          style={{ background: human ? "var(--ink-3)" : actorColor(entry.actor) }}
        >
          {ICONS[entry.action]}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">{entry.actor.name}</span> {entry.summary}{" "}
          <span className="ml-1 text-[11px] whitespace-nowrap text-ink-4">{timeAgo(entry.at)}</span>
        </span>
      </button>
    </li>
  );
}

/** Live feed of what agents (and people) did to this diagram. */
export function ActivityPanel() {
  const store = useEditorStore();
  const agents = useEditor((state) => state.agents);
  const activity = useEditor((state) => state.activity);
  const listRef = useRef<HTMLOListElement>(null);

  // Follow new entries, like a log.
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [activity.length]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {agents.length ? (
        <div className="flex flex-col gap-1.5">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line-strong px-3 py-5 text-center">
          <p className="font-display text-[18px] text-ink-2">No agent yet</p>
          <p className="mt-1.5 mb-3 text-[12px] leading-relaxed text-ink-3">
            Connect Claude Code or Codex and their work appears here step by step — and on the canvas as they draw.
          </p>
          <Button size="sm" variant="primary" onClick={() => store.setState({ dialog: "agent" })}>
            Connect an agent
          </Button>
        </div>
      )}

      {activity.length ? (
        <div>
          <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Activity</h3>
          <ol ref={listRef} className="flex flex-col">
            {activity.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
