import type { Point, Rect } from "../model/types";
import { applyMatrix, round, type Matrix } from "./basics";

/**
 * Path intermediate representation.
 *
 * Every shape, marker and connector is reduced to these four absolute commands.
 * That keeps each output target (React canvas, SVG, PDF, PowerPoint, hit
 * testing) trivial to implement and guarantees they all draw the same thing.
 */
export type PathCmd =
  | ["M", number, number]
  | ["L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

export type Path = PathCmd[];

/** Control-point offset that makes a cubic Bézier approximate a quarter circle. */
const KAPPA = 0.5522847498;

/* ----------------------------------------------------------------- builders */

export function rectPath(x: number, y: number, w: number, h: number, radius = 0): Path {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  const k = r * KAPPA;
  return [
    ["M", x + r, y],
    ["L", x + w - r, y],
    ["C", x + w - r + k, y, x + w, y + r - k, x + w, y + r],
    ["L", x + w, y + h - r],
    ["C", x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
    ["L", x + r, y + h],
    ["C", x + r - k, y + h, x, y + h - r + k, x, y + h - r],
    ["L", x, y + r],
    ["C", x, y + r - k, x + r - k, y, x + r, y],
    ["Z"],
  ];
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Path {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

export function polyPath(points: Point[] | [number, number][], closed = true): Path {
  const pts = points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  const path: Path = pts.map((p, i) => [i === 0 ? "M" : "L", p.x, p.y] as PathCmd);
  if (closed) path.push(["Z"]);
  return path;
}

export function linePath(x1: number, y1: number, x2: number, y2: number): Path {
  return [["M", x1, y1], ["L", x2, y2]];
}

/** Polygon / polyline with rounded corners. */
export function roundedPolyPath(points: Point[], radius: number, closed = true): Path {
  const n = points.length;
  if (n < 3 || radius <= 0) return polyPath(points, closed);
  const path: Path = [];
  const corner = (i: number) => {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const dIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dOut = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, dIn / 2, dOut / 2);
    const a = { x: curr.x + ((prev.x - curr.x) / dIn) * r, y: curr.y + ((prev.y - curr.y) / dIn) * r };
    const b = { x: curr.x + ((next.x - curr.x) / dOut) * r, y: curr.y + ((next.y - curr.y) / dOut) * r };
    return { a, b, curr };
  };
  const start = closed ? 0 : 1;
  const end = closed ? n : n - 1;
  if (!closed) path.push(["M", points[0].x, points[0].y]);
  for (let i = start; i < end; i++) {
    const { a, b, curr } = corner(i);
    path.push([path.length === 0 ? "M" : "L", a.x, a.y]);
    // Quadratic corner expressed as a cubic.
    path.push([
      "C",
      a.x + (2 / 3) * (curr.x - a.x),
      a.y + (2 / 3) * (curr.y - a.y),
      b.x + (2 / 3) * (curr.x - b.x),
      b.y + (2 / 3) * (curr.y - b.y),
      b.x,
      b.y,
    ]);
  }
  if (closed) path.push(["Z"]);
  else path.push(["L", points[n - 1].x, points[n - 1].y]);
  return path;
}

/* --------------------------------------------------------------- SVG parser */

const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const COMMAND = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Arc arguments need their own tokenizer: the two flags are single digits that
 * minified paths glue to the next number (`a2 2 0 011.5 2`).
 */
function parseArcArgs(source: string): number[] {
  const number = /[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/y;
  const flag = /[\s,]*([01])/y;
  const out: number[] = [];
  let index = 0;
  for (let slot = 0; ; slot = (slot + 1) % 7) {
    const pattern = slot === 3 || slot === 4 ? flag : number;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) break;
    out.push(Number(match[1]));
    index = pattern.lastIndex;
  }
  return out;
}

/** Parses any SVG path string into the absolute M/L/C/Z representation. */
export function parseSvgPath(d: string): Path {
  const out: Path = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevCtrl: Point | null = null;
  let prevCmd = "";

  for (const match of d.matchAll(COMMAND)) {
    const letter = match[1];
    const type = letter.toUpperCase();
    const relative = letter !== type;
    const numbers = type === "A" ? parseArcArgs(match[2]) : (match[2].match(NUMBER) ?? []).map(Number);
    const arity = ARGS[type];
    if (type === "Z") {
      out.push(["Z"]);
      cx = sx;
      cy = sy;
      prevCtrl = null;
      prevCmd = "Z";
      continue;
    }
    for (let i = 0; i + arity <= numbers.length; i += arity) {
      const a = numbers.slice(i, i + arity);
      const ox = relative ? cx : 0;
      const oy = relative ? cy : 0;
      // Extra coordinate pairs after a moveto are implicit linetos.
      const effective = type === "M" && i > 0 ? "L" : type;
      switch (effective) {
        case "M":
          cx = a[0] + ox;
          cy = a[1] + oy;
          sx = cx;
          sy = cy;
          out.push(["M", cx, cy]);
          break;
        case "L":
          cx = a[0] + ox;
          cy = a[1] + oy;
          out.push(["L", cx, cy]);
          break;
        case "H":
          cx = a[0] + ox;
          out.push(["L", cx, cy]);
          break;
        case "V":
          cy = a[0] + oy;
          out.push(["L", cx, cy]);
          break;
        case "C": {
          const c: PathCmd = ["C", a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
          prevCtrl = { x: c[3], y: c[4] };
          cx = c[5];
          cy = c[6];
          out.push(c);
          break;
        }
        case "S": {
          const reflect = prevCmd === "C" || prevCmd === "S";
          const x1: number = reflect && prevCtrl ? 2 * cx - prevCtrl.x : cx;
          const y1: number = reflect && prevCtrl ? 2 * cy - prevCtrl.y : cy;
          const c: PathCmd = ["C", x1, y1, a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
          prevCtrl = { x: c[3], y: c[4] };
          cx = c[5];
          cy = c[6];
          out.push(c);
          break;
        }
        case "Q":
        case "T": {
          let qx: number;
          let qy: number;
          let ex: number;
          let ey: number;
          if (effective === "Q") {
            qx = a[0] + ox;
            qy = a[1] + oy;
            ex = a[2] + ox;
            ey = a[3] + oy;
          } else {
            const reflect = prevCmd === "Q" || prevCmd === "T";
            qx = reflect && prevCtrl ? 2 * cx - prevCtrl.x : cx;
            qy = reflect && prevCtrl ? 2 * cy - prevCtrl.y : cy;
            ex = a[0] + ox;
            ey = a[1] + oy;
          }
          out.push(["C", cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
          prevCtrl = { x: qx, y: qy };
          cx = ex;
          cy = ey;
          break;
        }
        case "A": {
          const ex = a[5] + ox;
          const ey = a[6] + oy;
          out.push(...arcToCubics(cx, cy, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, ex, ey));
          cx = ex;
          cy = ey;
          break;
        }
      }
      prevCmd = effective;
      if (effective !== "C" && effective !== "S" && effective !== "Q" && effective !== "T") prevCtrl = null;
    }
  }
  return out;
}

/** Converts an SVG elliptical arc into cubic Bézier segments (W3C endpoint parameterisation). */
export function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Path {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [["L", x2, y2]];

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const mag = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, dot / mag)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);
  const out: Path = [];
  for (let i = 0; i < segments; i++) {
    const a1 = theta1 + i * step;
    const a2 = a1 + step;
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);
    const p = (ex: number, ey: number): [number, number] => [
      cosPhi * rx * ex - sinPhi * ry * ey + cx,
      sinPhi * rx * ex + cosPhi * ry * ey + cy,
    ];
    const c1 = p(cos1 - t * sin1, sin1 + t * cos1);
    const c2 = p(cos2 + t * sin2, sin2 - t * cos2);
    const e = p(cos2, sin2);
    out.push(["C", c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  return out;
}

/* --------------------------------------------------------------- operations */

export function transformPath(path: Path, m: Matrix): Path {
  return path.map((cmd): PathCmd => {
    switch (cmd[0]) {
      case "M":
      case "L": {
        const p = applyMatrix(m, { x: cmd[1], y: cmd[2] });
        return [cmd[0], p.x, p.y];
      }
      case "C": {
        const a = applyMatrix(m, { x: cmd[1], y: cmd[2] });
        const b = applyMatrix(m, { x: cmd[3], y: cmd[4] });
        const c = applyMatrix(m, { x: cmd[5], y: cmd[6] });
        return ["C", a.x, a.y, b.x, b.y, c.x, c.y];
      }
      default:
        return ["Z"];
    }
  });
}

export function translatePath(path: Path, dx: number, dy: number): Path {
  return transformPath(path, [1, 0, 0, 1, dx, dy]);
}

/** Maps a path authored in a `viewW × viewH` box into `x, y, w, h`. */
export function fitPath(path: Path, viewW: number, viewH: number, x: number, y: number, w: number, h: number): Path {
  return transformPath(path, [w / viewW, 0, 0, h / viewH, x, y]);
}

export function pathToSvg(path: Path, decimals = 2): string {
  let out = "";
  for (const cmd of path) {
    if (cmd[0] === "Z") out += "Z";
    else out += cmd[0] + cmd.slice(1).map((n) => round(n as number, decimals)).join(" ");
  }
  return out;
}

/** Approximates a path with polylines (one per subpath) for hit-testing and clipping. */
export function flattenPath(path: Path, segmentsPerCurve = 12): { points: Point[]; closed: boolean }[] {
  const out: { points: Point[]; closed: boolean }[] = [];
  let current: Point[] = [];
  let cx = 0;
  let cy = 0;
  const flush = (closed: boolean) => {
    if (current.length > 1) out.push({ points: current, closed });
    current = [];
  };
  for (const cmd of path) {
    switch (cmd[0]) {
      case "M":
        flush(false);
        cx = cmd[1];
        cy = cmd[2];
        current = [{ x: cx, y: cy }];
        break;
      case "L":
        cx = cmd[1];
        cy = cmd[2];
        current.push({ x: cx, y: cy });
        break;
      case "C":
        for (let i = 1; i <= segmentsPerCurve; i++) {
          const t = i / segmentsPerCurve;
          const u = 1 - t;
          current.push({
            x: u * u * u * cx + 3 * u * u * t * cmd[1] + 3 * u * t * t * cmd[3] + t * t * t * cmd[5],
            y: u * u * u * cy + 3 * u * u * t * cmd[2] + 3 * u * t * t * cmd[4] + t * t * t * cmd[6],
          });
        }
        cx = cmd[5];
        cy = cmd[6];
        break;
      case "Z":
        flush(true);
        break;
    }
  }
  flush(false);
  return out;
}

export function pathBounds(path: Path): Rect | null {
  const polylines = flattenPath(path, 8);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points } of polylines) {
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ------------------------------------------------------------- intersection */

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): { point: Point; t: number } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: { x: a.x + t * rx, y: a.y + t * ry }, t };
}

/**
 * Points where the segment `from → to` crosses the outline, sorted by distance
 * from `from`.
 */
export function intersectSegmentWithPath(path: Path, from: Point, to: Point): Point[] {
  const hits: { point: Point; t: number }[] = [];
  for (const { points, closed } of flattenPath(path)) {
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const hit = segmentIntersection(from, to, points[i], points[(i + 1) % points.length]);
      if (hit) hits.push(hit);
    }
  }
  return hits.sort((a, b) => a.t - b.t).map((h) => h.point);
}

/** Even-odd point-in-path test on the flattened outline. */
export function pointInPath(path: Path, p: Point): boolean {
  let inside = false;
  for (const { points, closed } of flattenPath(path)) {
    if (!closed) continue;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from a point to a polyline. */
export function distanceToPolyline(points: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}
