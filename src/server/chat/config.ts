import type { Actor } from "@/core/model/types";

/** Used when `DIAGRAM_AI_MODEL` is not set. */
export const DEFAULT_CHAT_MODEL = "claude-sonnet-5-5";

/** Who the assistant's edits are attributed to: shows up as an agent on the canvas and in Activity. */
export const ASSISTANT_ACTOR: Actor = { kind: "agent", id: "assistant", name: "Assistant" };

/** Model calls per request. Each call may run several tools; this bounds cost if the model loops. */
export const MAX_TURNS = 15;

/** Output ceiling per model call (thinking included). Large `diagram_add_elements` calls need room. */
export const MAX_OUTPUT_TOKENS = 32_000;

/** Thinking depth: `medium` is the recommended starting point for multi-step tool use on current models. */
export const CHAT_EFFORT = "medium";

/** Request limits, enforced by the endpoint and respected by the client. */
export const MAX_HISTORY_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 10_000;
export const MAX_HISTORY_CHARS = 60_000;

/** The key lives in the server's environment only; it is never sent to the browser. */
export function chatApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export function chatModel(): string {
  return process.env.DIAGRAM_AI_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

/**
 * Models that take adaptive thinking and the `effort` setting. Others (for
 * example Haiku 4.5) reject both, so the parameters are only sent to these.
 */
export function supportsEffort(model: string): boolean {
  return /^claude-(?:(?:fable|mythos)-5|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|haiku-5)/.test(model);
}
