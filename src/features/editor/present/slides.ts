import { clamp, union } from "@/core/geometry/basics";
import { FRAME_SHAPE, framesInOrder } from "@/core/export/pages";
import { nodeBounds } from "@/core/model/queries";
import type { DiagramDoc, Id, Rect, Size } from "@/core/model/types";

import { MIN_ZOOM, type Viewport } from "../store/editor-store";

/**
 * What presentation mode shows and how it frames it. Pure functions, so the
 * ordering and the framing maths are tested without a browser.
 */

export interface Slide {
  /** The frame this slide shows, or null when the whole diagram is one slide. */
  id: Id | null;
  title: string;
  /** The frame's speaker notes. */
  note: string;
  bounds: Rect;
}

/**
 * One slide per top-level frame in reading order (the order PDF and
 * PowerPoint export use). A diagram without frames is a single slide.
 */
export function slidesOf(doc: Pick<DiagramDoc, "nodes" | "name">): Slide[] {
  const frames = framesInOrder(doc);
  if (frames.length) {
    return frames.map((frame, index) => {
      const node = doc.nodes[frame.id];
      const title = (node?.text ?? "").split("\n")[0].trim();
      const { x, y, w, h } = frame.bounds;
      return { id: frame.id, title: title || `Slide ${index + 1}`, note: node?.note?.trim() ?? "", bounds: { x, y, w, h } };
    });
  }
  const bounds = union(Object.values(doc.nodes).map(nodeBounds));
  return bounds ? [{ id: null, title: doc.name, note: "", bounds }] : [];
}

/** The slide to start from: the frame that is selected, or the one that holds the selection. */
export function slideForSelection(doc: Pick<DiagramDoc, "nodes">, selection: readonly Id[]): number | undefined {
  const frames = framesInOrder(doc);
  if (!frames.length) return undefined;
  const indexOf = new Map(frames.map((frame, index) => [frame.id, index]));
  for (const id of selection) {
    const seen = new Set<Id>();
    let current: Id | undefined = id;
    while (current && !seen.has(current)) {
      const found = indexOf.get(current);
      if (found !== undefined) return found;
      seen.add(current);
      current = doc.nodes[current]?.parent;
    }
  }
  // Nodes dropped on a frame without being parented to it: the frame whose box holds their centre.
  for (const id of selection) {
    const node = doc.nodes[id];
    if (!node) continue;
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    const found = frames.findIndex((frame) => cx >= frame.bounds.x && cx <= frame.bounds.x + frame.bounds.w && cy >= frame.bounds.y && cy <= frame.bounds.y + frame.bounds.h);
    if (found >= 0) return found;
  }
  return undefined;
}

const frameCounts = new WeakMap<object, number>();

/** Number of slide-making frames, cached per `nodes` object so it is cheap to read from a store selector. */
export function countFrames(nodes: DiagramDoc["nodes"]): number {
  let count = frameCounts.get(nodes);
  if (count === undefined) {
    count = framesInOrder({ nodes }).length;
    frameCounts.set(nodes, count);
  }
  return count;
}

/** Index of the frame when exactly one top-level frame is selected. */
export function selectedFrame(doc: Pick<DiagramDoc, "nodes">, selection: readonly Id[]): number | undefined {
  if (selection.length !== 1) return undefined;
  const node = doc.nodes[selection[0]];
  if (!node || node.shape !== FRAME_SHAPE || node.parent) return undefined;
  const index = framesInOrder(doc).findIndex((frame) => frame.id === node.id);
  return index >= 0 ? index : undefined;
}

export const clampSlide = (index: number, count: number): number => (count <= 0 ? 0 : clamp(Math.round(index), 0, count - 1));

/** Where the slide with this id sits now (slides can be inserted or reordered while presenting). */
export function indexOfSlide(slides: readonly Slide[], id: Id | null): number {
  return slides.findIndex((slide) => slide.id === id);
}

export interface FitOptions {
  /** Space kept free around the slide. Defaults to 6% of the shorter side, between 16 and 72 px. */
  padding?: number;
  /** Space covered by overlays (speaker notes), which the slide is kept clear of. */
  inset?: Partial<{ top: number; bottom: number; left: number; right: number }>;
  maxZoom?: number;
}

/** The viewport that centres `rect` in the window, as large as it fits with comfortable padding. */
export function fitSlide(rect: Rect, window: Size, options: FitOptions = {}): Viewport {
  const { top = 0, bottom = 0, left = 0, right = 0 } = options.inset ?? {};
  const area = { x: left, y: top, w: Math.max(1, window.w - left - right), h: Math.max(1, window.h - top - bottom) };
  const padding = options.padding ?? clamp(Math.min(area.w, area.h) * 0.06, 16, 72);
  const zoom = clamp(
    Math.min((area.w - padding * 2) / Math.max(rect.w, 1), (area.h - padding * 2) / Math.max(rect.h, 1)),
    MIN_ZOOM,
    options.maxZoom ?? 3,
  );
  return {
    zoom,
    x: area.x + area.w / 2 - (rect.x + rect.w / 2) * zoom,
    y: area.y + area.h / 2 - (rect.y + rect.h / 2) * zoom,
  };
}

export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A viewport between two others: the point in the middle of the window
 * travels in a straight line while the zoom changes by a constant factor,
 * which reads as one smooth camera move rather than a slide and a zoom.
 */
export function blendViewport(from: Viewport, to: Viewport, t: number, window: Size): Viewport {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const centre = (viewport: Viewport) => ({ x: (window.w / 2 - viewport.x) / viewport.zoom, y: (window.h / 2 - viewport.y) / viewport.zoom });
  const a = centre(from);
  const b = centre(to);
  const zoom = from.zoom * (to.zoom / from.zoom) ** t;
  const cx = a.x + (b.x - a.x) * t;
  const cy = a.y + (b.y - a.y) * t;
  return { zoom, x: window.w / 2 - cx * zoom, y: window.h / 2 - cy * zoom };
}
