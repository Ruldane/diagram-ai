import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatStreamEvent } from "@/core/protocol";

import { createClaudeMapper, shortToolName } from "./claude-events";
import { createCodexMapper } from "./codex-events";
import type { BridgeMapper, ProcessEnd } from "./sink";

/** Real transcripts captured from Claude Code 2.1.296 and codex-cli 0.155.1 (see `fixtures/`), trimmed of personal paths. */
const fixture = (name: string): string[] =>
  readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8").split("\n").filter(Boolean);

const CLEAN_EXIT: ProcessEnd = { exitCode: 0, stderrTail: "", aborted: false, timedOut: false };

function play(mapper: BridgeMapper, lines: string[], end: ProcessEnd = CLEAN_EXIT): void {
  for (const line of lines) mapper.handleLine(line);
  mapper.finish(end);
}

function run(make: (emit: (event: ChatStreamEvent) => void) => BridgeMapper, lines: string[], end?: ProcessEnd) {
  const events: ChatStreamEvent[] = [];
  const mapper = make((event) => events.push(event));
  play(mapper, lines, end);
  return { events, mapper };
}

const text = (events: ChatStreamEvent[]) => events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");
const types = (events: ChatStreamEvent[]) => events.map((event) => event.type);
const tools = (events: ChatStreamEvent[]) =>
  events.flatMap((event) => (event.type === "tool" ? [`${event.name}:${event.status}${event.summary ? `:${event.summary}` : ""}`] : []));

