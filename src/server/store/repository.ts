import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { summarize } from "@/core/model/defaults";
import { isSafeId } from "@/core/model/ids";
import { formatIssues, docSchema } from "@/core/model/schema";
import type { Actor, DiagramDoc, DiagramSummary, Id, Patch } from "@/core/model/types";
import type { SnapshotInfo } from "@/core/protocol";

import { DIAGRAMS_DIR, MAX_SNAPSHOTS, REVIEW_DIR, SNAPSHOTS_DIR } from "../config";
import { invalid } from "../errors";

export interface Snapshot extends SnapshotInfo {
  doc: DiagramDoc;
}

/**
 * Storage contract. The file-system implementation below keeps one JSON file
 * per diagram; swap it for a database-backed one without touching the service.
 */
export interface DiagramRepository {
  list(): Promise<DiagramSummary[]>;
  get(id: Id): Promise<DiagramDoc | null>;
  /** Persists the document. Writes are coalesced; call `flush` to force them out. */
  save(doc: DiagramDoc): void;
  delete(id: Id): Promise<void>;
  flush(): Promise<void>;
  listSnapshots(id: Id): Promise<SnapshotInfo[]>;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  getSnapshot(id: Id, snapshotId: Id): Promise<Snapshot | null>;
  /**
   * The review baseline: the diagram as it was when a person last accepted
   * (or, absent that, just before an agent first changed it). `null` when
   * nothing is pending review.
   */
  getReviewBase(id: Id): Promise<ReviewBase | null>;
  setReviewBase(id: Id, base: ReviewBase | null): Promise<void>;
  /**
   * Records the patch that produced `version`, for a change log. Call it right
   * after `save`; stores without a log ignore it.
   */
  appendOp?(diagramId: Id, version: number, actor: Actor, patch: Patch): void;
}

export interface ReviewBase {
  doc: DiagramDoc;
  by?: Actor;
  since: string;
}

const WRITE_DELAY_MS = 250;

function assertSafe(id: Id) {
  if (!isSafeId(id)) throw invalid(`"${id}" is not a valid id.`);
}

async function writeAtomic(file: string, contents: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, file);
}

export interface RepositoryState {
  /** Loaded documents; the in-memory copy is authoritative once loaded. */
  docs: Map<Id, DiagramDoc>;
  /** Debounced writes waiting to hit the disk. */
  pending: Map<Id, NodeJS.Timeout>;
  indexed: Promise<void> | null;
  /** Review baselines by diagram (null = loaded, none pending). */
  reviews: Map<Id, ReviewBase | null>;
}

export const createRepositoryState = (): RepositoryState => ({ docs: new Map(), pending: new Map(), indexed: null, reviews: new Map() });

export class FileRepository implements DiagramRepository {
  /** State is passed in so it can outlive this instance (see `server/context.ts`). */
  constructor(private readonly state: RepositoryState = createRepositoryState()) {}

  private get docs() {
    return this.state.docs;
  }

  private get pending() {
    return this.state.pending;
  }

  private file(id: Id): string {
    return path.join(DIAGRAMS_DIR, `${id}.json`);
  }

