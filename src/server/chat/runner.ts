import type Anthropic from "@anthropic-ai/sdk";

import type { ChatStreamEvent, ChatUsage } from "@/core/protocol";

import type { ToolResult } from "../mcp/registry";
import { CHAT_EFFORT, MAX_OUTPUT_TOKENS, MAX_TURNS, supportsEffort } from "./config";
import { describeChatError } from "./errors";
import type { HistoryMessage } from "./request";
import { summarizeToolCall } from "./summary";
import type { AssistantToolset } from "./tools";

/**
 * The slice of the Anthropic SDK the loop uses. `new Anthropic()` satisfies it;
 * tests pass a scripted fake, so nothing here touches the network.
 */
export interface ModelStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

export interface ModelClient {
  messages: {
    stream(params: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): ModelStream;
  };
}

export interface RunOptions {
  client: ModelClient;
  model: string;
  system: Anthropic.TextBlockParam[];
  tools: AssistantToolset;
  /** The conversation, ending with the new user message. */
  history: HistoryMessage[];
  emit(event: ChatStreamEvent): void;
  /** Aborted when the browser goes away or the person presses stop. */
  signal?: AbortSignal;
  maxTurns?: number;
  maxTokens?: number;
}

export interface RunResult {
  status: "done" | "aborted" | "error" | "step-limit";
  /** Model calls made. */
  turns: number;
  usage: ChatUsage;
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const IMAGE_TYPES: ReadonlySet<string> = new Set<ImageMediaType>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Tool output as `tool_result` content: the text, then any images (`diagram_preview`) as image blocks. */
function toResultContent(result: ToolResult): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const block of result.content) {
    if (block.type === "text") {
      if (block.text) blocks.push({ type: "text", text: block.text });
    } else if (IMAGE_TYPES.has(block.mimeType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: block.mimeType as ImageMediaType, data: block.data } });
    }
  }
  return blocks.length ? blocks : "(no output)";
}

/**
 * The conversation as sent, with a cache breakpoint on its last block so the
 * next turn re-reads everything before it from the prompt cache. Returns a
 * copy; the stored messages (and the assistant turns in them, which must be
 * passed back unchanged) are never touched.
 */
function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return messages;
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const tail = blocks.at(-1);
  if (!tail) return messages;
  blocks[blocks.length - 1] = { ...tail, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { role: "user", content: blocks }];
}

/**
 * The tool-use loop: stream a model turn (text goes to the browser as it is
 * written), run the tools it asked for, send the results back, and repeat
 * until it answers without tools. Bounded by `maxTurns`; stops promptly on
 * abort. Always ends the event stream with `done`, preceded by `error` when
 * something went wrong.
 */
export async function runAssistant(options: RunOptions): Promise<RunResult> {
  const { client, model, system, tools, emit, signal } = options;
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS;

  const messages: Anthropic.MessageParam[] = options.history.map((message) => ({ role: message.role, content: message.text }));
  const usage = { input: 0, output: 0, cached: 0 };
  let turns = 0;
  let wroteText = false;
  /** Tool calls announced to the browser and not yet finished. */
  const announced = new Map<string, string>();

  const finish = (status: RunResult["status"], error?: string): RunResult => {
    for (const [id, name] of announced) emit({ type: "tool", id, name, status: "error", summary: "Not run" });
    announced.clear();
    if (error) emit({ type: "error", message: error });
    const total: ChatUsage = { inputTokens: usage.input, outputTokens: usage.output, ...(usage.cached ? { cachedTokens: usage.cached } : {}) };
    if (usage.input || usage.output) emit({ type: "usage", ...total });
    emit({ type: "done" });
    return { status, turns, usage: total };
  };

  try {
    while (turns < maxTurns) {
      if (signal?.aborted) return finish("aborted");
      turns++;

      const stream = client.messages.stream(
        {
          model,
          max_tokens: maxTokens,
          system,
          tools: tools.definitions,
          messages: withCacheBreakpoint(messages),
          ...(supportsEffort(model) ? { thinking: { type: "adaptive" as const }, output_config: { effort: CHAT_EFFORT } } : {}),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "text" && wroteText) emit({ type: "text", delta: "\n\n" });
          if (block.type === "tool_use") {
            announced.set(block.id, block.name);
            emit({ type: "tool", id: block.id, name: block.name, status: "running" });
          }
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          wroteText = true;
          emit({ type: "text", delta: event.delta.text });
        }
      }

      const message = await stream.finalMessage();
      usage.output += message.usage.output_tokens;
      usage.cached += message.usage.cache_read_input_tokens ?? 0;
      usage.input += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);

      // Appended exactly as received: thinking blocks must be passed back unchanged.
      messages.push({ role: "assistant", content: message.content });

      const toolUses = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      if (message.stop_reason === "refusal") {
        return finish("error", "The model declined to continue with this request. Try rephrasing it.");
      }
      if (message.stop_reason === "max_tokens") {
        // A tool input cut off at the limit can still parse; never run it.
        return finish(
          "error",
          toolUses.length
            ? "The assistant ran out of room while drawing a large change. Ask for a smaller part of the diagram at a time."
            : "The reply was cut off because it reached the length limit. Ask the assistant to continue.",
        );
      }
      if (!toolUses.length) return finish("done");

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses) {
        if (signal?.aborted) return finish("aborted");
        announced.set(block.id, block.name);
        emit({ type: "tool", id: block.id, name: block.name, status: "running" });

        let result: ToolResult;
        try {
          result = await tools.run(block.name, block.input);
        } catch (error) {
          const text = error instanceof Error ? error.message : "unexpected failure";
          result = { isError: true, content: [{ type: "text", text: `Error: ${text}. Nothing was changed.` }] };
        }

        const outcome = summarizeToolCall(block.name, block.input, result);
        announced.delete(block.id);
        emit({ type: "tool", id: block.id, name: block.name, status: outcome.status, summary: outcome.summary, detail: outcome.detail });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: toResultContent(result),
          ...(outcome.status === "error" ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
    }

    return finish("step-limit", `The assistant stopped after ${maxTurns} steps without finishing. Ask it to continue if more is needed.`);
  } catch (error) {
    const message = describeChatError(error, model);
    if (message === null || signal?.aborted) return finish("aborted");
    return finish("error", message);
  }
}
