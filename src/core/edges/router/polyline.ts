import type { Point, Rect } from "../../model/types";

/** Coordinates closer than this along one axis are the same coordinate. */
const SNAP = 0.5;

export function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Makes a route strictly orthogonal and minimal: near-equal coordinates of
 * consecutive points are snapped together (the first point never moves), then
 * repeated points and points in the middle of a straight run are removed.
 */
export function cleanPolyline(input: readonly Point[]): Point[] {
  const points = input.map((p) => ({ x: p.x, y: p.y }));
  const last = points.length - 1;
  for (let i = 1; i <= last; i++) {
    const a = points[i - 1];
    const b = points[i];
    // The end point stays put, so the previous (interior) point yields instead.
    const mover = i === last && i > 1 ? a : b;
    const anchor = mover === a ? b : a;
    if (a.x !== b.x && Math.abs(a.x - b.x) < SNAP) mover.x = anchor.x;
    if (a.y !== b.y && Math.abs(a.y - b.y) < SNAP) mover.y = anchor.y;
  }

  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const sameColumn = a.x === b.x && b.x === c.x;
    const sameRow = a.y === b.y && b.y === c.y;
    if (sameColumn || sameRow) out.splice(i, 1);
  }
  return out.length < 2 ? [points[0], points[last]] : out;
}

/** Number of direction changes along an axis-aligned polyline. */
export function countBends(points: readonly Point[]): number {
  let bends = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const first = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const second = Math.abs(c.x - b.x) >= Math.abs(c.y - b.y);
    if (first !== second) bends++;
  }
  return bends;
}

/** Length of the overlap between [a0, a1] and [b0, b1] (both ascending), zero when disjoint. */
export const overlapLength = (a0: number, a1: number, b0: number, b1: number): number => {
  const length = Math.min(a1, b1) - Math.max(a0, b0);
  return length > 0 ? length : 0;
};
