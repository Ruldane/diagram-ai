import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatStreamEvent } from "@/core/protocol";

import { createClaudeMapper, shortToolName } from "./claude-events";
import type { BridgeMapper, ProcessEnd } from "./sink";

/** Real transcripts captured from Claude Code 2.1.296 (see `fixtures/`), trimmed of personal paths. */
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

  it("maps a transcript captured from the real CLI: first message of a new session", () => {
    const { events } = run(createClaudeMapper, fixture("claude-real-first-turn.jsonl"));
    expect(events[0]).toEqual({ type: "session", id: "6c7ac486-9b30-46a8-9375-e2e348fc34c0" });
    expect(events[1]).toMatchObject({ type: "diagnostic", ok: true, message: expect.stringContaining("claude-haiku-5-5") });
    // The name is announced as soon as the block starts; the summary comes from the tool result.
    expect(tools(events)).toEqual(["diagram_add_elements:running", "diagram_add_elements:done:Added 1 node"]);
    expect(text(events)).toBe("done");
    expect(events.find((event) => event.type === "usage")).toMatchObject({ inputTokens: 4 + 19719 + 19504, outputTokens: 130, cachedTokens: 19504 });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(types(events).filter((type) => type === "done")).toHaveLength(1);
  });

  it("maps a transcript captured from the real CLI: the resumed second message", () => {
    const { events } = run(createClaudeMapper, fixture("claude-real-resume.jsonl"));
    // `--resume` keeps the session id, so the browser keeps resuming the same conversation.
    expect(events[0]).toEqual({ type: "session", id: "6c7ac486-9b30-46a8-9375-e2e348fc34c0" });
    expect(tools(events)).toEqual(["diagram_add_elements:running", "diagram_add_elements:done:Added 1 node and 1 connector"]);
    expect(text(events)).toBe('Added a "World" node and connected it from "Hello" with an arrow.');
    expect(events.find((event) => event.type === "error")).toBeUndefined();
  });

  it("maps a real run in which file reads outside the allowed folder were refused", () => {
    const { events } = run(createClaudeMapper, fixture("claude-real-permission-denied.jsonl"));
    const calls = events.filter((event) => event.type === "tool" && event.status !== "running");
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call).toMatchObject({ status: "error", summary: expect.stringMatching(/^Not allowed to use (Read|Grep) here$/) });
    expect(events).toContainEqual({ type: "diagnostic", ok: false, message: expect.stringContaining("Read, Grep") });
    // A refusal is not a failed run: the model still answered.
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(text(events)).toContain("denied");
    expect(events.at(-1)).toEqual({ type: "done" });
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