  private async read(id: Id): Promise<DiagramDoc | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(id), "utf8");
    } catch {
      return null;
    }
    const parsed = docSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn(`[diagram-ai] Skipping unreadable diagram ${id}: ${formatIssues(parsed.error)}`);
      return null;
    }
    return parsed.data as DiagramDoc;
  }

  /** Loads every diagram once so listing never touches the disk again. */
  private loadAll(): Promise<void> {
    this.state.indexed ??= (async () => {
      await mkdir(DIAGRAMS_DIR, { recursive: true });
      const files = (await readdir(DIAGRAMS_DIR)).filter((f) => f.endsWith(".json"));
      await Promise.all(
        files.map(async (fileName) => {
          const id = fileName.slice(0, -5);
          if (!isSafeId(id) || this.docs.has(id)) return;
          try {
            const doc = await this.read(id);
            if (doc && !this.docs.has(id)) this.docs.set(id, doc);
          } catch (error) {
            console.warn(`[diagram-ai] Could not read ${fileName}:`, error);
          }
        }),
      );
    })();
    return this.state.indexed;
  }

  async list(): Promise<DiagramSummary[]> {
    await this.loadAll();
    return [...this.docs.values()].map(summarize).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async get(id: Id): Promise<DiagramDoc | null> {
    assertSafe(id);
    await this.loadAll();
    return this.docs.get(id) ?? null;
  }

  save(doc: DiagramDoc): void {
    assertSafe(doc.id);
    this.docs.set(doc.id, doc);
    clearTimeout(this.pending.get(doc.id));
    this.pending.set(
      doc.id,
      setTimeout(() => void this.write(doc.id), WRITE_DELAY_MS),
    );
  }

  private async write(id: Id) {
    this.pending.delete(id);
    const doc = this.docs.get(id);
    if (!doc) return;
    try {
      await writeAtomic(this.file(id), JSON.stringify(doc, null, 2));
    } catch (error) {
      console.error(`[diagram-ai] Failed to save diagram ${id}:`, error);
    }
  }

  /** The JSON files keep no change log. */
  appendOp(): void {}

  async flush(): Promise<void> {
    const ids = [...this.pending.keys()];
    for (const id of ids) clearTimeout(this.pending.get(id));
    await Promise.all(ids.map((id) => this.write(id)));
  }

  async delete(id: Id): Promise<void> {
    assertSafe(id);
    clearTimeout(this.pending.get(id));
    this.pending.delete(id);
    this.docs.delete(id);
    await rm(this.file(id), { force: true });
    await rm(path.join(SNAPSHOTS_DIR, id), { recursive: true, force: true });
    await rm(path.join(REVIEW_DIR, `${id}.json`), { force: true });
    this.state.reviews.delete(id);
  }

  /* ------------------------------------------------------------ review */

  async getReviewBase(id: Id): Promise<ReviewBase | null> {
    assertSafe(id);
    const cached = this.state.reviews.get(id);
    if (cached !== undefined) return cached;
    let base: ReviewBase | null = null;
    try {
      base = JSON.parse(await readFile(path.join(REVIEW_DIR, `${id}.json`), "utf8")) as ReviewBase;
    } catch {
      base = null;
    }
    this.state.reviews.set(id, base);
    return base;
  }

  async setReviewBase(id: Id, base: ReviewBase | null): Promise<void> {
    assertSafe(id);
    this.state.reviews.set(id, base);
    const file = path.join(REVIEW_DIR, `${id}.json`);
    if (base) await writeAtomic(file, JSON.stringify(base));
    else await rm(file, { force: true });
  }

  /* --------------------------------------------------------- snapshots */

  private snapshotDir(id: Id): string {
    return path.join(SNAPSHOTS_DIR, id);
  }

  private async readSnapshots(id: Id): Promise<Snapshot[]> {
    assertSafe(id);
    let files: string[];
    try {
      files = (await readdir(this.snapshotDir(id))).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const snapshots = await Promise.all(
      files.map(async (fileName) => {
        try {
          return JSON.parse(await readFile(path.join(this.snapshotDir(id), fileName), "utf8")) as Snapshot;
        } catch {
          return null;
        }
      }),
    );
    return snapshots.filter((s): s is Snapshot => s !== null).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listSnapshots(id: Id): Promise<SnapshotInfo[]> {
    return (await this.readSnapshots(id)).map(toSnapshotInfo);
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    assertSafe(snapshot.id);
    const dir = this.snapshotDir(snapshot.doc.id);
    await writeAtomic(path.join(dir, `${snapshot.id}.json`), JSON.stringify(snapshot));
    // Keep the most recent snapshots only.
    const all = await this.readSnapshots(snapshot.doc.id);
    await Promise.all(all.slice(MAX_SNAPSHOTS).map((old) => rm(path.join(dir, `${old.id}.json`), { force: true })));
  }

  async getSnapshot(id: Id, snapshotId: Id): Promise<Snapshot | null> {
    assertSafe(snapshotId);
    return (await this.readSnapshots(id)).find((s) => s.id === snapshotId) ?? null;
  }
}

/** A snapshot without its (large) document, for listings. */
export function toSnapshotInfo(snapshot: Snapshot): SnapshotInfo {
  const { id, name, createdAt, author, nodeCount, edgeCount } = snapshot;
  return { id, name, createdAt, author, nodeCount, edgeCount };
}

export function makeSnapshot(id: Id, name: string, author: Actor, doc: DiagramDoc, now = new Date()): Snapshot {
  return {
    id,
    name,
    author,
    createdAt: now.toISOString(),
    nodeCount: Object.keys(doc.nodes).length,
    edgeCount: Object.keys(doc.edges).length,
    doc,
  };
}
