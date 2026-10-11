import Anthropic from "@anthropic-ai/sdk";

import type { ChatStreamEvent } from "@/core/protocol";

import type { ToolResult } from "../mcp/registry";
import type { ModelClient } from "./runner";
import type { AssistantToolset } from "./tools";

/**
 * Helpers for tests: a scripted stand-in for the Anthropic client, so the
 * runner can be exercised without a network or a key.
 */

export interface ScriptedTurn {
  content: Anthropic.ContentBlock[];
  stop_reason?: Anthropic.StopReason;
  usage?: Partial<Anthropic.Usage>;
}

export const textBlock = (text: string): Anthropic.ContentBlock => ({ type: "text", text, citations: null }) as Anthropic.ContentBlock;

export const toolUseBlock = (id: string, name: string, input: Record<string, unknown>): Anthropic.ContentBlock =>
  ({ type: "tool_use", id, name, input }) as unknown as Anthropic.ContentBlock;

function eventsFor(content: Anthropic.ContentBlock[]): Anthropic.MessageStreamEvent[] {
  const events: unknown[] = [];
  content.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else if (block.type === "tool_use") {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: "content_block_stop", index });
  });
  return events as Anthropic.MessageStreamEvent[];
}

function messageFor(turn: ScriptedTurn): Anthropic.Message {
  const hasTools = turn.content.some((block) => block.type === "tool_use");
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-fake",
    content: turn.content,
    stop_reason: turn.stop_reason ?? (hasTools ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null, ...turn.usage },
  } as unknown as Anthropic.Message;
}

/** A script is a list of turns, or a function of the call number and the request (to react to tool results). */
export type Script = ScriptedTurn[] | ((call: number, params: Anthropic.MessageStreamParams) => ScriptedTurn | Error);

export function fakeClient(script: Script): { client: ModelClient; calls: Anthropic.MessageStreamParams[] } {
  const calls: Anthropic.MessageStreamParams[] = [];
  const client: ModelClient = {
    messages: {
      stream(params, options) {
        // Snapshot: the runner keeps appending to the same messages array.
        calls.push(structuredClone(params));
        const next = typeof script === "function" ? script(calls.length, calls[calls.length - 1]) : script[calls.length - 1];
        return {
          async *[Symbol.asyncIterator]() {
            if (options?.signal?.aborted) throw new Anthropic.APIUserAbortError();
            if (next instanceof Error) throw next;
            if (!next) throw new Error(`The script has no turn ${calls.length}.`);
            for (const event of eventsFor(next.content)) yield event;
          },
          async finalMessage() {
            if (next instanceof Error) throw next;
            if (!next) throw new Error(`The script has no turn ${calls.length}.`);
            return messageFor(next);
          },
        };
      },
    },
  };
  return { client, calls };
}

/** A toolset whose tools are plain functions, for tests that do not need a diagram. */
export function fakeToolset(handlers: Record<string, (input: unknown) => ToolResult | Promise<ToolResult>>): AssistantToolset {
  return {
    definitions: Object.keys(handlers).map((name) => ({ name, description: name, input_schema: { type: "object" as const, properties: {} } })),
    async run(name, input) {
      const handler = handlers[name];
      if (!handler) return { isError: true, content: [{ type: "text", text: `Error: there is no tool named "${name}".` }] };
      return handler(input);
    },
  };
}

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

/** The `tool_result` blocks the runner sent back in the request with the given call number (1-based). */
export function toolResultsOf(calls: Anthropic.MessageStreamParams[], call: number): Anthropic.ToolResultBlockParam[] {
  const last = calls[call - 1].messages.at(-1);
  if (!last || typeof last.content === "string") return [];
  return last.content.filter((block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result");
}

export const collect = (): { events: ChatStreamEvent[]; emit: (event: ChatStreamEvent) => void } => {
  const events: ChatStreamEvent[] = [];
  return { events, emit: (event) => events.push(event) };
};
