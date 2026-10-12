"use client";

import { ExternalLink, KeyRound, Terminal } from "lucide-react";

import type { ChatEngineStatus } from "@/core/protocol";
import { Button } from "@/components/ui/button";

export interface SetupCardProps {
  /** The engine the person has selected, which cannot answer right now. */
  engine: ChatEngineStatus;
  /** Another engine that can, offered as a one-click switch. */
  alternative?: ChatEngineStatus;
  onUseAlternative(): void;
  onCheck(): void;
  onConnectAgent(): void;
  checking: boolean;
}

/** Shown instead of the composer while the selected engine cannot answer. Each engine gets its own steps. */
export function SetupCard({ engine, alternative, onUseAlternative, onCheck, onConnectAgent, checking }: SetupCardProps) {
  const api = engine.id === "claude-api";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">{api ? <KeyRound className="size-3.5" /> : <Terminal className="size-3.5" />}</span>
        <h3 className="font-display text-[18px] leading-tight text-ink">{api ? "Add an API key" : "Set up Claude Code"}</h3>
      </div>

      {api ? <ApiKeySteps /> : <ClaudeCodeSteps reason={engine.reason} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={onCheck} disabled={checking}>
          Check again
        </Button>
        {alternative ? (
          <Button size="sm" onClick={onUseAlternative}>
            Use {alternative.label} instead
          </Button>
        ) : null}
      </div>

      <div className="border-t border-line pt-3">
        <p className="text-[12px] leading-snug text-ink-3">
          Prefer to work in your own terminal? Connect Claude Code or another agent over MCP. It draws on this same canvas and shows up in Activity.
        </p>
        <Button size="sm" className="mt-2" onClick={onConnectAgent}>
          Connect an agent
        </Button>
      </div>
    </div>
  );
}

function ClaudeCodeSteps({ reason }: { reason?: string }) {
  return (
    <>
      <p className="text-[12.5px] leading-snug text-ink-2">
        The assistant can use the Claude Code you already have on this computer, with your own Claude plan. No API key is needed.
      </p>
      {reason ? <p className="rounded-lg bg-sunken px-2.5 py-1.5 text-[12px] leading-snug text-ink-2">{reason}</p> : null}
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px] leading-snug text-ink-2">
        <li>
          Install{" "}
          <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline">
            Claude Code
            <ExternalLink className="size-3" />
          </a>
          .
        </li>
        <li>
          In a terminal, run <code className="rounded bg-sunken px-1 py-px font-mono text-[11.5px]">claude</code> once and sign in.
        </li>
        <li>Come back here and check again.</li>
      </ol>
      <p className="text-[12px] leading-snug text-ink-3">
        The app never sees your login: it only asks Claude Code whether you are signed in. It works when this app is opened at localhost on the same computer.
      </p>
    </>
  );
}

function ApiKeySteps() {
  return (
    <>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px] leading-snug text-ink-2">
        <li>
          Create an API key in the{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline">
            Anthropic Console
            <ExternalLink className="size-3" />
          </a>
          .
        </li>
        <li>
          Add it to a file named <code className="rounded bg-sunken px-1 py-px font-mono text-[11.5px]">.env.local</code> in the project folder:
          <pre className="mt-1 overflow-x-auto rounded-lg bg-sunken p-2 font-mono text-[11.5px] text-ink select-text">ANTHROPIC_API_KEY=sk-ant-…</pre>
        </li>
        <li>Restart the app (stop and run the dev server again), then check again.</li>
      </ol>
      <p className="text-[12px] leading-snug text-ink-3">
        With a key, the assistant is billed per use to your Anthropic API account, separately from a Claude Code or Claude.ai subscription. The key stays on this machine&apos;s
        server and is never sent to the browser.
      </p>
    </>
  );
}
