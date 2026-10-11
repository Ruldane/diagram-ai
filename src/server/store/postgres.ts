import type { Pool } from "pg";

import { summarize } from "@/core/model/defaults";
import { isSafeId } from "@/core/model/ids";
import { docSchema, formatIssues } from "@/core/model/schema";
import type { Actor, DiagramDoc, DiagramSummary, Id, Patch } from "@/core/model/types";
import type { SnapshotInfo } from "@/core/protocol";

import { MAX_OPS_PER_DIAGRAM, MAX_SNAPSHOTS } from "../config";
import { createDatabaseState, Database, type DatabaseState } from "../db/database";
import { describeError, isTransientError } from "../db/errors";
import { insertOps, trimOps, trimSnapshots, writeDiagram, writeReviewBase, writeSnapshot, type OpRecord } from "../db/queries";
import { newestFirst, SUMMARY_COLUMNS, toDiagramSummary, toSnapshotInfo as toSnapshotInfoFromRow, type SnapshotRow, type SummaryRow } from "../db/rows";
import { inTransaction, rows } from "../db/sql";
import { invalid } from "../errors";
import type { DiagramRepository, ReviewBase, Snapshot } from "./repository";

export interface PostgresOptions {
  /** Quiet period after the last save before a diagram is written. */
  writeDelayMs: number;
  /** A diagram that is edited without pause is still written at least this often. */
  maxWriteWaitMs: number;
  /** Pauses between attempts when a write fails for a transient reason (connection loss, restart…). */
  retryDelaysMs: number[];
  /** Wait before trying again once the attempts above are used up. */
  backgroundRetryMs: number;
  /** Documents kept in memory. One with unwritten changes is never dropped. */
  maxCachedDocs: number;
}

export const DEFAULT_POSTGRES_OPTIONS: PostgresOptions = {
  writeDelayMs: 150,
  maxWriteWaitMs: 2_000,
  retryDelaysMs: [250, 500, 1_000, 2_000],
  backgroundRetryMs: 15_000,
  maxCachedDocs: 256,
};

/** The change log is trimmed after this many appended entries, so it may overshoot its limit by about this much. */
const TRIM_OPS_EVERY = 100;

/** Where one diagram stands on its way to the database. */
interface WriteState {
  /** Bumped on every change; `persisted` catches up once that change is in the database. */
  rev: number;
  persisted: number;
  /** Debounce timer for the next write. */
  timer: NodeJS.Timeout | null;
  /** When the current burst of changes began (0 = none), so constant editing cannot postpone a write forever. */
  burstStart: number;
  /** The write loop, while one is running. */
  running: Promise<void> | null;
  /** Background retry after a failure that may pass. */
  retry: NodeJS.Timeout | null;
  /** The last attempt gave up. Cleared by the next change or flush. */
  failed: boolean;
  /** Change-log entries to write with the next version. */
  ops: OpRecord[];
  opsSinceTrim: number;
}

/**
 * Process-wide data behind `PostgresRepository`; lives on `globalThis` like the
 * file repository's state (see `server/context.ts`).
 */
export interface PostgresState {
  database: DatabaseState;
  /** Loaded documents. The in-memory copy is authoritative: this is the only process writing them. */
  docs: Map<Id, DiagramDoc>;
  writes: Map<Id, WriteState>;
  /** Review baselines by diagram (null = loaded, none pending). */
  reviews: Map<Id, ReviewBase | null>;
  /** Rows that failed validation when read; hidden from listings until rewritten. */
  corrupt: Set<Id>;
  /** Deletions seen per diagram, so a read that was in flight cannot bring a deleted document back. */
  deletions: Map<Id, number>;
}

export const createPostgresState = (database: DatabaseState = createDatabaseState()): PostgresState => ({
  database,
  docs: new Map(),
  writes: new Map(),
  reviews: new Map(),
  corrupt: new Set(),
  deletions: new Map(),
});

