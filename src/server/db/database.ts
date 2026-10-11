import { Pool, type PoolConfig } from "pg";

import { autoMigrate, databaseUrl } from "../config";
import { migrate, migrationStatus } from "./migrate";
import { rows } from "./sql";

/**
 * Connection pool and "migrations are applied" flag. Kept as plain data on
 * `globalThis` (see `server/context.ts`) so hot reloads reuse one pool instead
 * of opening a new set of connections each time a module is recompiled.
 */
export interface DatabaseState {
  pool: Pool | null;
  /** Settles with the number of applied migrations once the schema is usable. */
  ready: Promise<number> | null;
}

export const createDatabaseState = (pool: Pool | null = null, ready: Promise<number> | null = null): DatabaseState => ({ pool, ready });

/** Creates a pool with this app's defaults. The caller owns it and must `end()` it. */
export function createPool(url: string, config: PoolConfig = {}): Pool {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    application_name: "diagram-ai",
    ...config,
  });
  // A dropped idle connection (database restart) is reported here; unhandled, it would take the process down.
  pool.on("error", (error) => console.error("[diagram-ai] PostgreSQL connection error:", error.message));
  return pool;
}

/** `host:port/database` of a connection string: safe to log, never includes credentials. */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(custom connection string)";
  }
}

export class Database {
  /** State is passed in so it can outlive this instance (see `server/context.ts`). */
  constructor(private readonly state: DatabaseState = createDatabaseState()) {}

  get pool(): Pool {
    if (!this.state.pool) {
      const url = databaseUrl();
      if (!url) throw new Error("DATABASE_URL is not set.");
      this.state.pool = createPool(url);
    }
    return this.state.pool;
  }

  /**
   * Resolves once the schema is usable: it migrates when `DIAGRAM_AI_AUTO_MIGRATE`
   * allows, otherwise it verifies that nothing is pending. A failure is not
   * remembered, so the next call tries again (the database may simply not be up yet).
   */
  ready(): Promise<number> {
    this.state.ready ??= this.prepare().catch((error: unknown) => {
      this.state.ready = null;
      throw error;
    });
    return this.state.ready;
  }

  private async prepare(): Promise<number> {
    if (autoMigrate()) {
      const result = await migrate(this.pool, { log: (message) => console.info(`[diagram-ai] ${message}`) });
      return result.total;
    }
    const status = await migrationStatus(this.pool);
    if (status.pending.length) {
      const names = status.pending.map((m) => m.name).join(", ");
      throw new Error(`Database migrations are pending (${names}). Run "npm run db:migrate", or remove DIAGRAM_AI_AUTO_MIGRATE=0.`);
    }
    return status.applied.length + status.unknown.length;
  }

  /** Round-trips to the database: the number of applied migrations, or a thrown error when it is unreachable. */
  async check(): Promise<number> {
    await this.ready();
    const [row] = await rows<{ count: number }>(this.pool, "SELECT count(*)::int AS count FROM schema_migrations");
    return row?.count ?? 0;
  }
}
