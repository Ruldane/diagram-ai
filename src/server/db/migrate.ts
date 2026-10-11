import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";

import { checkout, rows, type Queryable } from "./sql";

/** Runtime location (not bundled), like the data directories in `server/config.ts`. */
export const MIGRATIONS_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "src", "server", "db", "migrations");

const FILE_PATTERN = /^(\d{3,})_([a-z0-9][a-z0-9_]*)\.sql$/;

export interface Migration {
  /** Numeric prefix of the file name; migrations apply in ascending order. */
  version: number;
  /** File name without the extension, e.g. `001_init`. */
  name: string;
  sql: string;
  /** Detects a migration that was edited after it was applied. */
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: Migration[];
  /** Applied to this database but absent from this checkout (e.g. a newer branch ran them). */
  unknown: AppliedMigration[];
}

export interface MigrateResult {
  /** Names of the migrations applied by this call. */
  applied: string[];
  /** Migrations recorded in the database afterwards. */
  total: number;
}

export function parseMigrationFile(file: string): { version: number; name: string } | null {
  const match = FILE_PATTERN.exec(file);
  return match ? { version: Number(match[1]), name: file.slice(0, -".sql".length) } : null;
}

/** Line endings must not change the checksum: git may rewrite them per platform. */
export const checksumOf = (sql: string): string => createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

/** Validates `NNN_name.sql` files and returns them in application order. */
export function orderMigrations(files: { file: string; sql: string }[]): Migration[] {
  const seen = new Map<number, string>();
  const migrations: Migration[] = [];
  for (const { file, sql } of files) {
    const parsed = parseMigrationFile(file);
    if (!parsed) throw new Error(`Migration file "${file}" must be named NNN_name.sql (lower-case letters, digits and underscores).`);
    const clash = seen.get(parsed.version);
    if (clash) throw new Error(`Migrations "${clash}" and "${file}" share the number ${parsed.version}; give the newer one the next free number.`);
    seen.set(parsed.version, file);
    migrations.push({ ...parsed, sql, checksum: checksumOf(sql) });
  }
  return migrations.sort((a, b) => a.version - b.version);
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".sql"));
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    throw new Error(`Migrations folder not found: ${dir}. Start the app (or the script) from the project root.`, { cause: error });
  }
  const files = await Promise.all(names.map(async (file) => ({ file, sql: await readFile(path.join(dir, file), "utf8") })));
  return orderMigrations(files);
}

interface MigrationRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
}

async function readApplied(db: Queryable): Promise<AppliedMigration[]> {
  const [exists] = await rows<{ present: boolean }>(db, "SELECT to_regclass('schema_migrations') IS NOT NULL AS present");
  if (!exists?.present) return [];
  const applied = await rows<MigrationRow>(db, "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version");
  return applied.map((row) => ({ version: row.version, name: row.name, checksum: row.checksum, appliedAt: row.applied_at }));
}

function compare(migrations: Migration[], applied: AppliedMigration[]): MigrationStatus {
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const entry of applied) {
    const local = known.get(entry.version);
    if (local && local.checksum !== entry.checksum) {
      throw new Error(`Migration ${local.name} was changed after it was applied. Do not edit applied migrations: add a new one (or run "npm run db:reset" on a development database).`);
    }
  }
  const done = new Set(applied.map((m) => m.version));
  return {
    applied: applied.filter((m) => known.has(m.version)),
    pending: migrations.filter((m) => !done.has(m.version)),
    unknown: applied.filter((m) => !known.has(m.version)),
  };
}

/** Which migrations are applied and which are waiting. Throws when an applied one was edited. */
export async function migrationStatus(pool: Pool, dir?: string): Promise<MigrationStatus> {
  return compare(await loadMigrations(dir), await readApplied(pool));
}

/**
 * Applies pending migrations in order, each in its own transaction. Safe to
 * call concurrently from several processes: an advisory lock serialises runs.
 */
export async function migrate(pool: Pool, options: { dir?: string; log?: (message: string) => void } = {}): Promise<MigrateResult> {
  const migrations = await loadMigrations(options.dir);
  const { client, release } = await checkout(pool);
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('diagram-ai:migrate'))");
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    integer     PRIMARY KEY,
           name       text        NOT NULL,
           checksum   text        NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      // Read after taking the lock: another process may have just applied some.
      const status = compare(migrations, await readApplied(client));
      for (const migration of status.pending) {
        try {
          await client.query("BEGIN");
          await client.query(migration.sql);
          await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [migration.version, migration.name, migration.checksum]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          const failure = new Error(`Migration ${migration.name} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
          // Keep the original code so a dropped connection is still recognised as transient.
          throw Object.assign(failure, { code: (error as { code?: unknown }).code });
        }
        applied.push(migration.name);
        options.log?.(`Applied migration ${migration.name}`);
      }
      if (status.unknown.length) {
        options.log?.(`Database has migrations this checkout does not know: ${status.unknown.map((m) => m.name).join(", ")}`);
      }
      return { applied, total: status.applied.length + applied.length + status.unknown.length };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('diagram-ai:migrate'))").catch(() => undefined);
    }
  } finally {
    release();
  }
}
