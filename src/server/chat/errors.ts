import Anthropic from "@anthropic-ai/sdk";

import { ServiceError } from "../errors";

export const MISSING_KEY_MESSAGE =
  "The assistant is not set up yet. Add ANTHROPIC_API_KEY to .env.local, then restart the dev server. Usage is billed to your Anthropic API account.";

export class MissingApiKeyError extends Error {
  constructor() {
    super(MISSING_KEY_MESSAGE);
    this.name = "MissingApiKeyError";
  }
}

/** The text of an API error body, without the status prefix the SDK puts in `message`. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const nested = body?.error?.message ?? body?.message;
  return typeof nested === "string" ? nested : "";
}

/**
 * A friendly, actionable message for anything that can go wrong in a run, or
 * `null` when the person cancelled. Never includes the API key or a stack:
 * unexpected errors are logged on the server and summarised here.
 */
export function describeChatError(error: unknown, model: string): string | null {
  if (error instanceof Anthropic.APIUserAbortError) return null;
  if (error instanceof MissingApiKeyError) return error.message;
  if (error instanceof ServiceError) return error.message;

  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local (it may be mistyped, revoked or from another workspace), then restart the dev server.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `This API key is not allowed to use ${model}. Use a key with access to it, or set DIAGRAM_AI_MODEL in .env.local to another model.`;
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `The model "${model}" was not found for this API key. Check DIAGRAM_AI_MODEL in .env.local, or remove it to use the default.`;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic's rate limit was reached. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    const detail = apiMessage(error);
    if (/credit balance|billing/i.test(detail)) {
      return "Your Anthropic API account is out of credit. Add credits in the Anthropic Console (Plans & Billing), then try again.";
    }
    return `Anthropic could not process this request${detail ? `: ${detail.slice(0, 240)}` : "."}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check your internet connection and try again.";
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 529) return "Anthropic's API is overloaded right now. Try again in a minute.";
    if (typeof error.status === "number" && error.status >= 500) {
      return `Anthropic's API had a temporary problem (status ${error.status}). Try again in a moment.`;
    }
    return `Anthropic returned an error (status ${error.status ?? "unknown"}).`;
  }

  // Log what we know without risking secrets: the object itself may carry request details.
  console.error("[diagram-ai] Assistant failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
  return "The assistant hit an unexpected problem. Check the server log for details and try again.";
}
