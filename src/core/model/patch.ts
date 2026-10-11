import type { DComment, DEdge, DiagramDoc, DNode, DocMeta, ElementPatch, Id, Patch } from "./types";

type Collection = "nodes" | "edges" | "comments";
type ElementOf<K extends Collection> = K extends "nodes" ? DNode : K extends "edges" ? DEdge : DComment;

const COLLECTIONS: Collection[] = ["nodes", "edges", "comments"];

export interface ApplyResult {
  doc: DiagramDoc;
  /** Patch that restores the previous state (drives undo). */
  inverse: Patch;
  /** False when the patch did not change anything. */
  changed: boolean;
}

/**
 * Applies a patch immutably. Untouched elements keep their identity so React
 * and the history stack can rely on reference equality.
 */
export function applyPatch(doc: DiagramDoc, patch: Patch): ApplyResult {
  const next: DiagramDoc = { ...doc };
  const inverse: Patch = {};
  let changed = false;

  for (const key of COLLECTIONS) {
    const part = patch[key] as ElementPatch<ElementOf<typeof key>> | undefined;
    if (!part || (!part.set?.length && !part.remove?.length)) continue;

    const current = doc[key] as Record<Id, ElementOf<typeof key>>;
    const updated = { ...current };
    const undoSet: ElementOf<typeof key>[] = [];
    const undoRemove: Id[] = [];

    for (const element of part.set ?? []) {
      const previous = current[element.id];
      if (previous === element) continue;
      if (previous) undoSet.push(previous);
      else undoRemove.push(element.id);
      updated[element.id] = element;
      changed = true;
    }
    for (const id of part.remove ?? []) {
      const previous = updated[id];
      if (!previous) continue;
      // An element set and removed in the same patch never existed before.
      const existedBefore = current[id];
      if (existedBefore && !undoSet.includes(existedBefore)) undoSet.push(existedBefore);
      const pending = undoRemove.indexOf(id);
      if (pending >= 0) undoRemove.splice(pending, 1);
      delete updated[id];
      changed = true;
    }

    (next[key] as Record<Id, ElementOf<typeof key>>) = updated;
    if (undoSet.length || undoRemove.length) {
      (inverse[key] as ElementPatch<ElementOf<typeof key>>) = {
        ...(undoSet.length ? { set: undoSet } : {}),
        ...(undoRemove.length ? { remove: undoRemove } : {}),
      };
    }
  }

  if (patch.doc) {
    const undo: DocMeta = {};
    const { settings, ...meta } = patch.doc;
    for (const field of Object.keys(meta) as (keyof typeof meta)[]) {
      if (meta[field] === undefined || meta[field] === doc[field]) continue;
      (undo[field] as unknown) = doc[field];
      (next[field] as unknown) = meta[field];
      changed = true;
    }
    if (settings) {
      const undoSettings: Record<string, unknown> = {};
      const merged = { ...doc.settings };
      for (const field of Object.keys(settings) as (keyof typeof settings)[]) {
        const value = settings[field];
        if (value === undefined || isEqual(value, doc.settings[field])) continue;
        undoSettings[field] = doc.settings[field];
        (merged[field] as unknown) = value;
        changed = true;
      }
      if (Object.keys(undoSettings).length) {
        next.settings = merged;
        undo.settings = undoSettings as DocMeta["settings"];
      }
    }
    if (Object.keys(undo).length) inverse.doc = undo;
  }

  return { doc: changed ? next : doc, inverse, changed };
}

/** Computes the patch that turns `before` into `after`, by element identity. */
export function diffDocs(before: DiagramDoc, after: DiagramDoc): Patch {
  const patch: Patch = {};
  for (const key of COLLECTIONS) {
    if (before[key] === after[key]) continue;
    const a = before[key] as Record<Id, { id: Id }>;
    const b = after[key] as Record<Id, { id: Id }>;
    const set = Object.values(b).filter((element) => a[element.id] !== element);
    const remove = Object.keys(a).filter((id) => !(id in b));
    if (set.length || remove.length) {
      (patch[key] as ElementPatch<{ id: Id }>) = {
        ...(set.length ? { set } : {}),
        ...(remove.length ? { remove } : {}),
      };
    }
  }
  const meta: DocMeta = {};
  if (before.name !== after.name) meta.name = after.name;
  if (before.type !== after.type) meta.type = after.type;
  if (before.description !== after.description) meta.description = after.description;
  if (before.settings !== after.settings) meta.settings = after.settings;
  if (Object.keys(meta).length) patch.doc = meta;
  return patch;
}

export function isEmptyPatch(patch: Patch): boolean {
  for (const key of COLLECTIONS) {
    const part = patch[key];
    if (part?.set?.length || part?.remove?.length) return false;
  }
  return !patch.doc || Object.keys(patch.doc).length === 0;
}

/** Merges patches in order into one (later writes win). */
export function mergePatches(...patches: Patch[]): Patch {
  const out: Patch = {};
  for (const patch of patches) {
    for (const key of COLLECTIONS) {
      const part = patch[key] as ElementPatch<{ id: Id }> | undefined;
      if (!part) continue;
      const target = ((out[key] as ElementPatch<{ id: Id }> | undefined) ??= {});
      for (const element of part.set ?? []) {
        target.remove = target.remove?.filter((id) => id !== element.id);
        target.set = [...(target.set ?? []).filter((e) => e.id !== element.id), element];
      }
      for (const id of part.remove ?? []) {
        target.set = target.set?.filter((e) => e.id !== id);
        target.remove = [...(target.remove ?? []).filter((r) => r !== id), id];
      }
    }
    if (patch.doc) {
      out.doc = {
        ...out.doc,
        ...patch.doc,
        ...(out.doc?.settings || patch.doc.settings
          ? { settings: { ...out.doc?.settings, ...patch.doc.settings } }
          : {}),
      };
    }
  }
  return out;
}

export interface PatchStats {
  nodesSet: number;
  nodesRemoved: number;
  edgesSet: number;
  edgesRemoved: number;
  commentsSet: number;
  commentsRemoved: number;
}

export function patchStats(patch: Patch): PatchStats {
  return {
    nodesSet: patch.nodes?.set?.length ?? 0,
    nodesRemoved: patch.nodes?.remove?.length ?? 0,
    edgesSet: patch.edges?.set?.length ?? 0,
    edgesRemoved: patch.edges?.remove?.length ?? 0,
    commentsSet: patch.comments?.set?.length ?? 0,
    commentsRemoved: patch.comments?.remove?.length ?? 0,
  };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
