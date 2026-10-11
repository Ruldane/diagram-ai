import { packToLibrary } from "@/core/shapes/packs";
import { isRuntimeLibrary, listLibraries, registerLibrary, unregisterLibrary } from "@/core/shapes/registry";

import { getPackStore } from "./store";

/** How often the store is looked at again for changes made by another process (the CLI). */
const RECHECK_MS = 1000;

/** Plain data shared by every route bundle: bumped by this process whenever it changes a pack. */
interface SharedRuntime {
  version: number;
}

const globalRef = globalThis as typeof globalThis & { __diagramAiPacks?: SharedRuntime };

const shared = (): SharedRuntime => (globalRef.__diagramAiPacks ??= { version: 0 });

/**
 * What this module instance has done. The shape registry is a module-level
 * singleton, and the dev server gives every route its own copy of it, so each
 * copy has to be filled separately: this state belongs next to the registry
 * that it describes, not on `globalThis`.
 */
let seenVersion = -1;
let checkedAt = 0;
let inflight: Promise<void> | null = null;
const signatures = new Map<string, string>();

async function sync(): Promise<void> {
  const version = shared().version;
  try {
    const store = getPackStore();
    const summaries = await store.list();
    const wanted = new Set(summaries.map((summary) => summary.id));

    for (const library of listLibraries()) {
      if (isRuntimeLibrary(library.id) && !wanted.has(library.id)) {
        unregisterLibrary(library.id);
        signatures.delete(library.id);
      }
    }
    for (const summary of summaries) {
      const signature = `${summary.updatedAt}:${summary.iconCount}`;
      if (signatures.get(summary.id) === signature && isRuntimeLibrary(summary.id)) continue;
      const pack = await store.get(summary.id);
      if (!pack) continue;
      try {
        registerLibrary(packToLibrary(pack));
        signatures.set(summary.id, signature);
      } catch (error) {
        console.warn(`[diagram-ai] Icon pack "${summary.id}" was not loaded:`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    // A broken pack directory must never take rendering down with it.
    console.warn("[diagram-ai] Could not load icon packs:", error instanceof Error ? error.message : error);
  } finally {
    seenVersion = version;
    checkedAt = Date.now();
  }
}

/**
 * Makes the shape registry of this module instance match the pack store.
 * Cheap when nothing changed (one directory listing per second at most), so it
 * can sit in front of every render path and tool that resolves shape names.
 */
export function ensurePacks(): Promise<void> {
  if (!inflight && seenVersion === shared().version && Date.now() - checkedAt < RECHECK_MS) return Promise.resolve();
  inflight ??= sync().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Call after adding or removing a pack in this process: every route bundle re-reads the store on its next render. */
export function packsChanged(): Promise<void> {
  shared().version++;
  return ensurePacks();
}
