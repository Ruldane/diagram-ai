import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { ToolResult } from "../mcp/registry";
import { describeChatError, MissingApiKeyError } from "./errors";
import { claudeApiEngine } from "./engines/claude-api";
import { supportsEffort } from "./config";
import { normalizeHistory } from "./request";
import { summarizeToolCall } from "./summary";

const ok = (text: string, structuredContent?: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text }], structuredContent });

describe("summarizeToolCall", () => {
  it("describes drawing in plain words", () => {
    const created = { nodes: ["a", "b", "c", "d"], edges: ["e1", "e2", "e3"] };
    expect(summarizeToolCall("diagram_add_elements", {}, ok("Created…", { created, updated: { nodes: [], edges: [] }, warnings: [] })).summary).toBe(
      "Added 4 nodes and 3 connectors",
    );
    expect(summarizeToolCall("diagram_add_elements", {}, ok("x", { created: { nodes: ["a"], edges: [] }, warnings: ["unknown shape"] })).summary).toBe(
      "Added 1 node (1 warning)",
    );
    expect(summarizeToolCall("diagram_update_elements", {}, ok("x", { updated: { nodes: ["a"], edges: ["e"] } })).summary).toBe("Updated 1 node and 1 connector");
    expect(summarizeToolCall("diagram_delete_elements", {}, ok("x", { removed: ["a", "b"] })).summary).toBe("Removed 2 elements");
    expect(summarizeToolCall("diagram_build_sequence", { participants: [{}, {}], messages: [{}, {}, {}] }, ok("x")).summary).toBe(
      "Built a sequence of 2 lifelines and 3 messages",
    );
    expect(summarizeToolCall("diagram_preview", {}, ok("Preview")).summary).toBe("Looked at the diagram");
  });

  it("treats `Error:` text as a failure even when the error flag is not set", () => {
    const outcome = summarizeToolCall("diagram_add_elements", {}, ok("Error: provide at least one node or edge."));
    expect(outcome).toMatchObject({ status: "error", summary: "provide at least one node or edge." });
  });

  it("falls back to the first line for tools it does not know", () => {
    expect(summarizeToolCall("diagram_future", {}, ok("Did a thing.\nWith details.")).summary).toBe("Did a thing.");
  });
});

describe("describeChatError", () => {
  const api = (status: number, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());

  it("gives each failure an actionable message", () => {
    expect(describeChatError(new MissingApiKeyError(), "m")).toMatch(/ANTHROPIC_API_KEY/);
    expect(describeChatError(api(401, "bad key"), "m")).toMatch(/\.env\.local/);
    expect(describeChatError(api(403, "no"), "claude-x")).toMatch(/claude-x/);
    expect(describeChatError(api(404, "model"), "claude-x")).toMatch(/DIAGRAM_AI_MODEL/);
    expect(describeChatError(api(429, "slow"), "m")).toMatch(/rate limit/);
    expect(describeChatError(api(529, "busy"), "m")).toMatch(/overloaded/);
    expect(describeChatError(api(500, "boom"), "m")).toMatch(/status 500/);
    expect(describeChatError(api(400, "Your credit balance is too low"), "m")).toMatch(/out of credit/);
  });

  it("is silent when the person cancelled and hides unexpected errors", () => {
    expect(describeChatError(new Anthropic.APIUserAbortError(), "m")).toBeNull();
    const unexpected = new Error("secret internals at C:\\app\\key=sk-ant-123");
    const message = describeChatError(unexpected, "m");
    expect(message).not.toContain("sk-ant");
    expect(message).toMatch(/server log/);
  });
});

describe("request handling", () => {
  it("drops empty and leading assistant messages and requires a final user message", () => {
    expect(
      normalizeHistory([
        { role: "assistant", text: "Welcome" },
        { role: "user", text: "hi" },
        { role: "assistant", text: "   " },
        { role: "user", text: "add a cache" },
      ]),
    ).toEqual([
      { role: "user", text: "hi" },
      { role: "user", text: "add a cache" },
    ]);
    expect(() => normalizeHistory([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }])).toThrow(/last message/);
  });

  it("rejects conversations over the size cap", () => {
    const big = "x".repeat(10_000);
    expect(() => normalizeHistory(Array.from({ length: 7 }, () => ({ role: "user" as const, text: big })))).toThrow(/too long/);
  });
});

describe("configuration", () => {
  it("reports only whether a key exists, never the key", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-123";
      const configured = await claudeApiEngine.status();
      expect(configured.available).toBe(true);
      expect(JSON.stringify(configured)).not.toContain("sk-ant");
      process.env.ANTHROPIC_API_KEY = "  ";
      expect((await claudeApiEngine.status()).available).toBe(false);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });

  it("knows which models accept thinking and effort settings", () => {
    for (const model of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-5-5", "claude-fable-5-1"]) {
      expect(supportsEffort(model), model).toBe(true);
    }
    for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "something-else"]) expect(supportsEffort(model), model).toBe(false);
  });
});
