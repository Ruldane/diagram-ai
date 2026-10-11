"use client";

import { Check, ChevronRight, CircleAlert, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";

import type { ChatMessage, ChatToolCall } from "@/core/protocol";
import { actorColor } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { Markdown } from "./Markdown";
import { messageSegments } from "./stream";
import { runningLabel } from "./tool-labels";

function StepIcon({ status }: { status: ChatToolCall["status"] }) {
  if (status === "running") return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-ink-3" />;
  if (status === "error") return <CircleAlert className="size-3.5 shrink-0 text-danger" />;
  return <Check className="size-3.5 shrink-0 text-success" />;
}

/** One tool call: a single line while collapsed, the tool name and its full result when opened. */
function StepRow({ tool }: { tool: ChatToolCall }) {
  const [open, setOpen] = useState(false);
  const running = tool.status === "running";
  const label = running ? runningLabel(tool.name) : (tool.summary ?? "Done");
  return (
    <li className="rounded-lg border border-line bg-raised">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sunken/60"
      >
        <StepIcon status={tool.status} />
        <span className={cn("min-w-0 flex-1 truncate text-[12px]", tool.status === "error" ? "text-danger" : "text-ink-2")}>{label}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-ink-4 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="border-t border-line px-2 py-1.5">
          <p className="font-mono text-[10.5px] text-ink-3">{tool.name}</p>
          {tool.detail ? (
            <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] leading-snug break-words whitespace-pre-wrap text-ink-3 select-text">{tool.detail}</pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Thinking() {
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
      <span className="agent-dot size-1.5 rounded-full" style={{ background: actorColor({ kind: "agent", id: "assistant" }) }} />
      Thinking…
    </p>
  );
}

export function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-2 text-[13px] leading-snug break-words whitespace-pre-wrap text-ink select-text">
      {message.text}
    </div>
  );
}

/** The assistant's reply: text and tool steps in the order they happened. `live` while it is still being written. */
export function AssistantMessage({ message, live }: { message: ChatMessage; live: boolean }) {
  const segments = messageSegments(message);
  // Between steps, or before anything arrived: nothing is moving, so say the model is working.
  const last = segments.at(-1);
  const waiting = live && !message.tools?.some((tool) => tool.status === "running") && (!last || last.kind === "steps");
  return (
    <div className="flex gap-2">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-white [&>svg]:size-3"
        style={{ background: actorColor({ kind: "agent", id: "assistant" }) }}
      >
        <Sparkles />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {segments.map((segment, index) =>
          segment.kind === "text" ? (
            <Markdown key={index} text={segment.text} />
          ) : (
            <ul key={index} className="flex flex-col gap-1">
              {segment.tools.map((tool, i) => (
                <StepRow key={tool.id ?? `${index}-${i}`} tool={tool} />
              ))}
            </ul>
          ),
        )}
        {waiting ? <Thinking /> : null}
        {message.diagnostic ? (
          <p className={cn("flex items-start gap-1.5 text-[11.5px] leading-snug", message.diagnostic.ok ? "text-ink-4" : "text-danger")}>
            {message.diagnostic.ok ? <Check className="mt-0.5 size-3 shrink-0" /> : <CircleAlert className="mt-0.5 size-3 shrink-0" />}
            {message.diagnostic.message}
          </p>
        ) : null}
        {message.stopped ? <p className="text-[11.5px] text-ink-3 italic">Stopped</p> : null}
      </div>
    </div>
  );
}
