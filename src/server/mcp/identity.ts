import { slugify } from "@/core/model/ids";
import type { Actor } from "@/core/model/types";

/** Display names for the agents we can recognise from a path, header or client name. */
const KNOWN_AGENTS: { pattern: RegExp; id: string; name: string }[] = [
  { pattern: /claude/i, id: "claude-code", name: "Claude Code" },
  { pattern: /codex|openai/i, id: "codex", name: "Codex" },
  { pattern: /cursor/i, id: "cursor", name: "Cursor" },
  { pattern: /gemini/i, id: "gemini", name: "Gemini CLI" },
  { pattern: /copilot|vscode|visual studio code/i, id: "copilot", name: "GitHub Copilot" },
  { pattern: /windsurf|codeium/i, id: "windsurf", name: "Windsurf" },
  { pattern: /inspector/i, id: "mcp-inspector", name: "MCP Inspector" },
];

const DEFAULT_AGENT: Actor = { kind: "agent", id: "agent", name: "AI agent" };

/**
 * The endpoint is stateless, so tool calls do not carry the client name sent
 * during `initialize`. We remember it per User-Agent, which is stable for the
 * lifetime of an agent process.
 */
const globalRef = globalThis as typeof globalThis & { __diagramAiAgentNames?: Map<string, string> };
const rememberedNames = (globalRef.__diagramAiAgentNames ??= new Map<string, string>());

function fromHint(hint: string | null | undefined): Actor | null {
  const value = hint?.trim();
  if (!value) return null;
  const known = KNOWN_AGENTS.find((agent) => agent.pattern.test(value));
  if (known) return { kind: "agent", id: known.id, name: known.name };
  return null;
}

function custom(hint: string): Actor {
  const name = hint.trim().slice(0, 40);
  return { kind: "agent", id: slugify(name) || "agent", name };
}

/**
 * Works out which agent is calling, in order of reliability:
 * explicit URL segment or `?agent=` → `X-Agent-Name` header → the MCP client
 * name from `initialize` → the User-Agent header.
 */
export function identifyAgent(request: Request, pathHint: string | undefined, body: unknown): Actor {
  const url = new URL(request.url);
  const explicit = pathHint ?? url.searchParams.get("agent") ?? request.headers.get("x-agent-name");
  if (explicit?.trim()) return fromHint(explicit) ?? custom(explicit);

  const userAgent = request.headers.get("user-agent") ?? "";
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const { method, params } = message as { method?: unknown; params?: { clientInfo?: { name?: unknown } } };
    const clientName = method === "initialize" ? params?.clientInfo?.name : undefined;
    if (typeof clientName === "string" && clientName.trim()) rememberedNames.set(userAgent, clientName);
  }

  const remembered = rememberedNames.get(userAgent);
  return fromHint(remembered) ?? fromHint(userAgent) ?? (remembered ? custom(remembered) : DEFAULT_AGENT);
}
