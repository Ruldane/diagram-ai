import { rmSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, it, vi } from "vitest";

// The file repository reads its location when `config.ts` loads, so set it first.
const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/diagram-ai-chat-test-${process.pid}`;
  process.env.DIAGRAM_DATA_DIR = dir;
  return dir;
});

import type { ChatStreamEvent } from "@/core/protocol";
import { getContext } from "@/server/context";

import { ASSISTANT_ACTOR, MAX_TURNS } from "./config";
import { buildSystemPrompt } from "./prompt";
import { runAssistant } from "./runner";
import { collect, fakeClient, fakeToolset, textBlock, textResult, toolResultsOf, toolUseBlock } from "./testing";
import { ASSISTANT_EXCLUDED_TOOLS, createAssistantToolset } from "./tools";
import { runChatSession } from "./session";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const system = [{ type: "text" as const, text: "system" }];
const userSays = (text: string) => [{ role: "user" as const, text }];

/** Text of the first `tool_result` in the request made as call `n`. */
function firstResultText(calls: Parameters<typeof toolResultsOf>[0], n: number): string {
  const content = toolResultsOf(calls, n)[0]?.content;
  if (typeof content === "string") return content;
  const block = content?.find((item) => item.type === "text");
  return block && block.type === "text" ? block.text : "";
}

describe("the assistant on a real diagram", () => {
  it("creates a diagram and draws into it through the shared tools", async () => {
    const { service, hub } = getContext();
    const ctx = { service, hub, actor: ASSISTANT_ACTOR, baseUrl: "http://localhost:3000" };
    const doc = await service.create({ name: "Scratch" }, { kind: "human", id: "test", name: "Test" });

    const { client, calls } = fakeClient((call, params) => {
      if (call === 1) {
        return {
          content: [
            textBlock("I'll create a diagram."),
            toolUseBlock("t1", "diagram_create", { name: "Cache demo", type: "flowchart" }),
          ],
        };
      }
      if (call === 2) {
        const id = /id: `([^`]+)`/.exec(firstResultText(calls, 2))?.[1];
        expect(id).toBeTruthy();
        return {
          content: [
            toolUseBlock("t2", "diagram_add_elements", {
              diagram_id: id,
              nodes: [
                { id: "api", text: "API" },
                { id: "cache", text: "Cache" },
                { id: "db", text: "Database" },
              ],
              edges: [
                { from: "api", to: "cache" },
                { from: "cache", to: "db" },
              ],
            }),
          ],
        };
      }
      expect(params.messages.length).toBeGreaterThan(2);
      return { content: [textBlock("Done: the API now goes through a cache.")] };
    });

    const { events, emit } = collect();
    const result = await runChatSession({ ctx, doc, history: userSays("add a cache between the API and the DB"), client, model: "claude-sonnet-5-5", emit });

    expect(result.status).toBe("done");
    expect(result.turns).toBe(3);

    const tools = events.filter((event): event is Extract<ChatStreamEvent, { type: "tool" }> => event.type === "tool");
    expect(tools.map((event) => `${event.name}:${event.status}`)).toEqual([
      "diagram_create:running",
      "diagram_create:running",
      "diagram_create:done",
      "diagram_add_elements:running",
      "diagram_add_elements:running",
      "diagram_add_elements:done",
    ]);
    expect(tools[2].summary).toBe("Created “Cache demo”");
    expect(tools[5].summary).toBe("Added 3 nodes and 2 connectors");

    // Text from separate turns is separated, and the stream ends usage → done.
    const text = events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");
    expect(text).toBe("I'll create a diagram.\n\nDone: the API now goes through a cache.");
    expect(events.at(-2)).toMatchObject({ type: "usage", inputTokens: 300, outputTokens: 60 });
    expect(events.at(-1)).toEqual({ type: "done" });

    // The document really contains the nodes: look the new diagram up the way a person would.
    const created = (await service.list()).find((summary) => summary.name === "Cache demo");
    expect(created).toBeTruthy();
    const drawn = await service.get(created!.id);
    expect(Object.values(drawn.nodes).map((node) => node.text).sort()).toEqual(["API", "Cache", "Database"]);
    expect(Object.keys(drawn.edges)).toHaveLength(2);

    // The agent is attributed as the assistant.
    expect(hub.listAgents().some((agent) => agent.id === "assistant")).toBe(true);
  });

  it("puts the open diagram and the selection in the prompt after the cached block", async () => {
    const { service } = getContext();
    const doc = await service.create({ name: "Prompted" }, { kind: "human", id: "test", name: "Test" });
    const added = await service.applyElements(doc.id, { nodes: [{ id: "a", text: "Alpha" }], edges: [] }, { actor: ASSISTANT_ACTOR, mode: "create", layout: "auto" });

    const blocks = buildSystemPrompt(added.doc, ["a", "gone"]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveProperty("cache_control");
    expect(blocks[0].text).not.toContain(doc.id);
    expect(blocks[1]).not.toHaveProperty("cache_control");
    expect(blocks[1].text).toContain(`id: \`${doc.id}\``);
    expect(blocks[1].text).toContain("Their selection (1)");
    expect(blocks[1].text).toContain('"Alpha"');
    expect(blocks[1].text).not.toContain("gone");
  });
});

