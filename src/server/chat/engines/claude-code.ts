import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ChatEngineStatus } from "@/core/protocol";

import { buildClaudeArgs, claudeMcpConfig, MODEL_NAME } from "../bridge/args";
import { resolveBinary } from "../bridge/binary";
import { bridgeDisabledReason } from "../bridge/gating";
import { bridgeBrief, bridgePrompt } from "../bridge/brief";
import { buildChildEnv } from "../bridge/child-env";
import { createClaudeMapper } from "../bridge/claude-events";
import { loginState } from "../bridge/login";
import { defaultBridgeWorkdir } from "../bridge/workdir";
import { runCli } from "./cli-run";
import type { Engine } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edits made through this engine arrive over MCP under this name, like any Claude Code session. */
const ACTOR = { kind: "agent", id: "claude-code", name: "Claude Code" } as const;

/** The person's own Claude Code CLI, on their plan. Never receives or reads credentials. */
export const claudeCodeEngine: Engine = {
  id: "claude-code",
  local: true,

  async status(): Promise<ChatEngineStatus> {
    const base = { id: "claude-code", label: "Claude Code", billing: "subscription", needsAcknowledgement: true } as const;
    const disabled = bridgeDisabledReason();
    if (disabled) return { ...base, available: false, reason: disabled };
    if (!resolveBinary("claude")) return { ...base, available: false, reason: "Claude Code not found. Install it, then reload." };

    const login = await loginState("claude");
    if (!login.installed || !login.loggedIn) return { ...base, available: false, reason: login.problem ?? "Not signed in. Run `claude` once in a terminal.", authMethod: login.authMethod };
    const apiKeyLogin = login.authMethod === "api_key" || login.authMethod === "api_key_helper";
    return {
      ...base,
      available: true,
      billing: apiKeyLogin ? "api" : "subscription",
      reason: apiKeyLogin ? "Claude Code is signed in with an API key, so this will use API billing." : undefined,
      authMethod: login.authMethod,
      model: process.env.DIAGRAM_AI_CLAUDE_MODEL?.trim() || undefined,
    };
  },

  async run(input) {
    const { emit, doc } = input;
    const binary = resolveBinary("claude");
    if (!binary) {
      emit({ type: "error", message: "Claude Code was not found. Install it, then reload." });
      emit({ type: "done" });
      return;
    }

    const resume = Boolean(input.sessionId && UUID.test(input.sessionId));
    const sessionId = resume ? (input.sessionId as string) : randomUUID();
    const configured = process.env.DIAGRAM_AI_CLAUDE_MODEL?.trim();
    const model = configured && MODEL_NAME.test(configured) ? configured : undefined;
    const cwd = input.workdir ?? defaultBridgeWorkdir();
    const shim = binary.kind === "shim";

    const runDir = await mkdtemp(path.join(os.tmpdir(), "diagram-ai-bridge-"));
    try {
      const mcpConfigFile = path.join(runDir, "mcp.json");
      await writeFile(mcpConfigFile, claudeMcpConfig(`${input.ctx.baseUrl}/api/mcp/claude-code`), "utf8");

      const brief = bridgeBrief(doc, input.selection, { folderName: input.workdir ? path.basename(input.workdir) : undefined });
      const prompt = bridgePrompt(input.history, resume);
      await runCli({
        input,
        actor: ACTOR,
        binary,
        // A shell shim cannot carry a long multi-line argument safely, so the brief travels with the prompt there.
        args: buildClaudeArgs({ sessionId, resume, mcpConfigFile, fileTools: Boolean(input.workdir), model, brief: shim ? undefined : brief }),
        cwd,
        env: buildChildEnv("claude"),
        stdin: shim ? `${brief}\n\n---\n\n${prompt}` : prompt,
        mapper: createClaudeMapper(emit),
      });
    } finally {
      await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