function assertSafe(id: Id) {
  if (!isSafeId(id)) throw invalid(`"${id}" is not a valid id.`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Diagrams in PostgreSQL. Behaves like the file repository from the caller's
 * side: `save` returns at once and writes are coalesced; what differs is where
 * the bytes end up and that listings are answered from summary columns.
 */
export class PostgresRepository implements DiagramRepository {
  private readonly db: Database;
  private readonly options: PostgresOptions;

  /** State is passed in so it can outlive this instance (see `server/context.ts`). */
  constructor(
    private readonly state: PostgresState = createPostgresState(),
    options: Partial<PostgresOptions> = {},
  ) {
    this.db = new Database(state.database);
    this.options = { ...DEFAULT_POSTGRES_OPTIONS, ...options };
  }

  /** The pool, once the schema is known to be usable. */
  private async pool(): Promise<Pool> {
    await this.db.ready();
    return this.db.pool;
  }

  /* ---------------------------------------------------------------- reads */

  async list(): Promise<DiagramSummary[]> {
    const pool = await this.pool();
    const stored = await rows<SummaryRow>(pool, `SELECT ${SUMMARY_COLUMNS} FROM diagrams ORDER BY updated_at DESC`);
    const summaries = new Map<Id, DiagramSummary>();
    for (const row of stored) if (!this.state.corrupt.has(row.id)) summaries.set(row.id, toDiagramSummary(row));
    // Changes not written yet are newer than their row (or have no row at all).
    for (const [id, write] of this.state.writes) {
      const doc = this.state.docs.get(id);
      if (doc && write.rev > write.persisted) summaries.set(id, summarize(doc));
    }
    return [...summaries.values()].sort(newestFirst);
  }

  async get(id: Id): Promise<DiagramDoc | null> {
    assertSafe(id);
    const cached = this.state.docs.get(id);
    if (cached) {
      this.cache(cached); // most recently used
      return cached;
    }
    if (this.state.corrupt.has(id)) return null;

    const pool = await this.pool();
    const deletions = this.state.deletions.get(id) ?? 0;
    const [row] = await rows<{ doc: unknown }>(pool, "SELECT doc FROM diagrams WHERE id = $1", [id]);
    if (!row) return null;
    const parsed = docSchema.safeParse(row.doc);
    if (!parsed.success) {
      this.state.corrupt.add(id);
      console.warn(`[diagram-ai] Skipping unreadable diagram ${id}: ${formatIssues(parsed.error)}`);
      return null;
    }
    // Something may have saved or deleted it while the query was running.
    const current = this.state.docs.get(id);
    if (current) return current;
    if ((this.state.deletions.get(id) ?? 0) !== deletions) return null;
    const doc = parsed.data as DiagramDoc;
    this.cache(doc);
    return doc;
  }

  /* --------------------------------------------------------------- writes */

  save(doc: DiagramDoc): void {
    assertSafe(doc.id);
    // Marked as changed before it is cached, so the cache can never evict it as "clean".
    const write = this.writeState(doc.id);
    write.rev += 1;
    write.failed = false;
    this.state.corrupt.delete(doc.id);
    this.cache(doc);
    this.schedule(doc.id, write);
  }

  appendOp(diagramId: Id, version: number, actor: Actor, patch: Patch): void {
    if (!isSafeId(diagramId)) return;
    const write = this.writeState(diagramId);
    write.ops.push({ version, actor, patch, at: new Date().toISOString() });
    // Entries beyond the retention limit would be trimmed straight away; do not buffer them while the database is away.
    if (write.ops.length > MAX_OPS_PER_DIAGRAM) write.ops.splice(0, write.ops.length - MAX_OPS_PER_DIAGRAM);
    // Normally a `save` of the same version just happened; this covers an op recorded on its own.
    write.rev += 1;
    this.schedule(diagramId, write);
  }

  async flush(): Promise<void> {
    let ids = this.dirty(true);
    for (let pass = 0; ids.length && pass < 5; pass++) {
      await Promise.all(ids.map((id) => this.run(id)));
      // What failed above already has its retry scheduled; only look at what changed meanwhile.
      ids = this.dirty(false);
    }
  }

  async delete(id: Id): Promise<void> {
    assertSafe(id);
    this.state.deletions.set(id, (this.state.deletions.get(id) ?? 0) + 1);
    this.state.docs.delete(id);
    this.state.reviews.delete(id);
    this.state.corrupt.delete(id);
    const write = this.state.writes.get(id);
    if (write) {
      if (write.timer) clearTimeout(write.timer);
      if (write.retry) clearTimeout(write.retry);
      write.timer = write.retry = null;
      write.ops = [];
      write.persisted = write.rev;
      // A write already on its way must land before the delete, or it would bring the row back.
      await write.running;
    }
    const pool = await this.pool();
    await this.withRetry(() => pool.query("DELETE FROM diagrams WHERE id = $1", [id])); // cascades to snapshots, review base and log
    if (write && this.state.writes.get(id) === write) this.state.writes.delete(id);
  }

  /* --------------------------------------------------------- write queue */

  private writeState(id: Id): WriteState {
    let write = this.state.writes.get(id);
    if (!write) {
      write = { rev: 0, persisted: 0, timer: null, burstStart: 0, running: null, retry: null, failed: false, ops: [], opsSinceTrim: 0 };
      this.state.writes.set(id, write);
    }
    return write;
  }

  /** (Re)starts the quiet-period timer; bursts are coalesced and the latest document wins. */
  private schedule(id: Id, write: WriteState): void {
    if (write.timer) clearTimeout(write.timer);
    const now = Date.now();
    write.burstStart ||= now;
    const wait = Math.max(0, Math.min(this.options.writeDelayMs, write.burstStart + this.options.maxWriteWaitMs - now));
    write.timer = setTimeout(() => {
      write.timer = null;
      void this.run(id);
    }, wait);
  }

  /** Writes whatever is pending for a diagram now. Never rejects; failures are logged and retried. */
  private run(id: Id): Promise<void> {
    const write = this.state.writes.get(id);
    if (!write) return Promise.resolve();
    if (write.timer) clearTimeout(write.timer);
    if (write.retry) clearTimeout(write.retry);
    write.timer = write.retry = null;
    write.burstStart = 0;
    if (!write.running) {
      write.failed = false;
      write.running = this.drain(id, write).finally(() => {
        write.running = null;
      });
    }
    return write.running;
  }

  /** Writes until the database has caught up with the newest version of the diagram. */
  private async drain(id: Id, write: WriteState): Promise<void> {
    try {
      while (write.rev > write.persisted) {
        await this.withRetry(async () => {
          const pool = await this.pool();
          // Looked up per attempt: a retry should write the newest document, not the one that first failed.
          const rev = write.rev;
          const doc = this.state.docs.get(id);
          if (!doc) {
            write.persisted = rev; // deleted meanwhile
            write.ops = [];
            return;
          }
          const ops = write.ops.slice();
          await this.writeOnce(pool, doc, ops, write);
          write.persisted = Math.max(write.persisted, rev);
          if (ops.length) {
            const written = new Set(ops);
            write.ops = write.ops.filter((op) => !written.has(op));
          }
        });
      }
    } catch (error) {
      this.giveUp(id, write, error);
    }
  }

  private async writeOnce(pool: Pool, doc: DiagramDoc, ops: OpRecord[], write: WriteState): Promise<void> {
    if (!ops.length) {
      await writeDiagram(pool, doc); // one statement is atomic by itself
      return;
    }
    const trim = write.opsSinceTrim + ops.length >= TRIM_OPS_EVERY;
    await inTransaction(pool, async (client) => {
      await writeDiagram(client, doc);
      await insertOps(client, doc.id, ops);
      if (trim) await trimOps(client, doc.id, MAX_OPS_PER_DIAGRAM);
    });
    write.opsSinceTrim = trim ? 0 : write.opsSinceTrim + ops.length;
  }

  /** The attempts are used up: keep the document in memory (it is never evicted while dirty) and say so. */
  private giveUp(id: Id, write: WriteState, error: unknown): void {
    write.failed = true;
    const transient = isTransientError(error);
    const again = transient ? `; trying again in ${Math.round(this.options.backgroundRetryMs / 1000)}s` : "; it will be retried when the diagram changes again";
    console.error(`[diagram-ai] Could not save diagram ${id} to PostgreSQL${again}: ${describeError(error)}`);
    if (transient && !write.retry) {
      write.retry = setTimeout(() => {
        write.retry = null;
        void this.run(id);
      }, this.options.backgroundRetryMs);
      write.retry.unref();
    }
  }

  private async withRetry<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await task();
      } catch (error) {
        const delay = this.options.retryDelaysMs[attempt];
        if (delay === undefined || !isTransientError(error)) throw error;
        await sleep(delay);
      }
    }
  }

  private dirty(includeFailed: boolean): Id[] {
    const ids: Id[] = [];
    for (const [id, write] of this.state.writes) {
      const pending = write.timer || write.running || write.rev > write.persisted;
      if (pending && (includeFailed || !write.failed)) ids.push(id);
    }
    return ids;
  }

  /** Waits until a diagram's row exists, so rows that reference it cannot violate the foreign key. */
  private async persisted(id: Id): Promise<void> {
    const write = this.state.writes.get(id);
    if (!write || !(write.timer || write.running || write.rev > write.persisted)) return;
    await this.run(id);
    if (write.failed) throw new Error(`Diagram ${id} could not be saved to the database; see the server log.`);
  }

  /* ---------------------------------------------------------------- cache */

  /** Inserts (or moves to the front) and drops the least recently used documents that are safely stored. */
  private cache(doc: DiagramDoc): void {
    const { docs, writes } = this.state;
    docs.delete(doc.id);
    docs.set(doc.id, doc);
    if (docs.size <= this.options.maxCachedDocs) return;
    for (const id of docs.keys()) {
      if (docs.size <= this.options.maxCachedDocs) break;
      if (id === doc.id) continue;
      const write = writes.get(id);
      if (write && (write.timer || write.running || write.rev > write.persisted)) continue;
      docs.delete(id);
    }
  }

  /* --------------------------------------------------------------- review */

  async getReviewBase(id: Id): Promise<ReviewBase | null> {
    assertSafe(id);
    const cached = this.state.reviews.get(id);
    if (cached !== undefined) return cached;
    const pool = await this.pool();
    const [row] = await rows<{ doc: unknown; by_actor: Actor | null; since: Date }>(
      pool,
      "SELECT doc, by_actor, since FROM diagram_review_bases WHERE diagram_id = $1",
      [id],
    );
    let base: ReviewBase | null = null;
    if (row) {
      const parsed = docSchema.safeParse(row.doc);
      if (parsed.success) base = { doc: parsed.data as DiagramDoc, ...(row.by_actor ? { by: row.by_actor } : {}), since: row.since.toISOString() };
      else console.warn(`[diagram-ai] Ignoring unreadable review baseline for ${id}: ${formatIssues(parsed.error)}`);
    }
    // A setReviewBase may have landed while the query ran; it wins.
    const current = this.state.reviews.get(id);
    if (current !== undefined) return current;
    this.state.reviews.set(id, base);
    return base;
  }

  async setReviewBase(id: Id, base: ReviewBase | null): Promise<void> {
    assertSafe(id);
    this.state.reviews.set(id, base);
    const pool = await this.pool();
    if (!base) {
      await this.withRetry(() => pool.query("DELETE FROM diagram_review_bases WHERE diagram_id = $1", [id]));
      return;
    }
    await this.persisted(id);
    await this.withRetry(() => writeReviewBase(pool, id, base));
  }

  /* ------------------------------------------------------------ snapshots */

  async listSnapshots(id: Id): Promise<SnapshotInfo[]> {
    assertSafe(id);
    const pool = await this.pool();
    const found = await rows<SnapshotRow>(
      pool,
      "SELECT id, name, author, node_count, edge_count, created_at FROM diagram_snapshots WHERE diagram_id = $1 ORDER BY created_at DESC, id DESC",
      [id],
    );
    return found.map(toSnapshotInfoFromRow);
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    assertSafe(snapshot.id);
    const diagramId = snapshot.doc.id;
    assertSafe(diagramId);
    const pool = await this.pool();
    await this.persisted(diagramId);
    await this.withRetry(() =>
      inTransaction(pool, async (client) => {
        await writeSnapshot(client, snapshot);
        await trimSnapshots(client, diagramId, MAX_SNAPSHOTS);
      }),
    );
  }

  async getSnapshot(id: Id, snapshotId: Id): Promise<Snapshot | null> {
    assertSafe(id);
    assertSafe(snapshotId);
    const pool = await this.pool();
    const [row] = await rows<SnapshotRow & { doc: unknown }>(
      pool,
      "SELECT id, name, author, node_count, edge_count, created_at, doc FROM diagram_snapshots WHERE diagram_id = $1 AND id = $2",
      [id, snapshotId],
    );
    if (!row) return null;
    const parsed = docSchema.safeParse(row.doc);
    if (!parsed.success) {
      console.warn(`[diagram-ai] Skipping unreadable checkpoint ${snapshotId} of ${id}: ${formatIssues(parsed.error)}`);
      return null;
    }
    return { ...toSnapshotInfoFromRow(row), doc: parsed.data as DiagramDoc };
  }
}
