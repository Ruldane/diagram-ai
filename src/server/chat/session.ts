import type { DiagramDoc } from "@/core/model/types";
import type { ChatStreamEvent } from "@/core/protocol";

import type { ToolContext } from "../mcp/toolkit";
import { buildSystemPrompt } from "./prompt";
import type { HistoryMessage } from "./request";
import { runAssistant, type ModelClient, type RunResult } from "./runner";
import { createAssistantToolset } from "./tools";

/** Shorter than the hub's "working" window, so the agent pill does not flicker while the model is thinking. */
const PRESENCE_BEAT_MS = 4_000;

export interface ChatSessionOptions {
  /** Tool context for this request; `actor` is who the edits are attributed to. */
  ctx: ToolContext;
  /** The diagram the person has open, as it is now. */
  doc: DiagramDoc;
  history: HistoryMessage[];
  client: ModelClient;
  model: string;
  emit(event: ChatStreamEvent): void;
  signal?: AbortSignal;
}

/**
 * One assistant request: builds the context (open diagram, the person's
 * selection) and the tool set, then runs the loop while keeping the agent
 * shown as working on the canvas.
 */
export async function runChatSession(options: ChatSessionOptions): Promise<RunResult> {
  const { ctx, doc, history, client, model, emit, signal } = options;
  const selection = ctx.hub.latestPresence(doc.id)?.selection ?? [];

  let activity = "thinking";
  const touch = () => ctx.hub.touchAgent(ctx.actor, activity, doc.id);
  touch();
  const beat = setInterval(touch, PRESENCE_BEAT_MS);

  try {
    return await runAssistant({
      client,
      model,
      system: buildSystemPrompt(doc, selection),
      tools: createAssistantToolset(ctx),
      history,
      signal,
      emit: (event) => {
        if (event.type === "tool") activity = event.name;
        emit(event);
      },
    });
  } finally {
    clearInterval(beat);
  }
}