describe("Claude Code stream-json", () => {
  it("maps a real run that listed diagrams, drew a node and answered", () => {
    const { events } = run(createClaudeMapper, fixture("claude-success.jsonl"));

    expect(events[0]).toMatchObject({ type: "session" });
    expect(events[1]).toMatchObject({ type: "diagnostic", ok: true });
    expect(tools(events)).toEqual([
      "diagram_list:running",
      "diagram_list:done:Listed the diagrams",
      "diagram_add_elements:running",
      "diagram_add_elements:done:Added 1 node",
    ]);
    expect(text(events)).toBe("done");
    // The answer text is not repeated from the whole `assistant` message that follows the deltas.
    expect(events.filter((event) => event.type === "text")).toHaveLength(1);
    expect(events.at(-2)).toMatchObject({ type: "usage" });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(types(events).filter((type) => type === "done")).toHaveLength(1);
  });

  it("counts cached prompt tokens in the usage it reports", () => {
    const { events } = run(createClaudeMapper, fixture("claude-success.jsonl"));
    const usage = events.find((event) => event.type === "usage");
    expect(usage).toMatchObject({ type: "usage" });
    if (usage?.type !== "usage") return;
    expect(usage.inputTokens).toBeGreaterThan(usage.cachedTokens ?? 0);
    expect(usage.cachedTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });

  it("reports a tool result flagged as an error from a resumed session", () => {
    const { events } = run(createClaudeMapper, fixture("claude-resume-tool-error.jsonl"));
    const failed = events.find((event) => event.type === "tool" && event.status === "error");
    expect(failed).toMatchObject({ name: "diagram_read", status: "error", summary: expect.stringContaining("No diagram with id") });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("fails clearly, and asks to stop the process, when the app's tools did not connect", () => {
    const { events, mapper } = run(createClaudeMapper, fixture("claude-mcp-down.jsonl"));
    expect(mapper.fatal).toBe(true);
    expect(events[1]).toMatchObject({ type: "diagnostic", ok: false });
    expect(events.find((event) => event.type === "error")).toMatchObject({ message: expect.stringMatching(/could not reach the app's tool server \(status: failed\)/) });
    // Nothing after the failure leaks through, and the stream still ends once.
    expect(text(events)).toBe("");
    expect(types(events).filter((type) => type === "done")).toHaveLength(1);
  });

  it("does not trust a clean exit code without a result line", () => {
    const lines = fixture("claude-success.jsonl").filter((line) => !line.includes('"type":"result"'));
    const { events } = run(createClaudeMapper, lines, { ...CLEAN_EXIT, stderrTail: "Error: something broke\n" });
    expect(events.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("ended without an answer") });
    expect(events.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("something broke") });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("maps error result subtypes and permission denials", () => {
    const init = fixture("claude-success.jsonl")[0];
    const result = (extra: Record<string, unknown>) => JSON.stringify({ type: "result", is_error: true, usage: {}, ...extra });

    const turns = run(createClaudeMapper, [init, result({ subtype: "error_max_turns", num_turns: 20 })]).events;
    expect(turns.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("20 steps") });

    const signedOut = run(createClaudeMapper, [init, result({ subtype: "success", result: "Invalid API key · Please run /login" })]).events;
    expect(signedOut.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("not signed in") });

    const denied = run(createClaudeMapper, [init, JSON.stringify({ type: "result", subtype: "success", is_error: false, usage: {}, permission_denials: [{ tool_name: "Bash" }] })]).events;
    expect(denied).toContainEqual({ type: "diagnostic", ok: false, message: expect.stringContaining("Bash") });
  });

  it("ignores junk lines and strips the MCP prefix from tool names", () => {
    const { events } = run(createClaudeMapper, ["not json", "", "[1,2]", ...fixture("claude-success.jsonl")]);
    expect(types(events).at(-1)).toBe("done");
    expect(shortToolName("mcp__diagram-ai__diagram_read")).toBe("diagram_read");
    expect(shortToolName("Read")).toBe("Read");
  });

  it("closes out an aborted run without reporting an error", () => {
    const lines = fixture("claude-success.jsonl").slice(0, 8);
    const { events } = run(createClaudeMapper, lines, { exitCode: null, stderrTail: "", aborted: true, timedOut: false });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
    // A call that had been announced is not left spinning.
    const running = events.filter((event) => event.type === "tool" && event.status === "running");
    const closed = events.filter((event) => event.type === "tool" && event.status !== "running");
    expect(closed.length).toBe(running.length);
  });
});

describe("Codex exec --json", () => {
  it("maps a real run that called an MCP tool and answered", () => {
    const { events } = run(createCodexMapper, fixture("codex-success.jsonl"));
    expect(events[0]).toEqual({ type: "session", id: "01a12c48-38f9-7741-9302-ef808b5da79b" });
    expect(tools(events)).toEqual(["diagram_list:running", "diagram_list:done:Listed the diagrams"]);
    expect(text(events)).toBe("I’ll call diagram_list once.\n\ndone");
    expect(events.find((event) => event.type === "usage")).toMatchObject({ inputTokens: 61729, outputTokens: 82, cachedTokens: 52224 });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("maps failures and failed tool calls", () => {
    const failedTurn = run(createCodexMapper, [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"error","message":"stream disconnected"}',
      '{"type":"turn.failed","error":{"message":"You are not logged in. Please sign in."}}',
    ]).events;
    expect(failedTurn.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("not signed in") });

    const toolFailure = run(createCodexMapper, [
      '{"type":"item.started","item":{"id":"i1","type":"mcp_tool_call","server":"diagram-ai","tool":"diagram_read","arguments":{},"result":null,"error":null,"status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"i1","type":"mcp_tool_call","server":"diagram-ai","tool":"diagram_read","arguments":{},"result":null,"error":{"message":"No diagram with id x"},"status":"failed"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
    ]).events;
    expect(tools(toolFailure)).toEqual(["diagram_read:running", "diagram_read:error:No diagram with id x"]);
  });

  it("reports an exit without a turn result", () => {
    const { events } = run(createCodexMapper, ['{"type":"thread.started","thread_id":"t"}'], { exitCode: 2, stderrTail: "boom", aborted: false, timedOut: false });
    expect(events.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("exit code 2") });
  });
});
