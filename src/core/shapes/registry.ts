import { rectPath, type Path } from "../geometry/path";
import { resolveNodeStyle, type ResolvedNodeStyle } from "../model/defaults";
import type { DNode, Rect, Size } from "../model/types";
import { measureBlock } from "../text/layout";
import { fontOf } from "./kit";
import { LIBRARIES } from "./libraries";
import type { LabelSpec, ShapeCtx, ShapeDef, ShapeLibrary } from "./types";

export const DEFAULT_SHAPE = "basic/rect";
const LABEL_PADDING = 10;

const byId = new Map<string, ShapeDef>();
/** Every shape that answers to a name, in library order. */
const byAlias = new Map<string, ShapeDef[]>();
const libraryOf = new Map<string, ShapeLibrary>();

/** Libraries added while the app runs (imported icon packs), in registration order. */
const runtimeLibraries = new Map<string, ShapeLibrary>();
let libraryList: ShapeLibrary[] = LIBRARIES;
let version = 0;
const listeners = new Set<() => void>();

const normalize = (name: string): string => name.trim().toLowerCase().replace(/[\s_]+/g, "-");

const aliasKeys = (shape: ShapeDef): string[] => [shape.id.split("/")[1], shape.name, ...(shape.aliases ?? [])].map(normalize);

function indexShape(shape: ShapeDef, library: ShapeLibrary): void {
  byId.set(shape.id, shape);
  libraryOf.set(shape.id, library);
  for (const key of aliasKeys(shape)) {
    const list = byAlias.get(key);
    if (!list) byAlias.set(key, [shape]);
    else if (!list.includes(shape)) list.push(shape);
  }
}

// Aliases resolve in library order, so earlier libraries win on conflicts.
for (const library of LIBRARIES) {
  for (const shape of library.shapes) {
    if (byId.has(shape.id)) throw new Error(`Duplicate shape id: ${shape.id}`);
    indexShape(shape, library);
  }
}

/* ----------------------------------------------------------- runtime packs */

function dropLibrary(library: ShapeLibrary): void {
  for (const shape of library.shapes) {
    byId.delete(shape.id);
    libraryOf.delete(shape.id);
    for (const key of aliasKeys(shape)) {
      const remaining = byAlias.get(key)?.filter((candidate) => candidate !== shape);
      if (remaining?.length) byAlias.set(key, remaining);
      else byAlias.delete(key);
    }
  }
}

function changed(): void {
  libraryList = [...LIBRARIES, ...runtimeLibraries.values()];
  version++;
  for (const listener of [...listeners]) listener();
}

/**
 * Adds (or replaces) a library at runtime. Runtime libraries sort after the
 * built-in ones, so their aliases never shadow a built-in shape. Throws when
 * the id belongs to a built-in library or a shape id is malformed or taken.
 */
export function registerLibrary(library: ShapeLibrary): void {
  if (LIBRARIES.some((builtIn) => builtIn.id === library.id)) throw new Error(`"${library.id}" is a built-in library and cannot be replaced.`);
  const seen = new Set<string>();
  for (const shape of library.shapes) {
    if (!shape.id.startsWith(`${library.id}/`)) throw new Error(`Shape "${shape.id}" must start with "${library.id}/".`);
    if (seen.has(shape.id)) throw new Error(`Duplicate shape id: ${shape.id}`);
    seen.add(shape.id);
    const owner = libraryOf.get(shape.id);
    if (owner && owner.id !== library.id) throw new Error(`Shape id "${shape.id}" is already used by library "${owner.id}".`);
  }
  const previous = runtimeLibraries.get(library.id);
  if (previous) dropLibrary(previous);
  runtimeLibraries.set(library.id, library);
  for (const shape of library.shapes) indexShape(shape, library);
  changed();
}

/** Removes a runtime library. Documents that used its shapes keep rendering (as plain rectangles). */
export function unregisterLibrary(id: string): boolean {
  const library = runtimeLibraries.get(id);
  if (!library) return false;
  dropLibrary(library);
  runtimeLibraries.delete(id);
  changed();
  return true;
}

/** Whether the library was added at runtime (an imported icon pack) rather than built in. */
export function isRuntimeLibrary(id: string): boolean {
  return runtimeLibraries.has(id);
}

/** Counter that changes whenever a runtime library is added, replaced or removed; for caches and `useSyncExternalStore`. */
export function registryVersion(): number {
  return version;
}

export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ lookup */

/** Built-in libraries in palette order, then runtime libraries. The array is replaced when a runtime library changes. */
export function listLibraries(): ShapeLibrary[] {
  return libraryList;
}

export function getLibrary(id: string): ShapeLibrary | undefined {
  return libraryList.find((library) => library.id === id);
}

export function allShapes(): ShapeDef[] {
  return [...byId.values()];
}

export function libraryOfShape(shapeId: string): ShapeLibrary | undefined {
  return libraryOf.get(shapeId);
}

/** Exact lookup with a safe fallback, for rendering. */
export function getShape(id: string): ShapeDef {
  return byId.get(id) ?? byId.get(DEFAULT_SHAPE)!;
}

export function hasShape(id: string): boolean {
  return byId.has(id);
}

/**
 * Lenient lookup for humans and agents: id, short name, display name or alias.
 *
 * Many libraries share short names ("queue", "user", "entity"). When several
 * shapes answer to a name, `prefer` (library ids, most relevant first — normally
 * the diagram type's pinned libraries) decides; without a match the earliest
 * library wins.
 */
