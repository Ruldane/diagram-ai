import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatStreamEvent } from "@/core/protocol";

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/diagram-ai-claude-code-test-${process.pid}`;
  process.env.DIAGRAM_DATA_DIR = dir;
  return dir;
});

import { forgetLoginState } from "../bridge/login";
import { runningChildren } from "../bridge/child-process";
import { getContext } from "@/server/context";

import { ASSISTANT_ACTOR } from "../config";
import { claudeCodeEngine } from "./claude-code";

/**
 * Process-level tests: the real engine spawns a stand-in `claude` (see
 * `bridge/fixtures/fake-claude.mjs`) that plays a transcript captured from the
 * real CLI. On Windows the stand-in is a `.cmd` file, which exercises the
 * shim path (shell, validated arguments, prompt on stdin); elsewhere it is an
 * executable script run directly.
 */
const FIXTURES = path.join(import.meta.dirname, "..", "bridge", "fixtures");
const SCRIPT = path.join(FIXTURES, "fake-claude.mjs");
const WINDOWS = process.platform === "win32";

const scratch = mkdtempSync(path.join(os.tmpdir(), "diagram-ai-fake-claude-"));
const wrapper = path.join(scratch, WINDOWS ? "claude.cmd" : "claude");
if (WINDOWS) {
  writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${SCRIPT}" %*\r\n`);
} else {
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${SCRIPT}" "$@"\n`);
  chmodSync(wrapper, 0o755);
}

