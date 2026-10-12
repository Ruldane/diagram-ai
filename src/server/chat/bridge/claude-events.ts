import type { ChatStreamEvent } from "@/core/protocol";

import type { ToolResult } from "../../mcp/registry";
import { MCP_SERVER_ID, CLAUDE_MAX_TURNS } from "./args";
import { endedWithoutResult, EventSink, parseStructured, tailMessage, type BridgeMapper, type ProcessEnd } from "./sink";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const MCP_PREFIX = `mcp__${MCP_SERVER_ID}__`;

/** `mcp__diagram-ai__diagram_read` → `diagram_read`. Built-in tools keep their name. */
export function shortToolName(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
}

const baseName = (file: string): string => file.split(/[\\/]/).filter(Boolean).pop() ?? file;

/** The one line for a built-in tool (read-only file tools, offered only with a working folder). */
function builtinSummary(name: string, input: unknown): string | null {
  const args = isObject(input) ? input : {};
  switch (name) {
    case "Read":
      return `Read ${baseName(str(args.file_path)) || "a file"}`;
    case "Glob":
      return `Looked for files${str(args.pattern) ? ` matching ${str(args.pattern).slice(0, 60)}` : ""}`;
    case "Grep":
      return `Searched the files${str(args.pattern) ? ` for ${str(args.pattern).slice(0, 60)}` : ""}`;
    default:
      return null;
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (isObject(block) && block.type === "text" ? str(block.text) : "")).filter(Boolean).join("\n");
}

