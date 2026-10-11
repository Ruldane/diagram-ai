import Anthropic from "@anthropic-ai/sdk";

import type { ChatEngineStatus } from "@/core/protocol";

import { chatApiKey, chatModel } from "../config";
import { MissingApiKeyError } from "../errors";
import { runChatSession } from "../session";
import type { Engine } from "./types";

/** The Claude API with an `ANTHROPIC_API_KEY`: billed to that API account, runs the tools in-process. */
export const claudeApiEngine: Engine = {
  id: "claude-api",
  local: false,

  async status(): Promise<ChatEngineStatus> {
    const configured = Boolean(chatApiKey());
    return {
      id: "claude-api",
      label: "Claude API",
      available: configured,
      reason: configured ? undefined : "Add ANTHROPIC_API_KEY to .env.local and restart the app.",
      billing: "api",
      needsAcknowledgement: false,
      model: chatModel(),
    };
  },

  async run({ ctx, doc, history, emit, signal }) {
    const apiKey = chatApiKey();
    if (!apiKey) throw new MissingApiKeyError();
    await runChatSession({ ctx, doc, history, client: new Anthropic({ apiKey }), model: chatModel(), emit, signal });
  },
};
