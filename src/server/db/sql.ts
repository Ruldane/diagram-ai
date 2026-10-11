import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/** What both a `Pool` and a checked-out `PoolClient` can do; lets helpers run inside or outside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/** Runs a statement and returns its rows. */
export async function rows<R extends QueryResultRow>(db: Queryable, text: string, values?: unknown[]): Promise<R[]> {
  return (await db.query<R>(text, values)).rows;
}

/**
 * Checks a connection out of the pool. The pool only listens for errors on idle
 * connections, so one that drops while checked out (database restart, network
 * loss) would emit an unhandled 'error' event and crash the process. The failure
 * still reaches the caller through the query that was running.
 */
export async function checkout(pool: Pool): Promise<{ client: PoolClient; release: (broken?: boolean) => void }> {
  const client = await pool.connect();
  const ignore = () => undefined;
  client.on("error", ignore);
  return {
    client,
    release: (broken = false) => {
      client.removeListener("error", ignore);
      client.release(broken);
    },
  };
}

/** Runs `work` between BEGIN and COMMIT on one connection, rolling back if it throws. */
export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const { client, release } = await checkout(pool);
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // If even ROLLBACK fails the connection is unusable: hand it back to be destroyed.
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    release(broken);
  }
}

/**
 * JSON text for a jsonb parameter. PostgreSQL rejects U+0000 inside jsonb
 * strings, which would make a whole diagram unsavable over one stray
 * character, so those are dropped.
 */
export function toJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (!text.includes("\\u0000")) return text;
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "string" ? item.replace(/\u0000/g, "") : item));
}

/** A timestamptz parameter. Documents carry free-form ISO strings, so an unparsable one must not fail the write. */
export function toTimestamp(iso: string | undefined, fallback: Date = new Date()): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return (Number.isNaN(time) ? fallback : new Date(time)).toISOString();
}
