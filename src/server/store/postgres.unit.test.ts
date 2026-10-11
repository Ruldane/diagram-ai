import { EventEmitter } from "node:events";

import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "@/core/model/defaults";
import type { Actor, DiagramDoc } from "@/core/model/types";

import { createDatabaseState } from "../db/database";
import { createPostgresState, PostgresRepository, type PostgresOptions, type PostgresState } from "./postgres";

/**
 * The write path against a scripted fake pool, so it is covered in the normal
 * test run. `postgres.test.ts` repeats the important parts on a real database.
 */

interface Call {
  text: string;
  values: unknown[] | undefined;
}

type Handler = (call: Call) => unknown;

function harness(handler: Handler = () => undefined) {
  const calls: Call[] = [];
  const query = async (text: string, values?: unknown[]) => {
    const call = { text, values };
    calls.push(call);
    const result = handler(call);
    if (result instanceof Error) throw result;
    return { rows: Array.isArray(result) ? result : [], rowCount: 0 };
  };
  const client = Object.assign(new EventEmitter(), { query, release: vi.fn() });
  const pool = { query, connect: async () => client, on: vi.fn() } as unknown as Pool;
  const state = createPostgresState(createDatabaseState(pool, Promise.resolve(1)));
  const upserts = () => calls.filter((c) => c.text.startsWith("INSERT INTO diagrams"));
  return { calls, state, upserts };
}

const FAST: Partial<PostgresOptions> = { writeDelayMs: 10, maxWriteWaitMs: 60, retryDelaysMs: [1, 1], backgroundRetryMs: 40 };

const repo = (state: PostgresState, options: Partial<PostgresOptions> = {}) => new PostgresRepository(state, { ...FAST, ...options });

const doc = (id: string, version = 1, extra: Partial<DiagramDoc> = {}): DiagramDoc => ({ ...createDoc({ id, name: `Diagram ${id}` }), version, ...extra });

const transient = () => Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const agent: Actor = { kind: "agent", id: "claude", name: "Claude" };

