import type { ChatStreamEvent } from "@/core/protocol";

import type { ToolResult } from "../../mcp/registry";
import { MCP_SERVER_ID } from "./args";
import { endedWithoutResult, EventSink, tailMessage, type BridgeMapper, type ProcessEnd } from "./sink";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const SIGNED_OUT = /not logged in|log in|sign in|unauthori[sz]ed|401|authentication/i;

/** The text of an MCP tool result as Codex reports it: `{ content: [{type,text}], structured_content }`. */
function toToolResult(item: Json): ToolResult {
  const result = isObject(item.result) ? item.result : {};
  const content = Array.isArray(result.content) ? result.content.filter(isObject) : [];
  const text = content.map((block) => (block.type === "text" ? str(block.text) : "")).filter(Boolean).join("\n");
  const error = isObject(item.error) ? str(item.error.message) : str(item.error);
  const failed = Boolean(error) || str(item.status) === "failed";
  return {
    isError: failed,
    content: [{ type: "text", text: text || error || (failed ? "The tool call failed." : "") }],
    ...(isObject(result.structured_content) ? { structuredContent: result.structured_content } : {}),
  };
}

/**
 * Maps `codex exec --json` lines to chat events: `thread.started` gives the
 * id to resume, `item.*` carry messages and tool calls (whole, not streamed),
 * `turn.completed` ends the run with usage, `turn.failed` / `error` fail it.
 */
export function createCodexMapper(emit: (event: ChatStreamEvent) => void, options: { label?: string } = {}): BridgeMapper {
  const label = options.label ?? "Codex";
  const sink = new EventSink(emit);
  let sawTurnEnd = false;
  let lastError = "";

  const failure = (message: string): string => (SIGNED_OUT.test(message) ? `${label} says it is not signed in. Run \`codex login\` in a terminal, then try again.` : `${label} stopped: ${tailMessage(message, 280)}`);

  const onItem = (type: "started" | "completed", item: Json) => {
    const kind = str(item.type);
    const id = str(item.id);
    if (kind === "agent_message") {
      if (type === "completed") sink.paragraph(str(item.text));
      return;
    }
    if (kind === "mcp_tool_call") {
      const ours = str(item.server) === MCP_SERVER_ID;
      const name = str(item.tool) || "tool";
      sink.toolRunning(id, name, item.arguments);
      if (type !== "completed") return;
      const result = toToolResult(item);
      if (ours) {
        sink.toolDone(id, name, result);
      } else {
        const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
        sink.toolDoneWith(id, name, result.isError ? "error" : "done", result.isError ? tailMessage(text, 160) || "Failed" : `Used ${name}`, text.slice(0, 1500));
      }
      return;
    }
    if (kind === "command_execution") {
      const command = str(item.command).replace(/\s+/g, " ").trim().slice(0, 80);
      sink.toolRunning(id, "shell", undefined);
      if (type === "completed") {
        const failed = num(item.exit_code) !== 0 && item.exit_code !== undefined && item.exit_code !== null;
        sink.toolDoneWith(id, "shell", failed ? "error" : "done", `Ran ${command || "a command"}`, str(item.aggregated_output).slice(0, 1500));
      }
      return;
    }
    if (kind === "error") lastError = str(item.message) || lastError;
  };

  return {
    fatal: false,
    handleLine(raw) {
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isObject(line) || sink.finished) return;
      switch (str(line.type)) {
        case "thread.started":
          if (str(line.thread_id)) emit({ type: "session", id: str(line.thread_id) });
          break;
        case "item.started":
          if (isObject(line.item)) onItem("started", line.item);
          break;
        case "item.completed":
          if (isObject(line.item)) onItem("completed", line.item);
          break;
        case "turn.completed": {
          sawTurnEnd = true;
          const usage = isObject(line.usage) ? line.usage : {};
          const cached = num(usage.cached_input_tokens);
          sink.usage({ inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens), ...(cached ? { cachedTokens: cached } : {}) });
          sink.end();
          break;
        }
        case "turn.failed": {
          sawTurnEnd = true;
          const error = isObject(line.error) ? str(line.error.message) : "";
          sink.end(failure(error || lastError || "the turn failed"));
          break;
        }
        case "error":
          // Reported before `turn.failed` carries the final message; remember it in case that never comes.
          lastError = str(line.message) || lastError;
          break;
      }
    },
    finish(end: ProcessEnd) {
      if (sink.finished) return;
      if (sawTurnEnd) return sink.end();
      if (lastError && !end.aborted) return sink.end(failure(lastError));
      sink.end(endedWithoutResult(label, end));
    },
  };
}
