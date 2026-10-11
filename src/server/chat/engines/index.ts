import type { ChatEngineId, ChatEngineStatus, ChatStatusResponse } from "@/core/protocol";

import { assertLocalRequest } from "../bridge/gating";
import { ServiceError } from "../../errors";
import { claudeApiEngine } from "./claude-api";
import { claudeCodeEngine } from "./claude-code";
import type { Engine } from "./types";

/**
 * In order of preference: the person's own plan first, then an API key.
 * Codex is deliberately not bridged (see docs/assistant.md); `./codex.ts` is
 * unreferenced and is slated for deletion.
 */
export const ENGINES: readonly Engine[] = [claudeCodeEngine, claudeApiEngine];

export function getEngine(id: ChatEngineId): Engine {
  const engine = ENGINES.find((candidate) => candidate.id === id);
  if (!engine) throw new ServiceError("invalid", `Unknown assistant engine "${id}".`);
  return engine;
}

/** Why a local engine cannot be used from this request (not on this computer, or behind a proxy), or `null`. */
function requestProblem(request: Request): string | null {
  try {
    assertLocalRequest(request);
    return null;
  } catch (error) {
    return error instanceof ServiceError ? error.message : "Not available for this request.";
  }
}

/** The engines and which one to use when the browser does not say. Never contains keys or tokens. */
export async function engineStatuses(request: Request): Promise<ChatStatusResponse> {
  const notLocal = requestProblem(request);
  const engines: ChatEngineStatus[] = await Promise.all(
    ENGINES.map(async (engine) => {
      const status = await engine.status();
      if (engine.local && status.available && notLocal) return { ...status, available: false, reason: notLocal };
      return status;
    }),
  );
  const preferred = engines.find((status) => status.available);
  return { engines, default: preferred?.id ?? null };
}
