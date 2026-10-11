"use client";

import { Check, Copy } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";

type ClientId = "claude" | "codex" | "other";

interface Snippet {
  label: string;
  /** Short note shown above the code. */
  hint: string;
  code: string;
}

function snippets(origin: string): Record<ClientId, Snippet[]> {
  const url = `${origin}/api/mcp`;
  return {
    claude: [
      { label: "Terminal", hint: "Run once in any project. Restart Claude Code afterwards.", code: `claude mcp add --transport http diagram-ai ${url}` },
      {
        label: ".mcp.json",
        hint: "Or commit this file at the root of a repository to share the server with your team.",
        code: JSON.stringify({ mcpServers: { "diagram-ai": { type: "http", url } } }, null, 2),
      },
    ],
    codex: [
      { label: "Terminal", hint: "Run once, then start a new Codex session.", code: `codex mcp add diagram-ai --url ${url}/codex` },
      { label: "config.toml", hint: "Or add this to ~/.codex/config.toml.", code: `[mcp_servers.diagram-ai]\nurl = "${url}/codex"` },
    ],
    other: [
      {
        label: "HTTP",
        hint: "Any MCP client that supports Streamable HTTP (Cursor, VS Code, Gemini CLI, Windsurf…). Append /<name> to label the agent on the canvas.",
        code: JSON.stringify({ mcpServers: { "diagram-ai": { url } } }, null, 2),
      },
      {
        label: "stdio",
        hint: "For clients that only launch local commands, bridge through mcp-remote.",
        code: JSON.stringify({ mcpServers: { "diagram-ai": { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2),
      },
    ],
  };
}

const CLIENTS: { id: ClientId; name: string; color: string }[] = [
  { id: "claude", name: "Claude Code", color: "var(--agent-claude)" },
  { id: "codex", name: "Codex", color: "var(--agent-codex)" },
  { id: "other", name: "Other clients", color: "var(--agent-other)" },
];

const subscribeNoop = () => () => undefined;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 text-[11px] font-medium text-white/90 hover:bg-white/20"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Copy-paste instructions for connecting an MCP client to this app.
 * Used on the home page and in the editor's "Connect an agent" dialog.
 */
export function ConnectAgent({ className }: { className?: string }) {
  const [client, setClient] = useState<ClientId>("claude");
  // The server URL is this page's origin; resolved on the client to stay prerenderable.
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "http://localhost:3000");

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div role="tablist" aria-label="Agent" className="flex gap-1 rounded-xl bg-sunken p-1">
        {CLIENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={client === item.id}
            onClick={() => setClient(item.id)}
            className={cn(
              "flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition-colors",
              client === item.id ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink",
            )}
          >
            <span className="size-2 rounded-full" style={{ background: item.color }} />
            {item.name}
          </button>
        ))}
      </div>

      {snippets(origin)[client].map((snippet) => (
        <div key={snippet.label}>
          <p className="mb-1.5 text-[12px] text-ink-3">
            <span className="mr-1.5 font-mono text-[11px] font-semibold text-ink-2">{snippet.label}</span>
            {snippet.hint}
          </p>
          <div className="overflow-hidden rounded-xl bg-[#17150f] dark:bg-black/50">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
              <span className="font-mono text-[10.5px] tracking-wide text-white/50 uppercase">{snippet.label}</span>
              <CopyButton text={snippet.code} />
            </div>
            <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-[#ece9e1]">
              <code>{snippet.code}</code>
            </pre>
          </div>
        </div>
      ))}

      <p className="text-[12px] leading-relaxed text-ink-3">
        Then ask your agent something like <em className="font-display text-[14px] text-ink-2">“Draw the architecture of this repo as a C4 container diagram”</em> and watch it
        appear here.
      </p>
    </div>
  );
}
