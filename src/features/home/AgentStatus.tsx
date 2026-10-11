"use client";

import Link from "next/link";

import type { AgentInfo } from "@/core/protocol";
import { actorColor, timeAgo } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { diagramHref } from "./api";
import { jumpTo, SECTION } from "./sections";
import { useNow } from "./use-now";
import { useWorkspace } from "./use-workspace-events";

/** Same window the server uses before it forgets an agent. */
const AGENT_TTL_MS = 30 * 60_000;

const PILL = "flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium";

/** "Claude Code", "Claude Code and Codex", "3 agents". */
function names(agents: AgentInfo[]): { text: string; plural: boolean } {
  const unique = [...new Set(agents.map((agent) => agent.name))];
  if (unique.length === 1) return { text: unique[0], plural: false };
  return { text: unique.length === 2 ? `${unique[0]} and ${unique[1]}` : `${unique.length} agents`, plural: true };
}

function Dot({ color, pulse, hollow }: { color?: string; pulse?: boolean; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", pulse && "agent-dot", hollow && "border border-ink-4")}
      style={hollow ? undefined : { background: color }}
    />
  );
}

/** Live agent indicator for the header, fed by the workspace event stream. */
export function AgentStatus() {
  const { connection, agents } = useWorkspace();
  const now = useNow();

  if (connection === "connecting") {
    return (
      <span className={cn(PILL, "text-ink-3")}>
        <Dot hollow />
        <span className="sr-only">Checking for connected agents</span>
      </span>
    );
  }
  if (connection === "offline") {
    return (
      <span className={cn(PILL, "text-ink-3")} title="The live connection to the server dropped. Retrying.">
        <Dot color="var(--warn)" />
        <span className="truncate">Reconnecting…</span>
      </span>
    );
  }

  const seen = agents.filter((agent) => now - Date.parse(agent.lastSeen) < AGENT_TTL_MS);
  const working = seen.filter((agent) => agent.status === "working");

  if (seen.length === 0) {
    return (
      <a
        href={`#${SECTION.agents}`}
        onClick={(event) => {
          event.preventDefault();
          jumpTo(SECTION.agents);
        }}
        className={cn(PILL, "text-ink-3 transition-colors hover:bg-sunken hover:text-ink")}
      >
        <Dot hollow />
        <span className="truncate">No agent connected</span>
      </a>
    );
  }

  const active = working.length > 0;
  const shown = active ? working : seen;
  const lead = shown[0];
  const who = names(shown);
  const label = active ? `${who.text} ${who.plural ? "are" : "is"} working…` : `${who.text} connected`;
  const body = (
    <>
      <Dot color={actorColor({ kind: "agent", id: lead.id })} pulse={active} />
      <span className="truncate">{label}</span>
    </>
  );

  // While an agent is drawing, the indicator is a shortcut to the diagram it is on.
  if (active && lead.diagramId) {
    return (
      <Link href={diagramHref(lead.diagramId)} title="Open the diagram it is working on" className={cn(PILL, "text-ink transition-colors hover:bg-sunken")}>
        {body}
      </Link>
    );
  }
  return (
    <span className={cn(PILL, active ? "text-ink" : "text-ink-2")} title={`Last seen ${timeAgo(lead.lastSeen, now)}`}>
      {body}
    </span>
  );
}
