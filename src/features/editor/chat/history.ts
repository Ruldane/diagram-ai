import type { ChatMessage, ChatRequest, ChatUsage } from "@/core/protocol";

/** Longest prompt the composer accepts. The server allows a little more per message. */
export const MAX_PROMPT_CHARS = 8_000;

/** Kept below the server's limits (40 messages, 60k characters) so a long conversation never gets a 400. */
const MAX_MESSAGES = 30;
const MAX_CHARS = 48_000;
const MAX_MESSAGE_CHARS = 10_000;

/**
 * The part of the conversation worth sending: text only (the model re-reads
 * the diagram with its tools), newest messages first when space runs out.
 */
export function toRequestMessages(messages: ChatMessage[]): ChatRequest["messages"] {
  const kept = messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({ role: message.role, text: message.text.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_MESSAGES);

  let size = kept.reduce((total, message) => total + message.text.length, 0);
  while (kept.length > 1 && size > MAX_CHARS) size -= kept.shift()!.text.length;
  while (kept[0]?.role === "assistant") kept.shift();
  return kept;
}

/** Tokens used across a conversation, for the usage line. */
export function totalUsage(messages: ChatMessage[]): ChatUsage | null {
  let total: ChatUsage | null = null;
  for (const message of messages) {
    if (!message.usage) continue;
    total ??= { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    total.inputTokens += message.usage.inputTokens;
    total.outputTokens += message.usage.outputTokens;
    total.cachedTokens = (total.cachedTokens ?? 0) + (message.usage.cachedTokens ?? 0);
  }
  return total;
}

/** 1234 → "1.2k". */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 100_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(count / 1_000)}k`;
}
