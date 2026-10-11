import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createDoc } from "@/core/model/defaults";
import type { Actor, DiagramDoc, DNode } from "@/core/model/types";

import { MAX_SNAPSHOTS } from "../config";
import { createDatabaseState, createPool } from "../db/database";
import { importFiles } from "../db/import-files";
import { insertOps, trimOps } from "../db/queries";
import { migrate, migrationStatus } from "../db/migrate";
import { createPostgresState, PostgresRepository, type PostgresOptions } from "./postgres";
import { makeSnapshot } from "./repository";

/**
 * Runs against a real PostgreSQL: `DATABASE_URL_TEST=... npm run test:db`.
 * Everything happens in a throw-away schema, so it is safe on a development database.
 */
const url = process.env.DATABASE_URL_TEST;

const agent: Actor = { kind: "agent", id: "claude", name: "Claude" };
const human: Actor = { kind: "human", id: "browser", name: "You" };

function makeDoc(id: string, nodes = 0, extra: Partial<DiagramDoc> = {}): DiagramDoc {
  const record: Record<string, DNode> = {};
  for (let i = 0; i < nodes; i++) record[`n_${i}`] = { id: `n_${i}`, shape: "flowchart/process", x: i * 10, y: 0, w: 100, h: 50, z: i, text: `Node ${i}` };
  return { ...createDoc({ id, name: `Diagram ${id}` }), nodes: record, ...extra };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!url)("PostgresRepository on PostgreSQL", () => {
  const schema = `diagram_ai_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let admin: Pool;
  let pool: Pool;
  let counter = 0;

  /** A repository with its own in-memory state, i.e. a freshly started server. */
  const server = (options: Partial<PostgresOptions> = {}) => new PostgresRepository(createPostgresState(createDatabaseState(pool, Promise.resolve(1))), { writeDelayMs: 20, ...options });
  const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
  const count = async (table: string, where = "true") => Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)).rows[0].n);

  beforeAll(async () => {
    admin = createPool(url as string, { max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(url as string, { options: `-c search_path=${schema}` });
    await migrate(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates, reads, lists and deletes, across a restart", async () => {
    const id = uid("crud");
    const first = server();
    const doc = makeDoc(id, 3, { description: "About this", version: 4 });
    first.save(doc);
    await first.flush();

    const restarted = server();
    expect(await restarted.get(id)).toEqual(doc);
    const summary = (await restarted.list()).find((s) => s.id === id);
    expect(summary).toMatchObject({ id, name: doc.name, description: "About this", nodeCount: 3, edgeCount: 0, openComments: 0, version: 4, createdAt: doc.createdAt, updatedAt: doc.updatedAt });

    await restarted.delete(id);
    expect(await restarted.get(id)).toBeNull();
    expect((await restarted.list()).some((s) => s.id === id)).toBe(false);
    expect(await server().get(id)).toBeNull();
    expect(await count("diagrams", `id = '${id}'`)).toBe(0);
  });

  it("lists unwritten changes straight away and orders by update time", async () => {
    const older = uid("ord");
    const newer = uid("ord");
    const repository = server({ writeDelayMs: 10_000, maxWriteWaitMs: 20_000 });
    repository.save(makeDoc(older, 0, { updatedAt: "2030-01-01T00:00:00.000Z" }));
    repository.save(makeDoc(newer, 0, { updatedAt: "2030-01-02T00:00:00.000Z" }));
    const ids = (await repository.list()).map((s) => s.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(ids.slice(0, 2)).toEqual([newer, older]);
    await repository.delete(older);
    await repository.delete(newer);
  });

  it("coalesces saves and flush waits for the write", async () => {
    const id = uid("burst");
    const repository = server();
    for (let version = 1; version <= 30; version++) repository.save(makeDoc(id, 1, { version }));
    expect(await count("diagrams", `id = '${id}'`)).toBe(0); // save did not block on the database
    await repository.flush();
    const { rows } = await pool.query<{ version: number }>("SELECT version FROM diagrams WHERE id = $1", [id]);
    expect(rows).toEqual([{ version: 30 }]);
    await repository.delete(id);
  });

  it("ends on the last version after 50 concurrent saves, with flushes in between", async () => {
    const id = uid("race");
    const repository = server({ writeDelayMs: 5 });
    let last = 0;
    await Promise.all(
      Array.from({ length: 50 }, async (_, index) => {
        await wait(Math.floor(Math.random() * 40));
        const version = ++last;
        repository.save(makeDoc(id, 1, { version, name: `v${version}` }));
        if (index % 7 === 0) await repository.flush();
      }),
    );
    await repository.flush();
    expect(last).toBe(50);
    const { rows } = await pool.query<{ version: number; name: string }>("SELECT version, name FROM diagrams WHERE id = $1", [id]);
    expect(rows).toEqual([{ version: 50, name: "v50" }]);
    expect((await server().get(id))?.version).toBe(50);
    await repository.delete(id);
  });

  it("keeps the newest checkpoints and reads them back", async () => {
    const id = uid("snap");
    const repository = server();
    const doc = makeDoc(id, 2, { version: 3 });
    repository.save(doc);
    // The diagram is not written yet; saving a checkpoint must wait for it instead of failing the foreign key.
    const total = MAX_SNAPSHOTS + 5;
    for (let i = 0; i < total; i++) {
      await repository.saveSnapshot(makeSnapshot(`s_${String(i).padStart(3, "0")}`, `Checkpoint ${i}`, i % 2 ? agent : human, doc, new Date(Date.UTC(2030, 0, 1, 0, 0, i))));
    }
    const listed = await server().listSnapshots(id);
    expect(listed).toHaveLength(MAX_SNAPSHOTS);
    expect(listed[0]).toMatchObject({ id: `s_${String(total - 1).padStart(3, "0")}`, nodeCount: 2, edgeCount: 0 });
    expect(listed.at(-1)?.id).toBe(`s_${String(total - MAX_SNAPSHOTS).padStart(3, "0")}`);
    expect(listed.every((s) => !("doc" in s))).toBe(true);

    const fetched = await server().getSnapshot(id, listed[0].id);
    expect(fetched?.doc).toEqual(doc);
    expect(await server().getSnapshot(id, "s_000")).toBeNull();
    await repository.delete(id);
  });

  it("sets, reads and clears the review baseline", async () => {
    const id = uid("rev");
    const repository = server();
    const base = makeDoc(id, 1, { version: 2 });
    repository.save(makeDoc(id, 2, { version: 3 }));
    expect(await repository.getReviewBase(id)).toBeNull();

    await repository.setReviewBase(id, { doc: base, by: agent, since: "2030-05-06T07:08:09.000Z" });
    expect(await repository.getReviewBase(id)).toMatchObject({ by: agent, since: "2030-05-06T07:08:09.000Z" });
    const restarted = server();
    expect(await restarted.getReviewBase(id)).toEqual({ doc: base, by: agent, since: "2030-05-06T07:08:09.000Z" });

    await restarted.setReviewBase(id, { doc: base, since: "2030-05-07T00:00:00.000Z" });
    expect((await server().getReviewBase(id))?.by).toBeUndefined();

    await restarted.setReviewBase(id, null);
    expect(await restarted.getReviewBase(id)).toBeNull();
    expect(await server().getReviewBase(id)).toBeNull();
    await repository.delete(id);
  });

  it("removes checkpoints, review baseline and change log with the diagram", async () => {
    const id = uid("cascade");
    const repository = server();
    const doc = makeDoc(id, 1, { version: 2 });
    repository.save(doc);
    repository.appendOp(id, 2, agent, { doc: { name: "x" } });
    await repository.saveSnapshot(makeSnapshot("s_1", "One", agent, doc));
    await repository.setReviewBase(id, { doc, since: new Date().toISOString() });
    await repository.flush();
    for (const table of ["diagram_snapshots", "diagram_review_bases", "diagram_ops"]) expect(await count(table, `diagram_id = '${id}'`)).toBe(1);

    await repository.delete(id);
    for (const table of ["diagrams", "diagram_snapshots", "diagram_review_bases", "diagram_ops"]) {
      expect(await count(table, `${table === "diagrams" ? "id" : "diagram_id"} = '${id}'`)).toBe(0);
    }
  });

  it("writes the change log with each version and tolerates replays", async () => {
    const id = uid("ops");
    const repository = server();
    for (let version = 1; version <= 3; version++) {
      repository.save(makeDoc(id, 0, { version }));
      repository.appendOp(id, version, version === 2 ? human : agent, { doc: { name: `Name ${version}` } });
      await repository.flush();
    }
    const { rows } = await pool.query<{ version: number; actor: Actor; patch: unknown }>("SELECT version, actor, patch FROM diagram_ops WHERE diagram_id = $1 ORDER BY version", [id]);
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(rows[1].actor).toEqual(human);
    expect(rows[2].patch).toEqual({ doc: { name: "Name 3" } });

    const op = { version: 3, actor: agent, patch: {}, at: new Date().toISOString() };
    await insertOps(pool, id, [op, op]);
    expect(await count("diagram_ops", `diagram_id = '${id}'`)).toBe(3);
    await repository.delete(id);
  });

  it("trims the change log to the newest entries", async () => {
    const id = uid("trim");
    const repository = server();
    repository.save(makeDoc(id));
    await repository.flush();
    const ops = Array.from({ length: 40 }, (_, i) => ({ version: i + 1, actor: agent, patch: {}, at: new Date().toISOString() }));
    await insertOps(pool, id, ops);
    await trimOps(pool, id, 10);
    const { rows } = await pool.query<{ version: number }>("SELECT version FROM diagram_ops WHERE diagram_id = $1 ORDER BY version", [id]);
    expect(rows.map((r) => r.version)).toEqual(Array.from({ length: 10 }, (_, i) => 31 + i));
    await repository.delete(id);
  });

  it("skips a stored document that fails validation, with a warning, and keeps listing the rest", async () => {
    const good = uid("good");
    const broken = uid("broken");
    const repository = server();
    repository.save(makeDoc(good));
    await repository.flush();
    await pool.query(
      `INSERT INTO diagrams (id, name, type, doc, version, created_at, updated_at) VALUES ($1, 'Broken', 'flowchart', '{"schema": 99, "nodes": 7}'::jsonb, 1, now(), now())`,
      [broken],
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const restarted = server();
    expect(await restarted.get(broken)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(broken);
    const ids = (await restarted.list()).map((s) => s.id);
    expect(ids).toContain(good);
    expect(ids).not.toContain(broken);
    expect((await restarted.get(good))?.id).toBe(good);

    await restarted.delete(broken);
    await restarted.delete(good);
  });

  it("stores text that contains a NUL character", async () => {
    const id = uid("nul");
    const repository = server();
    const doc = makeDoc(id, 1);
    repository.save({ ...doc, nodes: { n_0: { ...doc.nodes.n_0, text: "before\u0000after" } } });
    await repository.flush();
    expect((await server().get(id))?.nodes.n_0.text).toBe("beforeafter");
    await repository.delete(id);
  });

  it("recovers when the pool loses its connections mid-write", async () => {
    const id = uid("blip");
    const repository = server({ retryDelaysMs: [20, 20, 20] });
    const original = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
    let failures = 2;
    const spy = vi.spyOn(pool, "query").mockImplementation(((...args: unknown[]) => {
      const text = typeof args[0] === "string" ? args[0] : "";
      if (text.startsWith("INSERT INTO diagrams") && failures-- > 0) return Promise.reject(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
      return original(...args);
    }) as unknown as typeof pool.query);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    repository.save(makeDoc(id, 1, { version: 6 }));
    await repository.flush();
    spy.mockRestore();
    expect(error).not.toHaveBeenCalled();
    expect((await server().get(id))?.version).toBe(6);
    await repository.delete(id);
  });

  it("applies migrations once and again without effect", async () => {
    const before = await migrationStatus(pool);
    expect(before.pending).toEqual([]);
    const again = await migrate(pool);
    expect(again.applied).toEqual([]);
    expect(again.total).toBe(before.applied.length);
    expect(await count("schema_migrations")).toBe(before.applied.length);
  });

  it("refuses to run when an applied migration was edited", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "diagram-ai-migrations-"));
    const other = `${schema}_m`;
    await admin.query(`CREATE SCHEMA ${other}`);
    const scoped = createPool(url as string, { options: `-c search_path=${other}`, max: 2 });
    try {
      await writeFile(path.join(dir, "001_a.sql"), "CREATE TABLE a (id int);");
      expect((await migrate(scoped, { dir })).applied).toEqual(["001_a"]);
      await writeFile(path.join(dir, "002_b.sql"), "CREATE TABLE b (id int);");
      expect((await migrate(scoped, { dir })).applied).toEqual(["002_b"]);
      await writeFile(path.join(dir, "001_a.sql"), "CREATE TABLE a (id int, extra int);");
      await expect(migrate(scoped, { dir })).rejects.toThrow(/001_a was changed/);
      // A failing migration rolls back completely and is not recorded.
      await writeFile(path.join(dir, "001_a.sql"), "CREATE TABLE a (id int);");
      await writeFile(path.join(dir, "003_bad.sql"), "CREATE TABLE c (id int); SELECT 1/0;");
      await expect(migrate(scoped, { dir })).rejects.toThrow(/003_bad failed/);
      expect((await scoped.query("SELECT to_regclass('c') AS c")).rows[0].c).toBeNull();
      expect((await migrationStatus(scoped, dir)).pending.map((m) => m.name)).toEqual(["003_bad"]);
    } finally {
      await scoped.end();
      await admin.query(`DROP SCHEMA ${other} CASCADE`);
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe("importing JSON files", () => {
    it("is idempotent, validates, and only overwrites on request", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "diagram-ai-import-"));
      const a = uid("impa");
      const b = uid("impb");
      try {
        await mkdir(path.join(root, "diagrams"), { recursive: true });
        await mkdir(path.join(root, "snapshots", a), { recursive: true });
        await mkdir(path.join(root, "review"), { recursive: true });
        const docA = makeDoc(a, 2, { version: 5 });
        const docB = makeDoc(b, 1, { version: 2 });
        await writeFile(path.join(root, "diagrams", `${a}.json`), JSON.stringify(docA, null, 2));
        await writeFile(path.join(root, "diagrams", `${b}.json`), JSON.stringify(docB));
        await writeFile(path.join(root, "diagrams", "corrupt.json"), JSON.stringify({ schema: 1, id: "corrupt" }));
        await writeFile(path.join(root, "diagrams", "notjson.json"), "{ nope");
        await writeFile(path.join(root, "snapshots", a, "s_1.json"), JSON.stringify(makeSnapshot("s_1", "Old state", agent, makeDoc(a, 1, { version: 1 }))));
        await writeFile(path.join(root, "review", `${a}.json`), JSON.stringify({ doc: makeDoc(a, 0), by: agent, since: "2030-01-01T00:00:00.000Z" }));

        const first = await importFiles(pool, { dir: root, owner: "user_1" });
        expect(first).toMatchObject({ imported: 2, replaced: 0, skipped: 0, snapshots: 1, reviewBases: 1 });
        expect(first.problems).toHaveLength(2);
        expect(first.problems.join("\n")).toMatch(/corrupt\.json/);
        expect(first.problems.join("\n")).toMatch(/notjson\.json/);

        const second = await importFiles(pool, { dir: root, owner: "user_1" });
        expect(second).toMatchObject({ imported: 0, replaced: 0, skipped: 2, snapshots: 0, reviewBases: 0 });
        expect(await count("diagram_snapshots", `diagram_id = '${a}'`)).toBe(1);

        const server1 = server();
        expect(await server1.get(a)).toEqual(docA);
        expect((await server1.listSnapshots(a)).map((s) => s.name)).toEqual(["Old state"]);
        expect((await server1.getReviewBase(a))?.by).toEqual(agent);
        expect((await pool.query("SELECT owner_id FROM diagrams WHERE id = $1", [a])).rows[0].owner_id).toBe("user_1");

        // A changed file is left alone by default and replaces the row with --overwrite.
        await writeFile(path.join(root, "diagrams", `${a}.json`), JSON.stringify({ ...docA, name: "Edited on disk", version: 6 }));
        expect(await importFiles(pool, { dir: root })).toMatchObject({ imported: 0, skipped: 2 });
        expect((await server().get(a))?.name).toBe(docA.name);
        const overwritten = await importFiles(pool, { dir: root, overwrite: true });
        expect(overwritten).toMatchObject({ imported: 0, replaced: 2, skipped: 0 });
        expect((await server().get(a))?.name).toBe("Edited on disk");
        expect((await pool.query("SELECT owner_id FROM diagrams WHERE id = $1", [a])).rows[0].owner_id).toBe("user_1");
        expect(await count("diagram_snapshots", `diagram_id = '${a}'`)).toBe(1);

        const cleanup = server();
        await cleanup.delete(a);
        await cleanup.delete(b);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
