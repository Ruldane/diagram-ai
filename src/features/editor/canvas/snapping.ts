import { rotate, snap } from "@/core/geometry/basics";
import type { DNode, Point, Rect } from "@/core/model/types";

export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

/**
 * Snaps a moving rectangle to the edges and centres of nearby rectangles
 * (smart guides), falling back to the grid on each axis without a match.
 */
export function snapMove(moving: Rect, others: Rect[], threshold: number, grid: number): SnapResult {
  const guides: Guide[] = [];
  const xs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const ys = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  let bestX: { delta: number; at: number; other: Rect } | null = null;
  let bestY: { delta: number; at: number; other: Rect } | null = null;
  for (const other of others) {
    const ox = [other.x, other.x + other.w / 2, other.x + other.w];
    const oy = [other.y, other.y + other.h / 2, other.y + other.h];
    for (const a of xs) {
      for (const b of ox) {
        const delta = b - a;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { delta, at: b, other };
      }
    }
    for (const a of ys) {
      for (const b of oy) {
        const delta = b - a;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { delta, at: b, other };
      }
    }
  }

  const dx = bestX ? bestX.delta : snap(moving.x, grid) - moving.x;
  const dy = bestY ? bestY.delta : snap(moving.y, grid) - moving.y;
  const snapped: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };
  if (bestX) {
    guides.push({
      x1: bestX.at,
      x2: bestX.at,
      y1: Math.min(snapped.y, bestX.other.y) - 8,
      y2: Math.max(snapped.y + snapped.h, bestX.other.y + bestX.other.h) + 8,
    });
  }
  if (bestY) {
    guides.push({
      y1: bestY.at,
      y2: bestY.at,
      x1: Math.min(snapped.x, bestY.other.x) - 8,
      x2: Math.max(snapped.x + snapped.w, bestY.other.x + bestY.other.w) + 8,
    });
  }
  return { dx, dy, guides };
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * New rectangle for a node being resized from `handle`. Works for rotated
 * nodes: the opposite side stays fixed in world space.
 */
export function resizeNode(
  start: DNode,
  handle: ResizeHandle,
  pointer: Point,
  options: { min: { w: number; h: number }; keepAspect: boolean; grid: number },
): Rect {
  const rotation = start.rotation ?? 0;
  const c0 = { x: start.x + start.w / 2, y: start.y + start.h / 2 };
  // Pointer expressed in the node's own (unrotated) frame.
  const p = rotate(pointer, -rotation, c0);
  const grid = rotation ? 0 : options.grid;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes("w")) left = Math.min(snap(p.x, grid), right - options.min.w);
  if (handle.includes("e")) right = Math.max(snap(p.x, grid), left + options.min.w);
  if (handle.includes("n")) top = Math.min(snap(p.y, grid), bottom - options.min.h);
  if (handle.includes("s")) bottom = Math.max(snap(p.y, grid), top + options.min.h);

  if (options.keepAspect) {
    const ratio = start.w / start.h;
    let w = right - left;
    let h = bottom - top;
    const horizontalOnly = handle === "e" || handle === "w";
    const verticalOnly = handle === "n" || handle === "s";
    if (horizontalOnly || (!verticalOnly && w / ratio >= h)) h = w / ratio;
    else w = h * ratio;
    if (handle.includes("w")) left = right - w;
    else if (handle.includes("e")) right = left + w;
    else {
      // Vertical-only handle: grow symmetrically around the vertical axis.
      const cx = (left + right) / 2;
      left = cx - w / 2;
      right = cx + w / 2;
    }
    if (handle.includes("n")) top = bottom - h;
    else if (handle.includes("s")) bottom = top + h;
    else {
      const cy = (top + bottom) / 2;
      top = cy - h / 2;
      bottom = cy + h / 2;
    }
  }

  const w = right - left;
  const h = bottom - top;
  const centre = rotate({ x: (left + right) / 2, y: (top + bottom) / 2 }, rotation, c0);
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
}
