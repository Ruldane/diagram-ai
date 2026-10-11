import { describe, expect, it } from "vitest";

import { isTransientError } from "./errors";
import { checksumOf, loadMigrations, orderMigrations, parseMigrationFile } from "./migrate";
import { toDiagramSummary, toSnapshotInfo, newestFirst } from "./rows";
import { toJson, toTimestamp } from "./sql";

describe("migration files", () => {
  it("parses NNN_name.sql", () => {
    expect(parseMigrationFile("001_init.sql")).toEqual({ version: 1, name: "001_init" });
    expect(parseMigrationFile("0012_add_users.sql")).toEqual({ version: 12, name: "0012_add_users" });
    expect(parseMigrationFile("init.sql")).toBeNull();
    expect(parseMigrationFile("01_init.sql")).toBeNull();
    expect(parseMigrationFile("001_Init.sql")).toBeNull();
    expect(parseMigrationFile("001_init.sql.bak")).toBeNull();
  });

  it("orders numerically, not alphabetically", () => {
    const ordered = orderMigrations([
      { file: "010_ten.sql", sql: "select 10" },
      { file: "002_two.sql", sql: "select 2" },
      { file: "1000_big.sql", sql: "select 1000" },
      { file: "001_one.sql", sql: "select 1" },
    ]);
    expect(ordered.map((m) => m.version)).toEqual([1, 2, 10, 1000]);
  });

  it("rejects duplicate numbers and bad names", () => {
    expect(() =>
      orderMigrations([
        { file: "002_a.sql", sql: "" },
        { file: "002_b.sql", sql: "" },
      ]),
    ).toThrow(/share the number 2/);
    expect(() => orderMigrations([{ file: "notes.sql", sql: "" }])).toThrow(/NNN_name\.sql/);
  });

  it("ignores line endings when checksumming", () => {
    expect(checksumOf("select 1;\r\nselect 2;\r\n")).toBe(checksumOf("select 1;\nselect 2;\n"));
    expect(checksumOf("select 1;")).not.toBe(checksumOf("select 2;"));
  });

  it("loads the bundled migrations as a gap-free sequence", async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, index) => index + 1));
    for (const migration of migrations) expect(migration.sql.trim().length).toBeGreaterThan(0);
  });
});

describe("row mapping", () => {
  const created = new Date("2026-01-02T03:04:05.678Z");
  const updated = new Date("2026-02-03T04:05:06.789Z");

  it("maps a summary row, leaving out an absent description", () => {
    const base = { id: "d1", name: "Flow", type: "flowchart", node_count: 3, edge_count: 2, open_comments: 1, version: 9, created_at: created, updated_at: updated };
    expect(toDiagramSummary({ ...base, description: null })).toEqual({
      id: "d1",
      name: "Flow",
      type: "flowchart",
      nodeCount: 3,
      edgeCount: 2,
      openComments: 1,
      createdAt: "2026-01-02T03:04:05.678Z",
      updatedAt: "2026-02-03T04:05:06.789Z",
      version: 9,
    });
    expect(toDiagramSummary({ ...base, description: "About" }).description).toBe("About");
  });

  it("maps a snapshot row", () => {
    const author = { kind: "agent" as const, id: "claude", name: "Claude" };
    expect(toSnapshotInfo({ id: "s_1", name: "Before", author, node_count: 4, edge_count: 5, created_at: created })).toEqual({
      id: "s_1",
      name: "Before",
      author,
      nodeCount: 4,
      edgeCount: 5,
      createdAt: "2026-01-02T03:04:05.678Z",
    });
  });

  it("sorts newest first with a stable tie-break", () => {
    const make = (id: string, updatedAt: string) => ({ id, updatedAt }) as Parameters<typeof newestFirst>[0];
    const sorted = [make("b", "2026-01-01"), make("c", "2026-03-01"), make("a", "2026-01-01")].sort(newestFirst);
    expect(sorted.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("parameter helpers", () => {
  it("drops NUL characters that PostgreSQL would reject", () => {
    const text = toJson({ text: "a\u0000b", nested: ["\u0000x"], literal: "\\u0000" });
    expect(JSON.parse(text)).toEqual({ text: "ab", nested: ["x"], literal: "\\u0000" });
  });

  it("leaves ordinary documents untouched", () => {
    const value = { a: 1, b: "two", c: [true, null] };
    expect(toJson(value)).toBe(JSON.stringify(value));
  });

  it("falls back for timestamps that do not parse", () => {
    const fallback = new Date("2026-05-06T07:08:09.000Z");
    expect(toTimestamp("2026-01-02T03:04:05.678Z")).toBe("2026-01-02T03:04:05.678Z");
    expect(toTimestamp("last tuesday", fallback)).toBe(fallback.toISOString());
    expect(toTimestamp(undefined, fallback)).toBe(fallback.toISOString());
  });
});

describe("transient errors", () => {
  it("retries connection trouble and restarts", () => {
    expect(isTransientError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("terminating connection"), { code: "57P01" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("deadlock"), { code: "40P01" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("x"), { code: "08006" }))).toBe(true);
    expect(isTransientError(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isTransientError(new Error("timeout exceeded when trying to connect"))).toBe(true);
  });

  it("does not retry bad data or schema problems", () => {
    expect(isTransientError(Object.assign(new Error("unsupported Unicode escape sequence"), { code: "22P05" }))).toBe(false);
    expect(isTransientError(Object.assign(new Error('relation "diagrams" does not exist'), { code: "42P01" }))).toBe(false);
    expect(isTransientError(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(false);
    expect(isTransientError("boom")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});
