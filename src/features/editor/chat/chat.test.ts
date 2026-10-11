import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatStreamEvent } from "@/core/protocol";

import { formatTokens, toRequestMessages, totalUsage } from "./history";
import { parseInline, parseMarkdown } from "./parse-markdown";
import { applyChatEvent, createEventParser, messageSegments } from "./stream";

const message = (partial: Partial<ChatMessage> = {}): ChatMessage => ({ id: "m", role: "assistant", text: "", createdAt: "", ...partial });

describe("event parser", () => {
  it("reassembles events split across chunks and skips heartbeats and junk", () => {
    const events: ChatStreamEvent[] = [];
    const parser = createEventParser((event) => events.push(event));
    parser.push('{"type":"text","del');
    parser.push('ta":"Hi"}\n\n{"type":"tool","id":"t1","name":"diagram_read","status":"running"}\nnot json\n{"type":"mystery"}\n');
    parser.push('{"type":"done"}');
    expect(events).toHaveLength(2);
    parser.end();
    expect(events.map((event) => event.type)).toEqual(["text", "tool", "done"]);
  });
});

describe("applyChatEvent", () => {
  it("appends text and tracks each tool call from start to finish", () => {
    let current = message();
    const apply = (event: ChatStreamEvent) => (current = applyChatEvent(current, event));

    apply({ type: "text", delta: "I'll draw it." });
    apply({ type: "tool", id: "t1", name: "diagram_add_elements", status: "running" });
    apply({ type: "tool", id: "t1", name: "diagram_add_elements", status: "done", summary: "Added 2 nodes", detail: "Created 2 node(s)" });
    apply({ type: "text", delta: "\n\nDone." });
    apply({ type: "usage", inputTokens: 1200, outputTokens: 80, cachedTokens: 1000 });

    expect(current.text).toBe("I'll draw it.\n\nDone.");
    expect(current.tools).toEqual([
      { id: "t1", name: "diagram_add_elements", status: "done", summary: "Added 2 nodes", detail: "Created 2 node(s)", at: "I'll draw it.".length },
    ]);
    expect(current.usage).toEqual({ inputTokens: 1200, outputTokens: 80, cachedTokens: 1000 });
  });

  it("interleaves tool steps with the text written before and after them", () => {
    const reply = message({
      text: "First.\n\nSecond.",
      tools: [
        { id: "a", name: "diagram_read", status: "done", at: 6 },
        { id: "b", name: "diagram_add_elements", status: "done", at: 6 },
        { id: "c", name: "diagram_preview", status: "running", at: 15 },
      ],
    });
    const segments = messageSegments(reply);
    expect(segments.map((segment) => (segment.kind === "text" ? segment.text : segment.tools.map((tool) => tool.id).join("+")))).toEqual([
      "First.",
      "a+b",
      "Second.",
      "c",
    ]);
  });
});

describe("history", () => {
  const turn = (role: ChatMessage["role"], text: string): ChatMessage => message({ role, text });

  it("sends text only, without empty replies or leading assistant messages", () => {
    expect(toRequestMessages([turn("assistant", "Hi!"), turn("user", "draw"), turn("assistant", ""), turn("user", "again")])).toEqual([
      { role: "user", text: "draw" },
      { role: "user", text: "again" },
    ]);
  });

  it("keeps the newest messages when the conversation outgrows the limits", () => {
    const long = Array.from({ length: 45 }, (_, i) => turn(i % 2 ? "assistant" : "user", `message ${i}`));
    const sent = toRequestMessages(long);
    expect(sent.length).toBeLessThanOrEqual(30);
    expect(sent.at(-1)?.text).toBe("message 44");
    expect(sent[0].role).toBe("user");

    const big = toRequestMessages([turn("user", "x".repeat(9_000)), ...Array.from({ length: 6 }, () => turn("user", "y".repeat(9_000))), turn("user", "last")]);
    expect(big.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(48_000);
    expect(big.at(-1)?.text).toBe("last");
  });

  it("adds up usage and formats token counts", () => {
    expect(totalUsage([turn("user", "hi")])).toBeNull();
    const total = totalUsage([
      message({ usage: { inputTokens: 1000, outputTokens: 100, cachedTokens: 800 } }),
      message({ usage: { inputTokens: 1500, outputTokens: 200 } }),
    ]);
    expect(total).toEqual({ inputTokens: 2500, outputTokens: 300, cachedTokens: 800 });
    expect([formatTokens(950), formatTokens(1234), formatTokens(12_000), formatTokens(250_400)]).toEqual(["950", "1.2k", "12k", "250k"]);
  });
});

describe("markdown", () => {
  it("parses inline bold, italic and code, leaving other characters alone", () => {
    expect(parseInline("Use **diagram_add_elements** with `x` and *care*, 2 * 3.")).toEqual([
      { type: "text", text: "Use " },
      { type: "bold", text: "diagram_add_elements" },
      { type: "text", text: " with " },
      { type: "code", text: "x" },
      { type: "text", text: " and " },
      { type: "italic", text: "care" },
      { type: "text", text: ", 2 * 3." },
    ]);
  });

  it("parses paragraphs, lists, headings and fenced code", () => {
    const blocks = parseMarkdown("## Plan\nFirst line\nsecond line\n\n- one\n- **two**\n  continued\n\n1. a\n2. b\n\n```mermaid\ngraph TD\n```\n\nAfter");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "list", "code", "paragraph"]);
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[2].type === "list" && blocks[2].items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[4]).toEqual({ type: "code", text: "graph TD" });
  });

  it("copes with a reply that is still streaming", () => {
    expect(parseMarkdown("```\nunfinished")).toEqual([{ type: "code", text: "unfinished" }]);
    expect(parseInline("half **bold")).toEqual([{ type: "text", text: "half **bold" }]);
  });

  it("does not interpret HTML", () => {
    const [block] = parseMarkdown('<img src=x onerror="alert(1)">');
    expect(block).toEqual({ type: "paragraph", inline: [{ type: "text", text: '<img src=x onerror="alert(1)">' }] });
  });
});
