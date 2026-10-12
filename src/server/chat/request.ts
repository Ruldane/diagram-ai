import { z } from "zod";

import { invalid } from "../errors";
import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "./config";

export const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(MAX_MESSAGE_CHARS) }))
    .min(1)
    .max(MAX_HISTORY_MESSAGES),
  clientId: z.string().max(80).optional(),
  selection: z.array(z.string().max(64)).max(500).optional(),
  viewport: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  engine: z.enum(["claude-code", "claude-api"]).optional(),
  sessionId: z.string().max(80).optional(),
  workdir: z.string().max(1000).optional(),
});

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Cleans the conversation the browser sent into what the API accepts: no
 * empty messages (a reply that failed before producing text), starting with a
 * user message and ending with one. Throws an `invalid` error otherwise.
 */
export function normalizeHistory(messages: HistoryMessage[]): HistoryMessage[] {
  const kept = messages.filter((message) => message.text.trim().length > 0);
  while (kept[0]?.role === "assistant") kept.shift();
  if (kept.at(-1)?.role !== "user") throw invalid("The last message must be from the user.");
  const size = kept.reduce((total, message) => total + message.text.length, 0);
  if (size > MAX_HISTORY_CHARS) throw invalid("This conversation is too long. Clear it and start again.");
  return kept;
}
