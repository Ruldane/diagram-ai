import type { ChatMessage, ChatStreamEvent, ChatToolCall } from "@/core/protocol";

const EVENT_TYPES: ReadonlySet<string> = new Set(["text", "tool", "usage", "error", "session", "diagnostic", "done"]);

function isEvent(value: unknown): value is ChatStreamEvent {
  return typeof value === "object" && value !== null && EVENT_TYPES.has((value as { type?: unknown }).type as string);
}

/**
 * Turns the response body (newline-delimited JSON, arriving in arbitrary
 * chunks) into events. Blank lines are heartbeats; lines that are not events
 * are ignored so the server can add new kinds without breaking old tabs.
 */
export function createEventParser(onEvent: (event: ChatStreamEvent) => void): { push(chunk: string): void; end(): void } {
  let buffer = "";

  const handle = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    try {
      const value: unknown = JSON.parse(line);
      if (isEvent(value)) onEvent(value);
    } catch {
      // A damaged line is not worth failing the whole reply for.
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    end() {
      handle(buffer);
      buffer = "";
    },
  };
}

/** Folds one streamed event into the assistant message it belongs to. */
export function applyChatEvent(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  switch (event.type) {
    case "text":
      return { ...message, text: message.text + event.delta };
    case "tool": {
      const tools = message.tools ?? [];
      const index = tools.findIndex((tool) => tool.id === event.id);
      const previous = index >= 0 ? tools[index] : undefined;
      const next: ChatToolCall = {
        id: event.id,
        name: event.name,
        status: event.status,
        summary: event.summary ?? previous?.summary,
        detail: event.detail ?? previous?.detail,
        at: previous?.at ?? message.text.length,
      };
      return { ...message, tools: previous ? tools.map((tool, i) => (i === index ? next : tool)) : [...tools, next] };
    }
    case "usage":
      return { ...message, usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedTokens: event.cachedTokens } };
    case "diagnostic":
      return { ...message, diagnostic: { ok: event.ok, message: event.message } };
    default:
      return message;
  }
}

export type Segment = { kind: "text"; text: string } | { kind: "steps"; tools: ChatToolCall[] };

/**
 * Interleaves a reply's text with its tool calls in the order they happened:
 * each call remembers how much text had been written when it started.
 */
export function messageSegments(message: ChatMessage): Segment[] {
  const segments: Segment[] = [];
  const pushText = (text: string) => {
    if (text.trim()) segments.push({ kind: "text", text: text.trim() });
  };
  const tools = [...(message.tools ?? [])].sort((a, b) => (a.at ?? message.text.length) - (b.at ?? message.text.length));

  let cursor = 0;
  for (const tool of tools) {
    const at = Math.min(Math.max(tool.at ?? message.text.length, cursor), message.text.length);
    pushText(message.text.slice(cursor, at));
    cursor = at;
    const last = segments.at(-1);
    if (last?.kind === "steps") last.tools.push(tool);
    else segments.push({ kind: "steps", tools: [tool] });
  }
  pushText(message.text.slice(cursor));
  return segments;
}