export function resolveShape(name: string, prefer: readonly string[] = []): ShapeDef | undefined {
  const exact = byId.get(name) ?? byId.get(name.toLowerCase());
  if (exact) return exact;
  const candidates = byAlias.get(normalize(name));
  if (!candidates) return undefined;
  for (const library of prefer) {
    const hit = candidates.find((shape) => shape.id.startsWith(`${library}/`));
    if (hit) return hit;
  }
  return candidates[0];
}

export function searchShapes(query: string, limit = 40): ShapeDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return allShapes().slice(0, limit);
  const scored: { shape: ShapeDef; score: number }[] = [];
  for (const shape of byId.values()) {
    const name = shape.name.toLowerCase();
    const haystack = [shape.id, ...(shape.aliases ?? []), ...(shape.keywords ?? [])].join(" ").toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (haystack.includes(q)) score = 40;
    else if (shape.description?.toLowerCase().includes(q)) score = 20;
    if (score) scored.push({ shape, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.shape.name.localeCompare(b.shape.name))
    .slice(0, limit)
    .map((s) => s.shape);
}

/** Closest shape names, for "did you mean" errors. */
export function suggestShapes(name: string, limit = 5): string[] {
  const q = normalize(name).split("/").pop() ?? "";
  const hits = searchShapes(q, limit);
  if (hits.length) return hits.map((s) => s.id);
  const head = q.slice(0, 3);
  return allShapes()
    .filter((s) => head && s.id.includes(head))
    .slice(0, limit)
    .map((s) => s.id);
}

/* ---------------------------------------------------------------- contexts */

const SECTION_BREAK = /\n?^[ \t]*-{3,}[ \t]*$\n?/m;

export function splitSections(text: string): string[] {
  return text.split(SECTION_BREAK);
}

export function nodeStyle(node: DNode, def: ShapeDef = getShape(node.shape)): ResolvedNodeStyle {
  return resolveNodeStyle(def.style, node.style);
}

export function shapeContext(node: DNode, def: ShapeDef = getShape(node.shape)): ShapeCtx {
  const text = node.text ?? "";
  return {
    w: node.w,
    h: node.h,
    node,
    style: nodeStyle(node, def),
    text,
    sections: splitSections(text),
    data: { ...def.data, ...node.data },
  };
}

/** Resolved placement of a node's automatic label, or null when it draws its own. */
export function labelSpec(ctx: ShapeCtx, def: ShapeDef): Required<Pick<LabelSpec, "box" | "padding">> & LabelSpec | null {
  const custom = def.label ? def.label(ctx) : {};
  if (custom === null) return null;
  const inset = def.inset ?? { x: 0, y: 0 };
  const box: Rect = custom.box ?? {
    x: ctx.w * inset.x,
    y: ctx.h * inset.y,
    w: ctx.w * (1 - 2 * inset.x),
    h: ctx.h * (1 - 2 * inset.y),
  };
  return { ...custom, box, padding: custom.padding ?? LABEL_PADDING };
}

export function shapeOutline(node: DNode, def: ShapeDef = getShape(node.shape)): Path {
  const style = nodeStyle(node, def);
  return def.outline ? def.outline(node.w, node.h, style) : rectPath(0, 0, node.w, node.h, style.radius);
}

/** Whether typing a label makes sense for this shape (false for pure symbols such as a start dot). */
export function usesText(def: ShapeDef): boolean {
  if (def.text) return true;
  const probe = { id: "", shape: def.id, x: 0, y: 0, w: def.size.w, h: def.size.h, z: 0 } as DNode;
  return labelSpec(shapeContext(probe, def), def) !== null;
}

export function isContainer(node: DNode): boolean {
  return Boolean(getShape(node.shape).container);
}

export function containerInsets(def: ShapeDef): { header: number; padding: number } {
  const config = typeof def.container === "object" ? def.container : {};
  return { header: config.header ?? 32, padding: config.padding ?? 20 };
}

/* --------------------------------------------------------------- auto-size */

const MAX_LABEL_WIDTH = 220;
const GRID = 10;
const ceilToGrid = (value: number): number => Math.ceil(value / GRID) * GRID;

/**
 * Size a node should have to fit its content. Never smaller than the shape's
 * default size, so diagrams stay visually regular.
 */
export function fitSize(node: Pick<DNode, "shape" | "text" | "style" | "data">, def: ShapeDef = getShape(node.shape)): Size {
  const probe = { ...node, id: "", x: 0, y: 0, w: def.size.w, h: def.size.h, z: 0 } as DNode;
  const ctx = shapeContext(probe, def);
  if (def.fit) {
    const size = def.fit(ctx);
    return { w: ceilToGrid(Math.max(size.w, def.minSize?.w ?? 0)), h: ceilToGrid(Math.max(size.h, def.minSize?.h ?? 0)) };
  }
  const label = labelSpec(ctx, def);
  if (!label || !ctx.text.trim() || def.keepAspect) return def.size;
  // Labels placed outside the box (icons, actors) do not drive the size.
  if (def.label && label.box.y >= def.size.h) return def.size;

  const inset = def.inset ?? { x: 0, y: 0 };
  const font = fontOf(ctx.style, label.font);
  const available = Math.max(def.size.w * (1 - 2 * inset.x) - label.padding * 2, MAX_LABEL_WIDTH);
  const content = measureBlock(ctx.text, font, available);
  const w = (content.w + label.padding * 2) / (1 - 2 * inset.x);
  const h = (content.h + label.padding * 2) / (1 - 2 * inset.y);
  return { w: ceilToGrid(Math.max(def.size.w, w)), h: ceilToGrid(Math.max(def.size.h, h)) };
}
