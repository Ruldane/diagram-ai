import { rmSync } from "node:fs";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/diagram-ai-chat-route-test-${process.pid}`;
  process.env.DIAGRAM_DATA_DIR = dir;
  return dir;
});

import { POST } from "@/app/api/diagrams/[id]/chat/route";
import { getContext } from "@/server/context";

import { claimChatRun } from "./run-lock";
import { ndjsonResponse } from "./stream";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const savedKey = process.env.ANTHROPIC_API_KEY;
const savedAgents = process.env.DIAGRAM_AI_LOCAL_AGENTS;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  // These tests cover the API-key engine; an installed Claude Code CLI would otherwise become the default engine.
  process.env.DIAGRAM_AI_LOCAL_AGENTS = "off";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedAgents === undefined) delete process.env.DIAGRAM_AI_LOCAL_AGENTS;
  else process.env.DIAGRAM_AI_LOCAL_AGENTS = savedAgents;
});

const call = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request(`http://localhost:3000/api/diagrams/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost:3000", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const hello = { messages: [{ role: "user", text: "hello" }] };

describe("POST /api/diagrams/[id]/chat", () => {
  it("explains how to set up the key when there is none, without streaming", async () => {
    const response = await call("anything", hello);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("not_configured");
    expect(body.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(body.error).toMatch(/\.env\.local/);
  });

  it("refuses cross-origin requests and malformed bodies", async () => {
    expect((await call("x", hello, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("x", { messages: [] })).status).toBe(400);
    expect((await call("x", { messages: [{ role: "assistant", text: "hi" }] })).status).toBe(400);
  });

  it("answers 404 for a diagram that does not exist", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect((await call("no-such-diagram", hello)).status).toBe(404);
  });

  it("answers 409 while another run is working on the same diagram", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const doc = await getContext().service.create({ name: "Busy" }, { kind: "human", id: "test", name: "Test" });
    const release = claimChatRun(doc.id);
    try {
      const response = await call(doc.id, hello);
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toMatch(/already working/);
    } finally {
      release();
    }
    // Released claims can be taken again.
    claimChatRun(doc.id)();
  });
});

describe("ndjsonResponse", () => {
  const request = () => new Request("http://localhost/api", { method: "POST" });

  it("writes one JSON event per line and closes when the run ends", async () => {
    const response = ndjsonResponse(request(), async (emit) => {
      emit({ type: "text", delta: "Hi" });
      emit({ type: "done" });
    });
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await response.text()).split("\n").filter(Boolean);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ type: "text", delta: "Hi" }, { type: "done" }]);
  });

  it("aborts the run when the reader goes away", async () => {
    let aborted: () => boolean = () => false;
    const response = ndjsonResponse(request(), (_emit, signal) => {
      aborted = () => signal.aborted;
      return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    });
    await response.body!.cancel();
    expect(aborted()).toBe(true);
  });
});
