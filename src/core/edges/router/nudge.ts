import type { Point, Rect } from "../../model/types";
import { insideLength } from "./cost";
import { cleanPolyline } from "./polyline";
import type { RoutingScene } from "./scene";

/** Distance between connectors that share a channel. */
const SPACING = 6;
/** Closest a nudged run may come to a node. */
const WALL = 5;
/** Shortest leg a nudged run leaves on its neighbours (a little more next to a port, for the arrowhead). */
const MIN_LEG = 10;
const MIN_END_LEG = 14;
/** Runs this close on one line are the same channel. */
const SAME_LINE = 1.2;
/** Overlap shorter than this is two connectors touching, not sharing. */
const MIN_SHARED = 2;

interface Run {
  /** Index into the movable routes, or -1 for a run that cannot move. */
  route: number;
  /** Segment index: `points[at] → points[at + 1]`. */
  at: number;
  horizontal: boolean;
  coord: number;
  lo: number;
  hi: number;
}

const sign = (v: number): number => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);

function collect(points: readonly Point[], route: number, movable: boolean, into: Run[]): void {
  for (let at = 0; at < points.length - 1; at++) {
    const a = points[at];
    const b = points[at + 1];
    const horizontal = Math.abs(a.y - b.y) <= Math.abs(a.x - b.x);
    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    if (hi - lo < MIN_SHARED) continue;
    // Only the runs between the two port stubs may slide: the stubs belong to the ports.
    const interior = movable && at >= 1 && at <= points.length - 3;
    into.push({ route: interior ? route : -1, at, horizontal, coord: horizontal ? (a.y + b.y) / 2 : (a.x + b.x) / 2, lo, hi });
  }
}

/**
 * Spreads connectors that run on top of each other. Runs of different
 * connectors on one line and overlapping in extent are fanned out a few px
 * apart, ordered so that the ones turning the same way stay on the same side
 * (no new crossings), and kept clear of the nodes beside the channel.
 *
 * `routes` are the polylines that may be adjusted (interior runs only; ports
 * and stubs never move); `pinned` polylines only act as runs to keep away from.
 * Returns adjusted copies, index-aligned with `routes`.
 */
export function nudge(routes: readonly Point[][], pinned: readonly Point[][], scene: RoutingScene): Point[][] {
  const out = routes.map((route) => route.map((p) => ({ x: p.x, y: p.y })));
  const runs: Run[] = [];
  out.forEach((route, index) => collect(route, index, true, runs));
  pinned.forEach((route) => collect(route, -1, false, runs));

  const changed = new Set<number>();
  for (const horizontal of [true, false]) {
    const axis = runs.filter((r) => r.horizontal === horizontal).sort((p, q) => p.coord - q.coord || p.lo - q.lo);
    let start = 0;
    while (start < axis.length) {
      let end = start + 1;
      while (end < axis.length && axis[end].coord - axis[end - 1].coord <= SAME_LINE) end++;
      // One line; split it into groups of runs that actually overlap.
      const line = axis.slice(start, end).sort((p, q) => p.lo - q.lo || p.hi - q.hi);
      let group: Run[] = [];
      let reach = -Infinity;
      const flush = (): void => {
        if (group.length > 1 && group.some((r) => r.route >= 0)) spread(group, horizontal, out, scene, changed);
        group = [];
        reach = -Infinity;
      };
      for (const run of line) {
        if (group.length && run.lo >= reach - MIN_SHARED) flush();
        group.push(run);
        reach = Math.max(reach, run.hi);
      }
      flush();
      start = end;
    }
  }

  return out.map((route, index) => {
    if (!changed.has(index)) return routes[index];
    const tidy = cleanPolyline(route);
    return hitsMore(tidy, routes[index], scene) ? routes[index] : tidy;
  });
}

/** True when `after` runs through more nodes (interior runs only) than `before` does. */
function hitsMore(after: readonly Point[], before: readonly Point[], scene: RoutingScene): boolean {
  const count = (route: readonly Point[]): number => {
    let area = { x: Infinity, y: Infinity, w: 0, h: 0 };
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of route) {
      if (p.x < area.x) area.x = p.x;
      if (p.y < area.y) area.y = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    area = { x: area.x - 2, y: area.y - 2, w: maxX - area.x + 4, h: maxY - area.y + 4 };
    let hits = 0;
    for (const node of scene.nodesIn(area)) {
      for (let i = 1; i < route.length - 2; i++) if (insideLength(route[i], route[i + 1], node.box) > 0) hits++;
    }
    return hits;
  };
  return count(after) > count(before);
}