/** The one line for a failed built-in tool. A refusal says what was refused; anything else is the start of its message. */
function failureSummary(text: string): string {
  const refused = /^Permission to use (\S+) has been denied/.exec(text.trim());
  if (refused) return `Not allowed to use ${refused[1]} here`;
  const first = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  if (!first) return "Failed";
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

const SIGNED_OUT = /not logged in|please run \/login|\/login|invalid api key|authentication_error|oauth token|credentials/i;

/** Message for a `result` line that reports an error. */
function resultError(line: Json): string {
  const text = str(line.result).trim();
  const subtype = str(line.subtype);
  if (subtype === "error_max_turns") return `The assistant stopped after ${num(line.num_turns) || CLAUDE_MAX_TURNS} steps without finishing. Ask it to continue if more is needed.`;
  if (subtype === "error_max_budget_usd") return "Claude Code stopped because it reached its spending limit for this request.";
  if (SIGNED_OUT.test(text)) return "Claude Code says it is not signed in. Run `claude` once in a terminal to sign in, then try again.";
  if (text) return `Claude Code stopped: ${tailMessage(text, 280)}`;
  return `Claude Code stopped with an error (${subtype || "unknown"}).`;
}

/**
 * Maps Claude Code's `--output-format stream-json` lines to chat events.
 * Written against real transcripts (see `fixtures/`): `system/init` carries
 * the MCP connection status, `stream_event` wraps the API's streaming events,
 * `assistant` and `user` lines carry whole messages, `result` ends the run.
 */
export function createClaudeMapper(emit: (event: ChatStreamEvent) => void, options: { label?: string } = {}): BridgeMapper {
  const label = options.label ?? "Claude Code";
  const sink = new EventSink(emit);
  const streamed = new Set<string>();
  const names = new Map<string, string>();
  let sawResult = false;
  let fatal = false;

  const announce = (id: string, rawName: string, input?: unknown) => {
    const name = shortToolName(rawName);
    names.set(id, name);
    sink.toolRunning(id, name, input);
  };

  const onInit = (line: Json) => {
    const session = str(line.session_id);
    if (session) emit({ type: "session", id: session });
    const servers = Array.isArray(line.mcp_servers) ? line.mcp_servers.filter(isObject) : [];
    const ours = servers.find((server) => str(server.name) === MCP_SERVER_ID);
    const status = str(ours?.status);
    if (status === "connected") {
      emit({ type: "diagnostic", ok: true, message: `${label} is connected to this app's drawing tools${str(line.model) ? ` (model ${str(line.model)})` : ""}.` });
      return;
    }
    fatal = true;
    const why =
      status === "needs-auth"
        ? "the app's tool server asked for authentication"
        : status === "pending"
          ? "the app's tool server did not answer in time"
          : "it could not reach the app's tool server";
    const message = `${label} started but ${why}${status ? ` (status: ${status})` : ""}. Check that this app is reachable at the address you opened it from, then try again.`;
    emit({ type: "diagnostic", ok: false, message });
    sink.end(message);
  };

  const onStreamEvent = (line: Json) => {
    if (line.parent_tool_use_id) return;
    const event = isObject(line.event) ? line.event : {};
    switch (str(event.type)) {
      case "message_start": {
        const message = isObject(event.message) ? event.message : {};
        if (str(message.id)) streamed.add(str(message.id));
        break;
      }
      case "content_block_start": {
        const block = isObject(event.content_block) ? event.content_block : {};
        if (block.type === "text") sink.textBlockStart();
        else if (block.type === "tool_use") announce(str(block.id), str(block.name));
        break;
      }
      case "content_block_delta": {
        const delta = isObject(event.delta) ? event.delta : {};
        if (delta.type === "text_delta") sink.text(str(delta.text));
        break;
      }
    }
  };

  const onAssistant = (line: Json) => {
    if (line.parent_tool_use_id) return;
    const message = isObject(line.message) ? line.message : {};
    const content = Array.isArray(message.content) ? message.content.filter(isObject) : [];
    const alreadyStreamed = streamed.has(str(message.id));
    for (const block of content) {
      if (block.type === "tool_use") announce(str(block.id), str(block.name), block.input);
      else if (block.type === "text" && !alreadyStreamed) sink.paragraph(str(block.text));
    }
  };

  const onUser = (line: Json) => {
    if (line.parent_tool_use_id) return;
    const message = isObject(line.message) ? line.message : {};
    const content = Array.isArray(message.content) ? message.content.filter(isObject) : [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const id = str(block.tool_use_id);
      const name = names.get(id) ?? "tool";
      const text = resultText(block.content);
      const failed = block.is_error === true;
      const tool: ToolResult = { isError: failed, content: [{ type: "text", text }], structuredContent: parseStructured(text) };
      if (name.startsWith("diagram_")) {
        sink.toolDone(id, name, tool);
      } else {
        const summary = failed ? failureSummary(text) : (builtinSummary(name, sink.inputOf(id)) ?? name);
        sink.toolDoneWith(id, name, failed ? "error" : "done", summary, text.slice(0, 1500));
      }
    }
  };

  const onResult = (line: Json) => {
    sawResult = true;
    const usage = isObject(line.usage) ? line.usage : {};
    const cached = num(usage.cache_read_input_tokens);
    sink.usage({
      inputTokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + cached,
      outputTokens: num(usage.output_tokens),
      ...(cached ? { cachedTokens: cached } : {}),
    });
    const denials = Array.isArray(line.permission_denials) ? line.permission_denials.filter(isObject) : [];
    if (denials.length) {
      const denied = [...new Set(denials.map((denial) => shortToolName(str(denial.tool_name))).filter(Boolean))];
      emit({ type: "diagnostic", ok: false, message: `${label} was not allowed to use: ${denied.join(", ") || "a tool"}.` });
    }
    const failed = line.is_error === true || str(line.subtype).startsWith("error");
    sink.end(failed ? resultError(line) : undefined);
  };

  return {
    get fatal() {
      return fatal;
    },
    handleLine(raw) {
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isObject(line) || sink.finished) return;
      switch (str(line.type)) {
        case "system":
          if (line.subtype === "init") onInit(line);
          break;
        case "stream_event":
          onStreamEvent(line);
          break;
        case "assistant":
          onAssistant(line);
          break;
        case "user":
          onUser(line);
          break;
        case "result":
          onResult(line);
          break;
      }
    },
    finish(end: ProcessEnd) {
      if (sink.finished) return;
      if (sawResult) return sink.end();
      sink.end(endedWithoutResult(label, end));
    },
  };
}
