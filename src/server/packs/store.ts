import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { packInfo, validatePack, type IconPack, type PackSummary } from "@/core/shapes/packs";

import { DATA_DIR } from "../config";

export type { PackSummary };

/**
 * Storage contract for icon packs. Packs are shared by everyone on the server.
 * The file implementation keeps one JSON file per pack; a database-backed one
 * only has to implement these four methods (`getPackStore` picks it).
 */
export interface PackStore {
  list(): Promise<PackSummary[]>;
  get(id: string): Promise<IconPack | null>;
  /** Creates or replaces the pack. The pack must already be validated. */
  save(pack: IconPack): Promise<PackSummary>;
  /** Whether a pack was removed. */
  delete(id: string): Promise<boolean>;
}

/** These are runtime locations, so the bundler is told not to trace them into the build. */
export const PACKS_DIR = path.join(/* turbopackIgnore: true */ DATA_DIR, "packs");

const SAFE_PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isPackId = (id: string): boolean => id.length <= 32 && SAFE_PACK_ID.test(id);

interface CachedSummary {
  /** `mtimeMs:size` of the file the summary was computed from. */
  signature: string;
  summary: PackSummary;
}

/** Plain data shared by every route bundle (see `server/context.ts` for why this lives on `globalThis`). */
export interface PackStoreState {
  summaries: Map<string, CachedSummary>;
}

export const createPackStoreState = (): PackStoreState => ({ summaries: new Map() });

const globalRef = globalThis as typeof globalThis & { __diagramAiPackStore?: PackStoreState };

function sharedState(): PackStoreState {
  return (globalRef.__diagramAiPackStore ??= createPackStoreState());
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, contents, "utf8");
  await rename(temp, file);
}

export class FilePackStore implements PackStore {
  constructor(private readonly state: PackStoreState = sharedState()) {}

  private file(id: string): string {
    return path.join(PACKS_DIR, `${id}.json`);
  }

  private async read(id: string): Promise<IconPack | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(id), "utf8");
    } catch {
      return null;
    }
    try {
      const checked = validatePack(JSON.parse(raw));
      if (checked.ok) return checked.pack;
      console.warn(`[diagram-ai] Skipping unreadable icon pack ${id}: ${checked.error}`);
    } catch {
      console.warn(`[diagram-ai] Skipping icon pack ${id}: not valid JSON.`);
    }
    return null;
  }

  async list(): Promise<PackSummary[]> {
    let names: string[];
    try {
      names = (await readdir(PACKS_DIR)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
    const found: PackSummary[] = [];
    const live = new Set<string>();
    await Promise.all(
      names.map(async (name) => {
        const id = name.slice(0, -5);
        if (!isPackId(id)) return;
        const info = await stat(this.file(id)).catch(() => null);
        if (!info) return;
        live.add(id);
        const signature = `${info.mtimeMs}:${info.size}`;
        const cached = this.state.summaries.get(id);
        if (cached?.signature === signature) {
          found.push(cached.summary);
          return;
        }
        const pack = await this.read(id);
        if (!pack) return;
        const summary: PackSummary = { ...packInfo(pack), id, updatedAt: info.mtime.toISOString() };
        this.state.summaries.set(id, { signature, summary });
        found.push(summary);
      }),
    );
    for (const id of this.state.summaries.keys()) if (!live.has(id)) this.state.summaries.delete(id);
    return found.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<IconPack | null> {
    return isPackId(id) ? this.read(id) : null;
  }

  async save(pack: IconPack): Promise<PackSummary> {
    if (!isPackId(pack.id)) throw new Error(`"${pack.id}" is not a valid pack id.`);
    await writeAtomic(this.file(pack.id), JSON.stringify(pack));
    const info = await stat(this.file(pack.id));
    const summary: PackSummary = { ...packInfo(pack), updatedAt: info.mtime.toISOString() };
    this.state.summaries.set(pack.id, { signature: `${info.mtimeMs}:${info.size}`, summary });
    return summary;
  }

  async delete(id: string): Promise<boolean> {
    if (!isPackId(id)) return false;
    const existed = await stat(this.file(id)).then(
      () => true,
      () => false,
    );
    await rm(this.file(id), { force: true });
    this.state.summaries.delete(id);
    return existed;
  }
}

/** The one place that decides where packs are stored: JSON files in `<data dir>/packs`. */
export function getPackStore(): PackStore {
  return new FilePackStore();
}
