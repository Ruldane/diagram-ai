import { summarize } from "@/core/model/defaults";
import type { Actor, DiagramDoc, Id, Patch } from "@/core/model/types";

import type { ReviewBase, Snapshot } from "../store/repository";
import { rows, toJson, toTimestamp, type Queryable } from "./sql";

/**
 * Statements shared by the repository and the file importer, so both write
 * the same shape. Every function takes a pool or a transaction client.
 */

/** A change-log entry waiting to be written with its diagram. */
export interface OpRecord {
  version: number;
  actor: Actor;
  patch: Patch;
  at: string;
}

const INSERT_DIAGRAM = `INSERT INTO diagrams
  (id, name, type, description, doc, version, node_count, edge_count, open_comments, owner_id, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz)`;

const UPSERT_DIAGRAM = `${INSERT_DIAGRAM}
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, type = EXCLUDED.type, description = EXCLUDED.description, doc = EXCLUDED.doc,
    version = EXCLUDED.version, node_count = EXCLUDED.node_count, edge_count = EXCLUDED.edge_count,
    open_comments = EXCLUDED.open_comments, owner_id = COALESCE(EXCLUDED.owner_id, diagrams.owner_id),
    updated_at = EXCLUDED.updated_at
  RETURNING (xmax = 0) AS inserted`;

const INSERT_DIAGRAM_IF_MISSING = `${INSERT_DIAGRAM} ON CONFLICT (id) DO NOTHING RETURNING true AS inserted`;

export interface DiagramWriteOptions {
  /** Owner to record. Left alone on an existing row when absent. */
  ownerId?: string | null;
  /** Do nothing if the diagram already exists. */
  ifMissing?: boolean;
}

/** Inserts or replaces a diagram row, refreshing its denormalised summary columns. */
export async function writeDiagram(db: Queryable, doc: DiagramDoc, options: DiagramWriteOptions = {}): Promise<"inserted" | "updated" | "skipped"> {
  const stats = summarize(doc);
  const now = new Date();
  const result = await rows<{ inserted: boolean }>(db, options.ifMissing ? INSERT_DIAGRAM_IF_MISSING : UPSERT_DIAGRAM, [
    doc.id,
    doc.name,
    doc.type,
    doc.description ?? null,
    toJson(doc),
    doc.version,
    stats.nodeCount,
    stats.edgeCount,
    stats.openComments,
    options.ownerId ?? null,
    toTimestamp(doc.createdAt, now),
    toTimestamp(doc.updatedAt, now),
  ]);
  if (!result.length) return "skipped";
  return result[0].inserted ? "inserted" : "updated";
}

const OPS_PER_STATEMENT = 500;

/** Appends change-log entries. Replaying a version that is already recorded is a no-op. */
export async function insertOps(db: Queryable, diagramId: Id, ops: readonly OpRecord[]): Promise<void> {
  for (let start = 0; start < ops.length; start += OPS_PER_STATEMENT) {
    const values: unknown[] = [diagramId];
    const tuples = ops.slice(start, start + OPS_PER_STATEMENT).map((op) => {
      const first = values.length + 1;
      values.push(op.version, toJson(op.actor), toJson(op.patch), toTimestamp(op.at));
      return `($1, $${first}, $${first + 1}::jsonb, $${first + 2}::jsonb, $${first + 3}::timestamptz)`;
    });
    await db.query(
      `INSERT INTO diagram_ops (diagram_id, version, actor, patch, created_at) VALUES ${tuples.join(", ")} ON CONFLICT (diagram_id, version) DO NOTHING`,
      values,
    );
  }
}

/** Drops all but the newest `keep` change-log entries of a diagram. */
export async function trimOps(db: Queryable, diagramId: Id, keep: number): Promise<void> {
  await db.query(
    `DELETE FROM diagram_ops WHERE diagram_id = $1 AND version <= (
       SELECT version FROM diagram_ops WHERE diagram_id = $1 ORDER BY version DESC OFFSET $2 LIMIT 1)`,
    [diagramId, keep],
  );
}

export async function writeSnapshot(db: Queryable, snapshot: Snapshot): Promise<void> {
  await db.query(
    `INSERT INTO diagram_snapshots (diagram_id, id, name, author, node_count, edge_count, doc, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::timestamptz)
     ON CONFLICT (diagram_id, id) DO UPDATE SET
       name = EXCLUDED.name, author = EXCLUDED.author, node_count = EXCLUDED.node_count,
       edge_count = EXCLUDED.edge_count, doc = EXCLUDED.doc, created_at = EXCLUDED.created_at`,
    [
      snapshot.doc.id,
      snapshot.id,
      snapshot.name,
      toJson(snapshot.author),
      snapshot.nodeCount,
      snapshot.edgeCount,
      toJson(snapshot.doc),
      toTimestamp(snapshot.createdAt),
    ],
  );
}

/** Keeps only the newest `keep` snapshots of a diagram. */
export async function trimSnapshots(db: Queryable, diagramId: Id, keep: number): Promise<void> {
  await db.query(
    `DELETE FROM diagram_snapshots WHERE diagram_id = $1 AND id IN (
       SELECT id FROM diagram_snapshots WHERE diagram_id = $1 ORDER BY created_at DESC, id DESC OFFSET $2)`,
    [diagramId, keep],
  );
}

export async function writeReviewBase(db: Queryable, diagramId: Id, base: ReviewBase): Promise<void> {
  await db.query(
    `INSERT INTO diagram_review_bases (diagram_id, doc, by_actor, since) VALUES ($1, $2::jsonb, $3::jsonb, $4::timestamptz)
     ON CONFLICT (diagram_id) DO UPDATE SET doc = EXCLUDED.doc, by_actor = EXCLUDED.by_actor, since = EXCLUDED.since`,
    [diagramId, toJson(base.doc), base.by ? toJson(base.by) : null, toTimestamp(base.since)],
  );
}
