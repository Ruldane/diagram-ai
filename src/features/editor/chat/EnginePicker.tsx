"use client";

import { ChevronDown, FolderOpen } from "lucide-react";
import { useState } from "react";

import type { ChatEngineId, ChatEngineStatus } from "@/core/protocol";
import { cn } from "@/lib/cn";

/** One line each, so the person knows what a request is charged against before sending it. */
function billingNote(engine: ChatEngineStatus): string {
  if (engine.billing === "api") return "Billed to your Anthropic API account";
  return "Uses your Claude plan's allowance";
}

export interface EnginePickerProps {
  engines: ChatEngineStatus[];
  selected: ChatEngineId;
  onSelect(id: ChatEngineId): void;
  workdir: string;
  onWorkdirChange(value: string): void;
  disabled?: boolean;
}

/**
 * Which model backs the assistant, and what it costs against. The list is
 * collapsed to the current choice while chatting. The working folder (CLI
 * engines only) lets the assistant read files there, never write.
 */
export function EnginePicker({ engines, selected, onSelect, workdir, onWorkdirChange, disabled }: EnginePickerProps) {
  const [open, setOpen] = useState(false);
  const current = engines.find((engine) => engine.id === selected);
  const local = current !== undefined && current.id !== "claude-api";

  return (
    <div className="shrink-0 border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-sunken/50 disabled:opacity-60"
      >
        <span className="font-medium text-ink">{current?.label ?? "Choose an engine"}</span>
        <span className="min-w-0 flex-1 truncate text-ink-3">{current ? (current.available ? billingNote(current) : "Not available") : ""}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-ink-4 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="flex flex-col gap-1.5 px-3 pb-2.5">
          <ul role="radiogroup" aria-label="Assistant engine" className="flex flex-col gap-1">
            {engines.map((engine) => (
              <li key={engine.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={engine.id === selected}
                  onClick={() => onSelect(engine.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left",
                    engine.id === selected ? "border-accent bg-accent-soft/40" : "border-line bg-raised hover:border-line-strong",
                    !engine.available && "opacity-80",
                  )}
                >
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", engine.available ? "bg-success" : "bg-ink-4")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                      {engine.label}
                      <span className="rounded bg-sunken px-1 text-[10px] font-normal text-ink-3">{engine.billing === "api" ? "API billing" : "Your plan"}</span>
                      <span className={cn("rounded bg-sunken px-1 text-[10px] font-medium", engine.available ? "text-success" : "font-normal text-ink-3")}>
                        {engine.available ? "Ready" : "Not set up"}
                      </span>
                    </span>
                    <span className={cn("block text-[11.5px] leading-snug", engine.available && !engine.reason ? "text-ink-3" : engine.available ? "text-warn" : "text-ink-3")}>
                      {engine.reason ?? (engine.available ? billingNote(engine) : "Not available")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {local ? (
            <label className="flex flex-col gap-1 text-[11.5px] text-ink-3">
              <span className="flex items-center gap-1">
                <FolderOpen className="size-3" />
                Working folder (optional)
              </span>
              <span className="flex items-center gap-1">
                <input
                  value={workdir}
                  onChange={(event) => onWorkdirChange(event.target.value)}
                  placeholder="Absolute path, e.g. C:\Projects\app"
                  spellCheck={false}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 font-mono text-[11.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-4 focus:border-accent"
                />
                <button type="button" onClick={() => onWorkdirChange("")} disabled={!workdir} className="h-7 rounded-md px-2 text-[11.5px] text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-40">
                  Clear
                </button>
              </span>
              <span className="leading-snug">With a folder set, the assistant can read the files in it (never change them) to draw what it finds.</span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