function spread(group: Run[], horizontal: boolean, out: Point[][], scene: RoutingScene, changed: Set<number>): void {
  const base = group.reduce((sum, r) => sum + r.coord, 0) / group.length;

  // Order across the channel: a run that turns away on both ends goes to the outside.
  const key = (r: Run): [number, number] => {
    if (r.route < 0) return [0, 0];
    const route = out[r.route];
    const before = route[r.at - 1];
    const after = route[r.at + 2];
    const t1 = sign(horizontal ? before.y - r.coord : before.x - r.coord);
    const t2 = sign(horizontal ? after.y - r.coord : after.x - r.coord);
    const startIsLow = (horizontal ? route[r.at].x <= route[r.at + 1].x : route[r.at].y <= route[r.at + 1].y);
    return [t1 + t2, startIsLow ? t1 : t2];
  };
  const keyed = group.map((run) => ({ run, k: key(run) }));
  keyed.sort((p, q) => p.k[0] - q.k[0] || p.k[1] - q.k[1] || p.run.route - q.run.route || p.run.at - q.run.at);
  const ordered = keyed.map((entry) => entry.run);

  // Free corridor around the line: the nearest node walls above and below the group's extent.
  const lo = Math.min(...group.map((r) => r.lo));
  const hi = Math.max(...group.map((r) => r.hi));
  const area: Rect = horizontal ? { x: lo, y: base - 80, w: hi - lo, h: 160 } : { x: base - 80, y: lo, w: 160, h: hi - lo };
  let floor = -Infinity;
  let ceiling = Infinity;
  for (const node of scene.nodesIn(area)) {
    const r = node.box;
    const along0 = horizontal ? r.x : r.y;
    const along1 = along0 + (horizontal ? r.w : r.h);
    if (along1 <= lo + 0.5 || along0 >= hi - 0.5) continue;
    const across0 = horizontal ? r.y : r.x;
    const across1 = across0 + (horizontal ? r.h : r.w);
    if (across1 <= base + 0.5) floor = Math.max(floor, across1 + WALL);
    else if (across0 >= base - 0.5) ceiling = Math.min(ceiling, across0 - WALL);
    else return; // the line runs through a node: leave it alone
  }

  const count = ordered.length;
  const span = (count - 1) * SPACING;
  const roomLow = floor - base;
  const roomHigh = ceiling - base;
  let spacing = SPACING;
  // Centred on the line, or around the fixed run when there is one.
  const fixedAt = ordered.findIndex((r) => r.route < 0);
  let first = fixedAt >= 0 ? -fixedAt * SPACING : -span / 2;
  if (first + span > roomHigh) first = roomHigh - span;
  if (first < roomLow) first = roomLow;
  if (first + span > roomHigh) {
    // The channel is too narrow for the usual spacing: tighten, or leave it alone.
    spacing = (roomHigh - roomLow) / (count - 1);
    if (!(spacing >= 2)) return;
    first = roomLow;
  }

  ordered.forEach((run, index) => {
    if (run.route < 0) return;
    const route = out[run.route];
    const a = route[run.at];
    const b = route[run.at + 1];
    const before = route[run.at - 1];
    const after = route[run.at + 2];
    const current = run.coord;
    let negative = Infinity;
    let positive = Infinity;
    // Neighbours must keep a visible leg, so a run may only slide so far.
    const limit = (far: number, endLeg: boolean): void => {
      const length = Math.abs(current - far);
      const room = length - Math.min(length, endLeg ? MIN_END_LEG : MIN_LEG);
      if (current > far) negative = Math.min(negative, room);
      else positive = Math.min(positive, room);
    };
    limit(horizontal ? before.y : before.x, run.at - 1 === 0);
    limit(horizontal ? after.y : after.x, run.at + 1 === route.length - 2);
    const target = base + first + index * spacing;
    const delta = Math.max(-negative, Math.min(positive, target - current));
    if (Math.abs(delta) < 0.25) return;
    if (horizontal) {
      a.y += delta;
      b.y += delta;
    } else {
      a.x += delta;
      b.x += delta;
    }
    changed.add(run.route);
  });
}
