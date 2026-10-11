"use client";

import { ExternalLink, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Shown instead of the composer while no engine can answer: no signed-in CLI and no `ANTHROPIC_API_KEY`. */
export function SetupCard({ onCheck, onConnectAgent, checking }: { onCheck: () => void; onConnectAgent: () => void; checking: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <KeyRound className="size-3.5" />
        </span>
        <h3 className="font-display text-[18px] leading-tight text-ink">Set up the assistant</h3>
      </div>

      <p className="text-[12.5px] leading-snug text-ink-2">
        The easiest way is the Claude Code or Codex you already use: install it and sign in once in a terminal, then reload (it appears in the list above and uses your plan).
        Otherwise, use an API key:
      </p>

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

      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onCheck} disabled={checking}>
          Check again
        </Button>
      </div>

      <div className="border-t border-line pt-3">
        <p className="text-[12px] leading-snug text-ink-3">
          Rather use your Claude Code or Codex subscription? Connect it as an agent over MCP. It draws on this same canvas and shows up in Activity.
        </p>
        <Button size="sm" className="mt-2" onClick={onConnectAgent}>
          Connect an agent
        </Button>
      </div>
    </div>
  );
}
