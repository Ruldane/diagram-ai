import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";
import { z } from "zod";

import { isSafeId } from "@/core/model/ids";
import { docSchema, formatIssues } from "@/core/model/schema";
import type { DiagramDoc } from "@/core/model/types";

import { MAX_SNAPSHOTS } from "../config";
import type { Snapshot } from "../store/repository";
import { trimSnapshots, writeDiagram, writeReviewBase, writeSnapshot } from "./queries";
import { inTransaction } from "./sql";

/** Moves diagrams from the JSON-file layout (`<dir>/diagrams`, `/snapshots`, `/review`) into PostgreSQL. */

const actorSchema = z.object({ kind: z.enum(["human", "agent", "system"]), id: z.string(), name: z.string() });

const snapshotFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  author: actorSchema,
  createdAt: z.string(),
  nodeCount: z.number().int().min(0).optional(),
  edgeCount: z.number().int().min(0).optional(),
  doc: docSchema,
});

const reviewFileSchema = z.object({ doc: docSchema, by: actorSchema.optional(), since: z.string() });

export interface ImportOptions {
  /** Data directory containing `diagrams/`, and optionally `snapshots/` and `review/`. */
  dir: string;
  /**
   * Recorded as `owner_id` of the diagrams that are written. An email address is looked up among the accounts;
   * when the value is an account id (or an email that resolves to one) the diagrams also become that account's
   * own in the member list. Anything else is stored as given and claimed by the first account that registers.
   */
  owner?: string;
  /** Replace diagrams that already exist instead of skipping them. */
  overwrite?: boolean;
}

export interface ImportSummary {
  imported: number;
  /** Replaced because `overwrite` was set. */
  replaced: number;
  /** Already in the database and left alone. */
  skipped: number;
  snapshots: number;
  reviewBases: number;
  /** Files that could not be imported, with the reason. */
  problems: string[];
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Turns `--owner` into the value stored in `owner_id`, and says whether it names an existing account. */
async function resolveOwner(pool: Pool, owner: string | undefined): Promise<{ id: string | undefined; account: boolean }> {
  if (!owner) return { id: undefined, account: false };
  const found = await pool.query<{ id: string }>("SELECT id FROM users WHERE id = $1 OR email = lower($1) LIMIT 1", [owner.trim()]);
  if (found.rows[0]) return { id: found.rows[0].id, account: true };
  if (owner.includes("@")) throw new Error(`No account uses ${owner}. Register it first, or pass an account id.`);
  return { id: owner, account: false };
}

/**
 * Imports every diagram found under `dir`. Each diagram goes in its own
 * transaction together with its snapshots and review baseline, so a failure
 * never leaves half of one behind, and running it twice changes nothing.
 */
export async function importFiles(pool: Pool, options: ImportOptions): Promise<ImportSummary> {
  const diagramsDir = path.join(options.dir, "diagrams");
  const files = await listJson(diagramsDir);
  const summary: ImportSummary = { imported: 0, replaced: 0, skipped: 0, snapshots: 0, reviewBases: 0, problems: [] };
  const owner = await resolveOwner(pool, options.owner);

  for (const fileName of files) {
    const id = fileName.slice(0, -".json".length);
    const label = `diagrams/${fileName}`;
    let doc: DiagramDoc;
    try {
      const parsed = docSchema.safeParse(await readJson(path.join(diagramsDir, fileName)));
      if (!parsed.success) {
        summary.problems.push(`${label}: ${formatIssues(parsed.error)}`);
        continue;
      }
      doc = parsed.data as DiagramDoc;
    } catch (error) {
      summary.problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isSafeId(doc.id) || doc.id !== id) {
      summary.problems.push(`${label}: the file name and the document id (${doc.id}) differ`);
      continue;
    }

    const snapshots: Snapshot[] = [];
    for (const snapshotFile of await listJson(path.join(options.dir, "snapshots", id))) {
      try {
        const parsed = snapshotFileSchema.safeParse(await readJson(path.join(options.dir, "snapshots", id, snapshotFile)));
        if (parsed.success && isSafeId(parsed.data.id)) {
          const { doc: snapshotDoc, nodeCount, edgeCount, ...rest } = parsed.data;
          snapshots.push({
            ...rest,
            nodeCount: nodeCount ?? Object.keys(snapshotDoc.nodes).length,
            edgeCount: edgeCount ?? Object.keys(snapshotDoc.edges).length,
            doc: { ...(snapshotDoc as DiagramDoc), id },
          });
        } else {
          summary.problems.push(`snapshots/${id}/${snapshotFile}: ${parsed.success ? "invalid snapshot id" : formatIssues(parsed.error)}`);
        }
      } catch (error) {
        summary.problems.push(`snapshots/${id}/${snapshotFile}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let review: z.infer<typeof reviewFileSchema> | null = null;
    try {
      const raw = await readJson(path.join(options.dir, "review", fileName));
      const parsed = reviewFileSchema.safeParse(raw);
      if (parsed.success) review = parsed.data;
      else summary.problems.push(`review/${fileName}: ${formatIssues(parsed.error)}`);
    } catch (error) {
      // No baseline is the normal case; only a file that exists but cannot be read is a problem.
      if ((error as { code?: string }).code !== "ENOENT") summary.problems.push(`review/${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const outcome = await inTransaction(pool, async (client) => {
      const written = await writeDiagram(client, doc, { ownerId: owner.id, ifMissing: !options.overwrite });
      if (written === "skipped") return written;
      if (owner.account) {
        await client.query(
          `INSERT INTO diagram_members (diagram_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = 'owner'`,
          [id, owner.id],
        );
      }
      for (const snapshot of snapshots) await writeSnapshot(client, snapshot);
      if (snapshots.length) await trimSnapshots(client, id, MAX_SNAPSHOTS);
      if (review) await writeReviewBase(client, id, { doc: review.doc as DiagramDoc, ...(review.by ? { by: review.by } : {}), since: review.since });
      return written;
    });

    if (outcome === "skipped") {
      summary.skipped += 1;
      continue;
    }
    if (outcome === "inserted") summary.imported += 1;
    else summary.replaced += 1;
    summary.snapshots += snapshots.length;
    if (review) summary.reviewBases += 1;
  }

  return summary;
}
