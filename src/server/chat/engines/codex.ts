import path from "node:path";

import type { ChatEngineStatus } from "@/core/protocol";

import { buildCodexArgs } from "../bridge/args";
import { resolveBinary } from "../bridge/binary";
import { bridgeBrief, bridgePrompt } from "../bridge/brief";
import { buildChildEnv } from "../bridge/child-env";
import { createCodexMapper } from "../bridge/codex-events";
import { bridgeDisabledReason } from "../bridge/gating";
import { loginState } from "../bridge/login";
import { defaultBridgeWorkdir } from "../bridge/workdir";
import { runCli } from "./cli-run";
import type { Engine } from "./types";

const ACTOR = { kind: "agent", id: "codex", name: "Codex" } as const;

/** The person's own Codex CLI, on their ChatGPT plan (or whatever it is signed in with). */
export const codexEngine: Engine = {
  id: "codex",
  local: true,

  async status(): Promise<ChatEngineStatus> {
    const base = { id: "codex", label: "Codex", billing: "subscription", needsAcknowledgement: true } as const;
    const disabled = bridgeDisabledReason();
    if (disabled) return { ...base, available: false, reason: disabled };
    if (!resolveBinary("codex")) return { ...base, available: false, reason: "Codex not found. Install it, then reload." };

    const login = await loginState("codex");
    if (!login.installed || !login.loggedIn) return { ...base, available: false, reason: login.problem ?? "Not signed in. Run `codex login` in a terminal." };
    const apiKeyLogin = login.authMethod === "api_key";
    return {
      ...base,
      available: true,
      billing: apiKeyLogin ? "api" : "subscription",
      reason: apiKeyLogin ? "Codex is signed in with an API key, so this will use API billing." : undefined,
      authMethod: login.authMethod,
    };
  },

  async run(input) {
    const { emit, doc } = input;
    const binary = resolveBinary("codex");
    if (!binary) {
      emit({ type: "error", message: "Codex was not found. Install it, then reload." });
      emit({ type: "done" });
      return;
    }

    const resume = Boolean(input.sessionId && /^[0-9a-z-]{8,64}$/i.test(input.sessionId));
    // Codex has no system-prompt flag: the brief and the context are part of the message.
    const brief = bridgeBrief(doc, input.selection, { folderName: input.workdir ? path.basename(input.workdir) : undefined });
    const prompt = `${brief}\n\n---\n\n${bridgePrompt(input.history, resume)}`;

    await runCli({
      input,
      actor: ACTOR,
      binary,
      args: buildCodexArgs({ threadId: resume ? input.sessionId : undefined, mcpUrl: `${input.ctx.baseUrl}/api/mcp/codex` }),
      cwd: input.workdir ?? defaultBridgeWorkdir(),
      env: buildChildEnv("codex"),
      stdin: prompt,
      mapper: createCodexMapper(emit),
    });
  },
};