describe("the tool set", () => {
  it("never offers the excluded tools and refuses them if the model asks anyway", async () => {
    const { service, hub } = getContext();
    const toolset = createAssistantToolset({ service, hub, actor: ASSISTANT_ACTOR, baseUrl: "http://localhost" });
    const names = toolset.definitions.map((tool) => tool.name);
    expect(names.length).toBeGreaterThan(10);
    for (const excluded of ASSISTANT_EXCLUDED_TOOLS) expect(names).not.toContain(excluded);

    const refused = await toolset.run("diagram_delete", { diagram_id: "x", confirm_name: "x" });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("not available");
  });
});

describe("the loop", () => {
  it("returns tool results, including images, to the model", async () => {
    const toolset = fakeToolset({
      diagram_preview: () => ({
        content: [
          { type: "text", text: "Preview of it." },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      }),
    });
    const { client, calls } = fakeClient([
      { content: [toolUseBlock("p1", "diagram_preview", { diagram_id: "d" })] },
      { content: [textBlock("Looks good.")] },
    ]);
    const { emit } = collect();
    await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: toolset, history: userSays("look"), emit });

    const [result] = toolResultsOf(calls, 2);
    expect(result.tool_use_id).toBe("p1");
    expect(result.content).toEqual([
      { type: "text", text: "Preview of it." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("reports a tool that fails and lets the model carry on", async () => {
    const toolset = fakeToolset({
      diagram_read: () => textResult("Error: No diagram with id \"nope\"."),
      diagram_list: () => textResult("1 diagram"),
    });
    const { client, calls } = fakeClient([
      { content: [toolUseBlock("r1", "diagram_read", { diagram_id: "nope" }), toolUseBlock("r2", "mystery_tool", {})] },
      { content: [textBlock("That diagram does not exist.")] },
    ]);
    const { events, emit } = collect();
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: toolset, history: userSays("read"), emit });

    expect(result.status).toBe("done");
    const finished = events.filter((event) => event.type === "tool" && event.status !== "running");
    expect(finished).toMatchObject([
      { id: "r1", status: "error", summary: 'No diagram with id "nope".' },
      { id: "r2", status: "error" },
    ]);
    // Both results are returned in one user message, flagged as errors.
    expect(toolResultsOf(calls, 2).map((block) => [block.tool_use_id, block.is_error])).toEqual([
      ["r1", true],
      ["r2", true],
    ]);
  });

  it("stops after the turn limit instead of looping forever", async () => {
    const toolset = fakeToolset({ diagram_list: () => textResult("1 diagram") });
    const { client, calls } = fakeClient((call) => ({ content: [toolUseBlock(`t${call}`, "diagram_list", {})] }));
    const { events, emit } = collect();
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: toolset, history: userSays("loop"), emit });

    expect(MAX_TURNS).toBe(15);
    expect(calls).toHaveLength(MAX_TURNS);
    expect(result.status).toBe("step-limit");
    expect(events.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("15 steps") });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("makes no further model calls once aborted", async () => {
    const controller = new AbortController();
    const toolset = fakeToolset({
      diagram_list: () => {
        controller.abort();
        return textResult("1 diagram");
      },
    });
    const { client, calls } = fakeClient((call) => ({ content: [toolUseBlock(`t${call}`, "diagram_list", {})] }));
    const { events, emit } = collect();
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: toolset, history: userSays("go"), emit, signal: controller.signal });

    expect(result.status).toBe("aborted");
    expect(calls).toHaveLength(1);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("does not call the model at all when already aborted", async () => {
    const { client, calls } = fakeClient([{ content: [textBlock("hi")] }]);
    const { emit } = collect();
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: fakeToolset({}), history: userSays("go"), emit, signal: AbortSignal.abort() });
    expect(result.status).toBe("aborted");
    expect(calls).toHaveLength(0);
  });

  it("never runs a tool whose input was cut off by the token limit", async () => {
    const run = vi.fn(() => textResult("ran"));
    const { client } = fakeClient([{ content: [toolUseBlock("c1", "diagram_add_elements", { nodes: [] })], stop_reason: "max_tokens" }]);
    const { events, emit } = collect();
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: fakeToolset({ diagram_add_elements: run }), history: userSays("big"), emit });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
    // The announced call is closed out rather than left spinning.
    expect(events).toContainEqual({ type: "tool", id: "c1", name: "diagram_add_elements", status: "error", summary: "Not run" });
  });

  it("keeps one cache breakpoint at the end of the conversation and passes assistant turns back untouched", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-1" } as unknown as ReturnType<typeof textBlock>;
    const toolset = fakeToolset({ diagram_list: () => textResult("1 diagram") });
    const { client, calls } = fakeClient([
      { content: [thinking, toolUseBlock("t1", "diagram_list", {})] },
      { content: [toolUseBlock("t2", "diagram_list", {})] },
      { content: [textBlock("ok")] },
    ]);
    await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: toolset, history: userSays("list"), emit: collect().emit });

    const marked = (call: number) =>
      calls[call].messages.flatMap((message, index) =>
        typeof message.content === "string" ? [] : message.content.flatMap((block) => ("cache_control" in block && block.cache_control ? [index] : [])),
      );
    // Only the final message carries the breakpoint, on every turn.
    expect(marked(0)).toEqual([0]);
    expect(marked(1)).toEqual([2]);
    expect(marked(2)).toEqual([4]);

    // The assistant turn, thinking block included, is sent back exactly as it was received.
    expect(calls[1].messages[1]).toEqual({ role: "assistant", content: [thinking, toolUseBlock("t1", "diagram_list", {})] });
  });

  it("sends adaptive thinking and effort only to models that accept them", async () => {
    const script = [{ content: [textBlock("hi")] }];
    const modern = fakeClient(script);
    await runAssistant({ client: modern.client, model: "claude-sonnet-5-5", system, tools: fakeToolset({}), history: userSays("x"), emit: collect().emit });
    expect(modern.calls[0]).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(modern.calls[0]).not.toHaveProperty("temperature");

    const legacy = fakeClient(script);
    await runAssistant({ client: legacy.client, model: "claude-haiku-4-5", system, tools: fakeToolset({}), history: userSays("x"), emit: collect().emit });
    expect(legacy.calls[0]).not.toHaveProperty("thinking");
    expect(legacy.calls[0]).not.toHaveProperty("output_config");
  });
});

describe("failures", () => {
  const apiError = (status: number, type: string, message: string) =>
    Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, `${status} ${message}`, new Headers());

  it.each([
    [apiError(401, "authentication_error", "invalid x-api-key sk-ant-secret"), /rejected the API key/],
    [apiError(429, "rate_limit_error", "slow down"), /rate limit/],
    [apiError(529, "overloaded_error", "Overloaded"), /overloaded/],
  ])("turns %# into a friendly error event without leaking details", async (error, pattern) => {
    const { client } = fakeClient(() => error);
    const { events, emit } = collect();
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", system, tools: fakeToolset({}), history: userSays("x"), emit });

    expect(result.status).toBe("error");
    const message = events.find((event) => event.type === "error");
    expect(message).toMatchObject({ message: expect.stringMatching(pattern) });
    expect(JSON.stringify(events)).not.toContain("sk-ant-secret");
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
