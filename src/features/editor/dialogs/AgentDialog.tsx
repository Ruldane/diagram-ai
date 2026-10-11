"use client";

import { Check, Copy, Eye, FileDown, MessagesSquare, MousePointer2, PenLine, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AgentInfo } from "@/core/protocol";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConnectAgent } from "@/features/agents/ConnectAgent";
import { actorColor, timeAgo } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { useEditor } from "../store/context";
import { useClock } from "./use-clock";

const COPIED_MS = 1600;

const ABILITIES: { icon: LucideIcon; text: string }[] = [
  { icon: PenLine, text: "Draw a diagram from a description, without coordinates" },
  { icon: MousePointer2, text: "Edit what you have selected" },
  { icon: MessagesSquare, text: "Read and answer your comments" },
  { icon: Eye, text: "Look at a rendered preview to check their own work" },
  { icon: FileDown, text: "Export files" },
];

const SECTION_TITLE = "mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase";

function AgentRow({ agent, now }: { agent: AgentInfo; now: number }) {
  const working = agent.status === "working";
  return (
    <li className="flex h-9 items-center gap-2.5 px-3">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", working && "agent-dot")} style={{ background: actorColor({ kind: "agent", id: agent.id }) }} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{agent.name}</span>
      <span className={cn("shrink-0 text-[12px]", working ? "text-ink" : "text-ink-3")}>
        {working ? "working…" : "idle"}
        {working && agent.tool ? <span className="ml-1.5 hidden font-mono text-[11px] text-ink-3 sm:inline">{agent.tool}</span> : null}
      </span>
      <time dateTime={agent.lastSeen} className="w-[68px] shrink-0 text-right font-mono text-[11px] text-ink-3">
        {timeAgo(agent.lastSeen, now)}
      </time>
    </li>
  );
}

function AgentStatus() {
  const agents = useEditor((state) => state.agents);
  const now = useClock();
  const sorted = useMemo(
    () => [...agents].sort((a, b) => Number(b.status === "working") - Number(a.status === "working") || b.lastSeen.localeCompare(a.lastSeen)),
    [agents],
  );

  if (sorted.length === 0) {
    return <p className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-ink-3">No agent has connected to this diagram yet.</p>;
  }
  return (
    <ul aria-label="Connected agents" className="divide-y divide-line rounded-xl border border-line bg-raised">
      {sorted.map((agent) => (
        <AgentRow key={agent.id} agent={agent} now={now} />
      ))}
    </ul>
  );
}

function DiagramPrompt({ diagramId }: { diagramId: string }) {
  const prompt = `use diagram ${diagramId}`;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-raised py-2 pr-2 pl-3">
      <span className="text-[13px] text-ink-2">Tell your agent:</span>
      <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all text-ink">{prompt}</code>
      <Button
        size="sm"
        aria-label={copied ? "Copied" : "Copy the instruction for your agent"}
        onClick={() => void navigator.clipboard.writeText(prompt).then(() => setCopied(true), () => undefined)}
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Who is connected, how to connect an MCP client, and what an agent can do here. */
export function AgentDialog({ onClose }: { onClose: () => void }) {
  const diagramId = useEditor((state) => state.diagramId);

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Connect an AI agent"
      description="Agents join over MCP and draw on this canvas while you watch."
      width="max-w-2xl"
    >
      <div className="flex flex-col gap-6">
        <section>
          <h3 className={SECTION_TITLE}>On this diagram</h3>
          <AgentStatus />
        </section>

        <section>
          <h3 className={SECTION_TITLE}>Connect</h3>
          <ConnectAgent />
        </section>

        <section>
          <h3 className={SECTION_TITLE}>What agents can do here</h3>
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {ABILITIES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-[13px] text-ink-2">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                {text}
              </li>
            ))}
          </ul>
          <div className="mt-3.5">
            <DiagramPrompt diagramId={diagramId} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}
