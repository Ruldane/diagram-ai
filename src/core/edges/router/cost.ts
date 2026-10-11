import type { Point, Rect } from "../../model/types";
import { overlapLength } from "./polyline";
import type { RoutedIndex } from "./routed";
import { BEND, CROSS_PER_PX, HEADER_PER_PX, IN_EPS, OUTSIDE_PER_PX, OVERLAP_PER_PX, REVERSAL, SOFT_PER_PX } from "./types";

/** One routing question: two ports, the obstacles near them and the soft costs that apply. */
export interface Problem {
  p0: Point;
  n0: Point;
  /** First free point of the route: `p0` plus the stub along `n0`. */
  s: Point;
  p1: Point;
  n1: Point;
  e: Point;
  /** Clearance zone of every obstacle. */
  soft: Rect[];
  /** Impassable core of every obstacle, index-aligned with `soft`. */
  hard: Rect[];
  /** Container both ends sit in: leaving it is discouraged. */
  home: Rect | null;
  /** Title strips of the containers nearby: running along them is discouraged. */
  strips: Rect[];
  routed: RoutedIndex;
}

export interface Cost {
  total: number;
  bends: number;
  /** Length inside other nodes. */
  crossing: number;
  /** Weighted length inside clearance zones, plus the container penalties. */
  soft: number;
  /** Penalty paid for sharing channels with connectors that are already routed. */
  shared: number;
  /** Everything paid beyond length and bends: walls, clearance, container and channel penalties. */
  penalty: number;
}

/** Length of the axis-aligned run a→b strictly inside `r` (a hair inside, so borders are free). */
export function insideLength(a: Point, b: Point, r: Rect): number {
  if (Math.abs(a.y - b.y) <= Math.abs(a.x - b.x)) {
    const y = (a.y + b.y) / 2;
    if (y <= r.y + IN_EPS || y >= r.y + r.h - IN_EPS) return 0;
    return overlapLength(Math.min(a.x, b.x), Math.max(a.x, b.x), r.x + IN_EPS, r.x + r.w - IN_EPS);
  }
  const x = (a.x + b.x) / 2;
  if (x <= r.x + IN_EPS || x >= r.x + r.w - IN_EPS) return 0;
  return overlapLength(Math.min(a.y, b.y), Math.max(a.y, b.y), r.y + IN_EPS, r.y + r.h - IN_EPS);
}

/**
 * How much of a clearance zone's penalty a line at `v` pays: 1 at the node's
 * core (`h0`..`h1`), falling linearly to 0 at the zone's border (`z0`..`z1`).
 */
export function rampFactor(v: number, h0: number, h1: number, z0: number, z1: number): number {
  if (v <= h0) {
    const thickness = h0 - z0;
    return thickness > 0 ? Math.min(1, Math.max(0, 1 - (h0 - v) / thickness)) : 0;
  }
  if (v >= h1) {
    const thickness = z1 - h1;
    return thickness > 0 ? Math.min(1, Math.max(0, 1 - (v - h1) / thickness)) : 0;
  }
  return 1;
}

/** Length of a run inside a clearance zone, weighted by how deep into the zone it runs. */
function softLength(a: Point, b: Point, zone: Rect, core: Rect): number {
  const inside = insideLength(a, b, zone);
  if (inside <= 0) return 0;
  if (Math.abs(a.y - b.y) <= Math.abs(a.x - b.x)) {
    return inside * rampFactor((a.y + b.y) / 2, core.y, core.y + core.h, zone.y, zone.y + zone.h);
  }
  return inside * rampFactor((a.x + b.x) / 2, core.x, core.x + core.w, zone.x, zone.x + zone.w);
}

/**
 * Soft costs of an axis-aligned run that do not depend on the obstacles'
 * walls: leaving the shared container, running along a title strip, sharing
 * a channel with a connector that is already routed.
 */
export function extraCost(p: Problem, horizontal: boolean, fixed: number, lo: number, hi: number): number {
  return placementCost(p, horizontal, fixed, lo, hi) + sharedCost(p, horizontal, fixed, lo, hi);
}

/** Leaving the shared container and running along title strips. */
function placementCost(p: Problem, horizontal: boolean, fixed: number, lo: number, hi: number): number {
  let cost = 0;
  if (p.home) {
    const r = p.home;
    let inside = 0;
    if (horizontal) {
      if (fixed > r.y && fixed < r.y + r.h) inside = overlapLength(lo, hi, r.x, r.x + r.w);
    } else if (fixed > r.x && fixed < r.x + r.w) inside = overlapLength(lo, hi, r.y, r.y + r.h);
    cost += (hi - lo - inside) * OUTSIDE_PER_PX;
  }
  if (horizontal) {
    for (const strip of p.strips) {
      if (fixed > strip.y && fixed < strip.y + strip.h) cost += overlapLength(lo, hi, strip.x, strip.x + strip.w) * HEADER_PER_PX;
    }
  }
  return cost;
}

/** Sharing a channel with a connector that is already routed. */
function sharedCost(p: Problem, horizontal: boolean, fixed: number, lo: number, hi: number): number {
  return p.routed.count ? p.routed.overlap(horizontal, fixed, lo, hi) * OVERLAP_PER_PX : 0;
}

/**
 * Cost of the free part of a route, `core = [s, …, e]`, under the model the grid
 * search optimises. The two port stubs are fixed by the ports, so only the turns
 * at `s` and `e` are charged on top of the runs between them.
 */
export function evaluate(p: Problem, core: readonly Point[]): Cost {
  const cost: Cost = { total: 0, bends: 0, crossing: 0, soft: 0, shared: 0, penalty: 0 };
  let dirX = p.n0.x;
  let dirY = p.n0.y;
  const turn = (ux: number, uy: number): void => {
    const dot = dirX * ux + dirY * uy;
    if (dot > 0.5) return;
    if (dot < -0.5) cost.total += REVERSAL;
    else {
      cost.total += BEND;
      cost.bends++;
    }
  };
  for (let i = 0; i < core.length - 1; i++) {
    const a = core[i];
    const b = core[i + 1];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > 0.5 && dy > 0.5) {
      cost.total = Infinity;
      return cost;
    }
    const length = dx + dy;
    if (length < 1e-6) continue;
    const horizontal = dy <= dx;
    let hard = 0;
    let soft = 0;
    for (let k = 0; k < p.hard.length; k++) {
      const inHard = insideLength(a, b, p.hard[k]);
      if (inHard > 0) hard += inHard;
      else soft += softLength(a, b, p.soft[k], p.hard[k]);
    }
    hard = Math.min(hard, length);
    soft = Math.min(soft, length - hard);
    const fixed = horizontal ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const placement = placementCost(p, horizontal, fixed, lo, lo + length);
    const shared = sharedCost(p, horizontal, fixed, lo, lo + length);
    const penalty = hard * CROSS_PER_PX + soft * SOFT_PER_PX + placement + shared;
    cost.total += length + penalty;
    cost.penalty += penalty;
    cost.crossing += hard;
    cost.soft += soft + placement;
    cost.shared += shared;
    const ux = horizontal ? Math.sign(b.x - a.x) : 0;
    const uy = horizontal ? 0 : Math.sign(b.y - a.y);
    turn(ux, uy);
    dirX = ux;
    dirY = uy;
  }
  // The run from `e` to the end port leaves against the end port's normal.
  turn(-p.n1.x, -p.n1.y);
  return cost;
}
