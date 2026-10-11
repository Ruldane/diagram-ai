import type { Point, Rect } from "../model/types";

/* ------------------------------------------------------------------ points */

export const pt = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const len = (a: Point): number => Math.hypot(a.x, a.y);

export function normalize(a: Point): Point {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(p: Point, degrees: number, origin: Point = { x: 0, y: 0 }): Point {
  if (!degrees) return p;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const round = (value: number, decimals = 2): number => {
  const k = 10 ** decimals;
  return Math.round(value * k) / k;
};
export const snap = (value: number, step: number): number => (step > 0 ? Math.round(value / step) * step : value);

/* ------------------------------------------------------------------- rects */

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function expand(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Axis-aligned bounding box of a rectangle rotated around its centre. */
export function rotatedBounds(r: Rect, degrees = 0): Rect {
  if (!degrees) return r;
  const c = center(r);
  const corners = [pt(r.x, r.y), pt(r.x + r.w, r.y), pt(r.x + r.w, r.y + r.h), pt(r.x, r.y + r.h)].map((p) =>
    rotate(p, degrees, c),
  );
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/* ---------------------------------------------------------------- matrices */

/** Affine matrix `[a, b, c, d, e, f]` mapping (x, y) → (ax + cy + e, bx + dy + f). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scaling = (k: number): Matrix => [k, 0, 0, k, 0, 0];

export function rotation(degrees: number, origin: Point = { x: 0, y: 0 }): Matrix {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, sin, -sin, cos, origin.x - origin.x * cos + origin.y * sin, origin.y - origin.x * sin - origin.y * cos];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Matrix placing a node's local coordinate space (0..w, 0..h) into the world. */
export function nodeMatrix(node: Rect & { rotation?: number }): Matrix {
  const move = translation(node.x, node.y);
  if (!node.rotation) return move;
  return multiply(move, rotation(node.rotation, { x: node.w / 2, y: node.h / 2 }));
}