const SAVED = ["DIAGRAM_AI_CLAUDE_PATH", "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "DIAGRAM_AI_LOCAL_AGENTS", "DATABASE_URL", "DIAGRAM_AI_AUTH", "FAKE_CLAUDE_RECORD", "FAKE_CLAUDE_TRANSCRIPT", "FAKE_CLAUDE_STYLE", "FAKE_CLAUDE_MODE", "FAKE_CLAUDE_PIDFILE"] as const;
const saved = new Map<string, string | undefined>();
const record = path.join(scratch, "record.json");

beforeEach(() => {
  for (const name of SAVED) saved.set(name, process.env[name]);
  process.env.DIAGRAM_AI_CLAUDE_PATH = wrapper;
  // A key and a config dir that the child must never see.
  process.env.ANTHROPIC_API_KEY = "sk-ant-must-not-reach-the-child";
  process.env.CLAUDE_CONFIG_DIR = path.join(scratch, "elsewhere");
  delete process.env.DIAGRAM_AI_LOCAL_AGENTS;
  delete process.env.DATABASE_URL;
  delete process.env.DIAGRAM_AI_AUTH;
  process.env.FAKE_CLAUDE_RECORD = record;
  process.env.FAKE_CLAUDE_TRANSCRIPT = path.join(FIXTURES, "claude-real-first-turn.jsonl");
  delete process.env.FAKE_CLAUDE_STYLE;
  delete process.env.FAKE_CLAUDE_MODE;
  forgetLoginState();
  rmSync(record, { force: true });
});

afterEach(() => {
  for (const name of SAVED) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function run(options: { text?: string; signal?: AbortSignal; sessionId?: string; workdir?: string } = {}) {
  const { service, hub } = getContext();
  const doc = await service.create({ name: "Fake run" }, { kind: "human", id: "test", name: "Test" });
  const events: ChatStreamEvent[] = [];
  await claudeCodeEngine.run({
    ctx: { service, hub, actor: ASSISTANT_ACTOR, baseUrl: "http://localhost:3000" },
    doc,
    history: [{ role: "user", text: options.text ?? "Draw a box" }],
    selection: [],
    sessionId: options.sessionId,
    workdir: options.workdir,
    emit: (event) => events.push(event),
    signal: options.signal ?? new AbortController().signal,
  });
  return events;
}

const recorded = () => JSON.parse(readFileSync(record, "utf8")) as { args: string[]; stdin: string; env: Record<string, string>; cwd: string };
const text = (events: ChatStreamEvent[]) => events.flatMap((event) => (event.type === "text" ? [event.delta] : [])).join("");

describe("claude-code engine against a stand-in CLI", () => {
  it("reports it as available, with how it is signed in and nothing else from the status output", async () => {
    const status = await claudeCodeEngine.status();
    expect(status).toMatchObject({ id: "claude-code", available: true, billing: "subscription", authMethod: "claude.ai", needsAcknowledgement: true });
    expect(JSON.stringify(status)).not.toContain("someone@example.com");
  });

  it("runs a request end to end: arguments, prompt on stdin, clean environment, mapped events", async () => {
    const events = await run({ text: "Zeichne ein Kästchen für Größe ✓" });

    expect(events[0]).toMatchObject({ type: "session" });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(text(events)).toBe("done");
    expect(events).toContainEqual(expect.objectContaining({ type: "tool", name: "diagram_add_elements", status: "done" }));

    const seen = recorded();
    // Prompt travels on stdin, in UTF-8, including through a shell shim.
    expect(seen.stdin).toContain("Zeichne ein Kästchen für Größe ✓");
    expect(seen.args).toContain("--session-id");
    expect(seen.args).not.toContain("--resume");
    expect(seen.args.join(" ")).not.toMatch(/dangerously|bypass|--bare/i);
    expect(seen.args[seen.args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    // The brief goes in an argument, or in the prompt when a shell is in the way.
    if (WINDOWS) {
      expect(seen.args).not.toContain("--append-system-prompt");
      expect(seen.stdin).toContain("Working inside the editor");
    } else {
      expect(seen.args).toContain("--append-system-prompt");
    }

    // Credentials and routing never reach the child; the app's own switches do.
    expect(Object.keys(seen.env).filter((name) => /anthropic|config_dir/i.test(name))).toEqual([]);
    expect(seen.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    expect(path.basename(seen.cwd)).toBe("workdir");
    expect(runningChildren()).toBe(0);
  });

  it("resumes the given session instead of starting a new one", async () => {
    const id = "6c7ac486-9b30-46a8-9375-e2e348fc34c0";
    await run({ sessionId: id });
    const args = recorded().args;
    expect(args[args.indexOf("--resume") + 1]).toBe(id);
    expect(args).not.toContain("--session-id");
  });

  it("runs in the chosen folder with read rules scoped to it, and without file tools by default", async () => {
    await run();
    expect(recorded().args.join(" ")).not.toMatch(/Read|Glob|Grep/);

    const folder = realpathSync(mkdtempSync(path.join(scratch, "project-")));
    await run({ workdir: folder });
    const seen = recorded();
    expect(realpathSync(seen.cwd)).toBe(folder);
    const rules = seen.args.filter((arg) => /^(Read|Glob|Grep)\(\/\//.test(arg));
    expect(rules).toHaveLength(3);
    for (const rule of rules) expect(rule.endsWith("/**)")).toBe(true);
    expect(seen.args[seen.args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(seen.args[seen.args.indexOf("--setting-sources") + 1]).toBe("");
  });

  it("reads output with CRLF line ends, a BOM and lines split across chunks", async () => {
    process.env.FAKE_CLAUDE_STYLE = "crlf-bom,chunked";
    const events = await run();
    expect(text(events)).toBe("done");
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("explains a crash instead of reporting an empty answer", async () => {
    process.env.FAKE_CLAUDE_MODE = "crash";
    const events = await run();
    expect(events.find((event) => event.type === "error")).toMatchObject({ message: expect.stringContaining("something broke") });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("stops the whole process tree when the request is aborted", async () => {
    const pidFile = path.join(scratch, "grandchild.pid");
    rmSync(pidFile, { force: true });
    process.env.FAKE_CLAUDE_MODE = "hang";
    process.env.FAKE_CLAUDE_PIDFILE = pidFile;

    const controller = new AbortController();
    const running = run({ signal: controller.signal });
    // The stand-in starts a grandchild, then waits forever.
    for (let waited = 0; !existsSync(pidFile) && waited < 100; waited++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(grandchild, 0)).not.toThrow();

    controller.abort();
    const events = await running;
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(runningChildren()).toBe(0);

    // taskkill /T on Windows, the process group elsewhere: the grandchild goes too.
    let alive = true;
    for (let waited = 0; alive && waited < 50; waited++) {
      try {
        process.kill(grandchild, 0);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 20_000);

  it("is unavailable when the program cannot be found, and when accounts are on", async () => {
    process.env.DIAGRAM_AI_CLAUDE_PATH = path.join(scratch, "missing", "claude");
    expect(await claudeCodeEngine.status()).toMatchObject({ available: false, reason: expect.stringContaining("not found") });
    process.env.DIAGRAM_AI_CLAUDE_PATH = wrapper;
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/none";
    // PostgreSQL storage alone is still a single person at the keyboard: the bridge stays available.
    expect(await claudeCodeEngine.status()).toMatchObject({ available: true });
    process.env.DIAGRAM_AI_AUTH = "on";
    expect(await claudeCodeEngine.status()).toMatchObject({ available: false, reason: expect.stringContaining("accounts") });
  });
});
