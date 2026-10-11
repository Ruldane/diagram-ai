import type { DiagramDoc, ElementKind, Id } from "../model/types";
import { sameValue } from "./equal";

/**
 * Comparing two states of a diagram for review: which elements were added,
 * removed or changed, with positional changes kept apart so a re-layout does
 * not drown out the edits that matter.
 *
 * Only the content is compared (nodes, connectors, comments). Names and
 * settings are not part of a review.
 */

export type ReviewContent = Pick<DiagramDoc, "nodes" | "edges" | "comments">;

export type ReviewChangeKind = "added" | "removed" | "modified" | "layout";

export interface ReviewChange {
  id: Id;
  element: ElementKind;
  kind: ReviewChangeKind;
  /**
   * What differs, for `modified` and `layout`: top-level fields (`text`,
   * `parent`), plus `style.<key>` and `from.<key>` / `to.<key>` for the parts
   * that are objects. Empty for `added` and `removed`.
   */
  fields: readonly string[];
}

export interface ReviewCounts {
  added: number;
  removed: number;
  modified: number;
  layout: number;
  /** Entries in the review list: every change, with all layout changes folded into one. */
  rows: number;
}

export interface ReviewDiff {
  /** Added, then removed, then modified, then layout — nodes before connectors before comments. */
  changes: ReviewChange[];
  counts: ReviewCounts;
  byId: ReadonlyMap<Id, ReviewChange>;
}

/** Fields that only say where something is and how it is routed. */
const LAYOUT_FIELDS: Record<ElementKind, ReadonlySet<string>> = {
  node: new Set(["x", "y", "w", "h", "rotation"]),
  edge: new Set(["waypoints", "autoRoute", "from.anchor", "to.anchor", "from.point", "to.point"]),
  comment: new Set(["x", "y"]),
};

const COLLECTIONS: { key: "nodes" | "edges" | "comments"; element: ElementKind }[] = [
  { key: "nodes", element: "node" },
  { key: "edges", element: "edge" },
  { key: "comments", element: "comment" },
];

/** Elements whose object-valued fields are compared one level down. */
const EXPANDED = new Set(["style", "from", "to"]);

type Bag = Record<string, unknown>;

/** Elements are immutable, so the answer for a pair never changes: cache it (drags re-diff every frame). */
const cache = new WeakMap<object, WeakMap<object, readonly string[]>>();

/** Names of the fields in which `current` differs from `base`. */
export function changedFields(base: object, current: object): readonly string[] {
  let perBase = cache.get(current);
  if (!perBase) cache.set(current, (perBase = new WeakMap()));
  const known = perBase.get(base);
  if (known) return known;

  const fields: string[] = [];
  const a = base as Bag;
  const b = current as Bag;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("id");
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (sameValue(left, right)) continue;
    const bothObjects = typeof left === "object" && typeof right === "object" && left && right && !Array.isArray(left) && !Array.isArray(right);
    if (EXPANDED.has(key) && (bothObjects || left === undefined || right === undefined)) {
      const l = (left ?? {}) as Bag;
      const r = (right ?? {}) as Bag;
      for (const sub of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (!sameValue(l[sub], r[sub])) fields.push(`${key}.${sub}`);
      }
    } else {
      fields.push(key);
    }
  }
  perBase.set(base, fields);
  return fields;
}

const ordered = (kind: ReviewChangeKind): number => ({ added: 0, removed: 1, modified: 2, layout: 3 })[kind];

/** What changed between `base` and `current`. */
export function diffForReview(base: ReviewContent, current: ReviewContent): ReviewDiff {
  const changes: ReviewChange[] = [];

  for (const { key, element } of COLLECTIONS) {
    const before = base[key] as Record<Id, object>;
    const after = current[key] as Record<Id, object>;
    const layoutFields = LAYOUT_FIELDS[element];

    for (const id of Object.keys(after)) {
      const old = before[id];
      if (!old) {
        changes.push({ id, element, kind: "added", fields: [] });
        continue;
      }
      if (old === after[id]) continue;
      const fields = changedFields(old, after[id]);
      if (!fields.length) continue;
      const kind: ReviewChangeKind = fields.every((field) => layoutFields.has(field)) ? "layout" : "modified";
      changes.push({ id, element, kind, fields });
    }
    for (const id of Object.keys(before)) {
      if (!(id in after)) changes.push({ id, element, kind: "removed", fields: [] });
    }
  }

  // Stable: keeps the node → connector → comment order within each kind.
  changes.sort((a, b) => ordered(a.kind) - ordered(b.kind));

  const counts: ReviewCounts = { added: 0, removed: 0, modified: 0, layout: 0, rows: 0 };
  const byId = new Map<Id, ReviewChange>();
  for (const change of changes) {
    counts[change.kind]++;
    byId.set(change.id, change);
  }
  counts.rows = counts.added + counts.removed + counts.modified + (counts.layout > 0 ? 1 : 0);
  return { changes, counts, byId };
}

/** True when nothing is left to review. */
export const isEmptyDiff = (diff: ReviewDiff): boolean => diff.changes.length === 0;

/** Ids of the changes of the given kinds (all kinds when omitted). */
export function changeIds(diff: ReviewDiff, kinds?: readonly ReviewChangeKind[]): Id[] {
  return diff.changes.filter((change) => !kinds || kinds.includes(change.kind)).map((change) => change.id);
}