describe("PostgresRepository write path", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  let warnings: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns from save at once and coalesces a burst into one write of the latest document", async () => {
    const { state, upserts } = harness();
    const repository = repo(state);
    for (let version = 1; version <= 50; version++) repository.save(doc("d1", version));
    expect(upserts()).toHaveLength(0);
    await repository.flush();
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].values?.[0]).toBe("d1");
    expect(upserts()[0].values?.[5]).toBe(50);
    expect(errors).not.toHaveBeenCalled();
  });

  it("writes a diagram that is edited without pause at least every maxWriteWaitMs", async () => {
    const { state, upserts } = harness();
    const repository = repo(state, { writeDelayMs: 40, maxWriteWaitMs: 80 });
    for (let version = 1; version <= 20; version++) {
      repository.save(doc("busy", version));
      await wait(15);
    }
    expect(upserts().length).toBeGreaterThanOrEqual(2);
    await repository.flush();
    expect(upserts().at(-1)?.values?.[5]).toBe(20);
  });

  it("keeps separate diagrams separate", async () => {
    const { state, upserts } = harness();
    const repository = repo(state);
    repository.save(doc("a", 3));
    repository.save(doc("b", 7));
    await repository.flush();
    expect(upserts().map((c) => [c.values?.[0], c.values?.[5]]).sort()).toEqual([
      ["a", 3],
      ["b", 7],
    ]);
  });

  it("retries a transient failure with the newest document, without logging an error", async () => {
    let failures = 2;
    const { state, upserts } = harness((call) => (call.text.startsWith("INSERT INTO diagrams") && failures-- > 0 ? transient() : undefined));
    const repository = repo(state);
    repository.save(doc("d1", 1));
    await wait(15); // first attempt fails, a retry is waiting
    repository.save(doc("d1", 2));
    await repository.flush();
    expect(upserts().at(-1)?.values?.[5]).toBe(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it("logs a permanent failure, keeps the document readable and does not retry it by itself", async () => {
    const bad = Object.assign(new Error("invalid input syntax"), { code: "22P02" });
    const { state, upserts } = harness((call) => (call.text.startsWith("INSERT INTO diagrams") ? bad : undefined));
    const repository = repo(state);
    repository.save(doc("d1", 4));
    await repository.flush();
    expect(upserts()).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("d1");
    await wait(80);
    expect(upserts()).toHaveLength(1);
    expect((await repository.get("d1"))?.version).toBe(4);
    expect((await repository.list()).map((s) => s.id)).toContain("d1");
  });

  it("keeps trying in the background after the attempts run out", async () => {
    let failures = 4; // initial try + 2 retries fail, then the first background attempt fails too
    const { state, upserts } = harness((call) => (call.text.startsWith("INSERT INTO diagrams") && failures-- > 0 ? transient() : undefined));
    const repository = repo(state);
    repository.save(doc("d1", 9));
    await repository.flush();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("trying again");
    await wait(250);
    expect(upserts().length).toBe(5);
    expect(state.writes.get("d1")?.persisted).toBe(state.writes.get("d1")?.rev);
  });

  it("deletes without writing a pending change", async () => {
    const { state, upserts, calls } = harness();
    const repository = repo(state);
    repository.save(doc("gone"));
    await repository.delete("gone");
    await wait(30);
    expect(upserts()).toHaveLength(0);
    expect(calls.some((c) => c.text.startsWith("DELETE FROM diagrams"))).toBe(true);
    expect(await repository.get("gone")).toBeNull();
  });

  it("writes a change-log entry in the same transaction as its version", async () => {
    const { state, calls } = harness();
    const repository = repo(state);
    repository.save(doc("d1", 2));
    repository.appendOp("d1", 2, agent, { doc: { name: "Renamed" } });
    await repository.flush();
    const texts = calls.map((c) => c.text.split(/\s+/).slice(0, 3).join(" "));
    expect(texts).toEqual(["BEGIN", "INSERT INTO diagrams", "INSERT INTO diagram_ops", "COMMIT"]);
    const ops = calls.find((c) => c.text.startsWith("INSERT INTO diagram_ops"));
    expect(ops?.values?.slice(0, 2)).toEqual(["d1", 2]);
    expect(JSON.parse(String(ops?.values?.[3]))).toEqual({ doc: { name: "Renamed" } });
  });

  it("keeps a change-log entry buffered when its transaction fails", async () => {
    let failures = 1;
    const { state, calls } = harness((call) => (call.text.startsWith("INSERT INTO diagram_ops") && failures-- > 0 ? transient() : undefined));
    const repository = repo(state);
    repository.save(doc("d1", 3));
    repository.appendOp("d1", 3, agent, {});
    await repository.flush();
    expect(calls.filter((c) => c.text.startsWith("INSERT INTO diagram_ops"))).toHaveLength(2);
    expect(calls.filter((c) => c.text === "ROLLBACK")).toHaveLength(1);
    expect(state.writes.get("d1")?.ops).toHaveLength(0);
  });

  it("overlays unwritten changes on the stored summaries", async () => {
    const stored = { id: "old", name: "Old", type: "flowchart", description: null, node_count: 1, edge_count: 0, open_comments: 0, version: 1, created_at: new Date("2026-01-01"), updated_at: new Date("2026-01-01") };
    const { state } = harness((call) => (call.text.startsWith("SELECT id, name") ? [stored, { ...stored, id: "stale", name: "Stale" }] : undefined));
    const repository = repo(state, { writeDelayMs: 10_000, maxWriteWaitMs: 20_000 });
    repository.save(doc("stale", 5, { name: "Fresh", updatedAt: "2026-06-01T00:00:00.000Z" }));
    repository.save(doc("new", 1, { updatedAt: "2026-07-01T00:00:00.000Z" }));
    const list = await repository.list();
    expect(list.map((s) => [s.id, s.name])).toEqual([
      ["new", "Diagram new"],
      ["stale", "Fresh"],
      ["old", "Old"],
    ]);
    await repository.delete("new");
    await repository.delete("stale");
  });

  it("keeps documents with unwritten changes in memory and evicts clean ones", async () => {
    const { state } = harness();
    const repository = repo(state, { maxCachedDocs: 2, writeDelayMs: 10_000, maxWriteWaitMs: 20_000 });
    for (const id of ["a", "b", "c"]) repository.save(doc(id));
    expect(state.docs.size).toBe(3);
    await repository.flush();
    repository.save(doc("d"));
    expect(state.docs.size).toBeLessThanOrEqual(3);
    expect(state.docs.has("d")).toBe(true);
    await repository.flush();
    repository.save(doc("e"));
    await repository.flush();
    expect(state.docs.size).toBe(2);
  });

  it("reports a stored document that fails validation once and hides it from listings", async () => {
    const summary = { id: "bad", name: "Bad", type: "flowchart", description: null, node_count: 0, edge_count: 0, open_comments: 0, version: 1, created_at: new Date(), updated_at: new Date() };
    const { state } = harness((call) => {
      if (call.text.startsWith("SELECT doc FROM diagrams")) return [{ doc: { nonsense: true } }];
      if (call.text.startsWith("SELECT id, name")) return [summary];
      return undefined;
    });
    const repository = repo(state);
    expect(await repository.get("bad")).toBeNull();
    expect(await repository.get("bad")).toBeNull();
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(await repository.list()).toEqual([]);
  });

  it("rejects unsafe ids before touching the database", async () => {
    const { state, calls } = harness();
    const repository = repo(state);
    expect(() => repository.save(doc("../etc/passwd"))).toThrow(/not a valid id/);
    await expect(repository.get("a b")).rejects.toThrow(/not a valid id/);
    await expect(repository.delete("x/y")).rejects.toThrow(/not a valid id/);
    expect(calls).toHaveLength(0);
  });
});
