import type { Point } from "../../model/types";
import { extraCost, rampFactor, type Problem } from "./cost";
import { BEND, CROSS_PER_PX, GREED, HARD_MARGIN, IN_EPS, MAX_OBSTACLES, MAX_VERTICES, REVERSAL, SNAP, SOFT_PER_PX } from "./types";

/** Neighbours of a grid vertex, in the order the search tries them. 0 → +x, 1 → +y, 2 → −x, 3 → −y. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

const HARD = 1;

/** Search budget: states expanded before the sparse graph is given up on. */
const MAX_EXPANSIONS = 12000;
/** Gaps narrower than this between two nodes get a line down their middle. */
const NARROW_GAP = 3 * HARD_MARGIN + 24;

/* ----------------------------------------------------------- scratch space */

/** Typed arrays reused between searches; generation stamps avoid clearing them. */
const scratch = {
  g: new Float64Array(0),
  parent: new Int32Array(0),
  open: new Uint32Array(0),
  closed: new Uint32Array(0),
  unit: new Float32Array(0),
  heapKey: new Float64Array(0),
  heapState: new Int32Array(0),
  tick: 0,
};

function grow<T extends Float64Array | Int32Array | Uint32Array | Float32Array>(array: T, length: number, make: (n: number) => T): T {
  return array.length >= length ? array : make(Math.max(length, array.length * 2));
}

/* ------------------------------------------------------------- coordinates */

/**
 * Sorted unique coordinates. The priority values (exact port coordinates) are
 * always kept; others within `SNAP` of one of them, or of the previous value, are dropped.
 */
function lines(priority: number[], others: number[]): Float64Array {
  const kept = [...priority];
  let last = -Infinity;
  for (const v of others.slice().sort((a, b) => a - b)) {
    if (v - last < SNAP || priority.some((a) => Math.abs(a - v) < SNAP)) continue;
    kept.push(v);
    last = v;
  }
  return Float64Array.from(kept.sort((a, b) => a - b));
}

/** First index whose value is strictly greater than `v`. */
function upper(array: Float64Array, v: number): number {
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (array[mid] > v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index whose value is greater than or equal to `v`. */
function lower(array: Float64Array, v: number): number {
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (array[mid] >= v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Index of the line holding exactly `v` (priority coordinates are always present). */
function indexOf(array: Float64Array, v: number): number {
  return Math.min(lower(array, v), array.length - 1);
}

const direction = (n: Point): number => (n.x > 0.5 ? 0 : n.y > 0.5 ? 1 : n.x < -0.5 ? 2 : 3);

/* ------------------------------------------------------------------ search */

/**
 * Finds the cheapest axis-aligned route from `s` to `e` on the sparse grid
 * spanned by the obstacle borders, the ports and the middle of narrow gaps.
 * Obstacles are crossable at a steep price, so a route always exists; the
 * function returns `null` only when the grid is over budget.
 *
 * The first move may continue along `n0` for free or turn (one bend); the last
 * run into `e` is charged for turning against `n1`.
 */
export function searchGrid(p: Problem): Point[] | null {
  const { s, e } = p;
  const soft = p.soft;
  const hard = p.hard;
  if (soft.length > MAX_OBSTACLES) return null;

  const xValues: number[] = [];
  const yValues: number[] = [];
  if (Math.abs(s.x - e.x) > 2) xValues.push((s.x + e.x) / 2);
  if (Math.abs(s.y - e.y) > 2) yValues.push((s.y + e.y) / 2);
  for (let k = 0; k < soft.length; k++) {
    const r = soft[k];
    xValues.push(r.x, r.x + r.w);
    yValues.push(r.y, r.y + r.h);
  }
  // Nodes closer than a clearance zone have no free line between their zones: add one down the gap.
  for (let a = 0; a < hard.length; a++) {
    const ra = hard[a];
    for (let b = a + 1; b < hard.length; b++) {
      const rb = hard[b];
      if (ra.y < rb.y + rb.h && ra.y + ra.h > rb.y) {
        const gap = Math.max(rb.x - (ra.x + ra.w), ra.x - (rb.x + rb.w));
        if (gap >= 0 && gap < NARROW_GAP) {
          const left = ra.x < rb.x ? ra : rb;
          const right = left === ra ? rb : ra;
          xValues.push((left.x + left.w + right.x) / 2);
        }
      }
      if (ra.x < rb.x + rb.w && ra.x + ra.w > rb.x) {
        const gap = Math.max(rb.y - (ra.y + ra.h), ra.y - (rb.y + rb.h));
        if (gap >= 0 && gap < NARROW_GAP) {
          const top = ra.y < rb.y ? ra : rb;
          const bottom = top === ra ? rb : ra;
          yValues.push((top.y + top.h + bottom.y) / 2);
        }
      }
    }
  }
  const xs = lines([s.x, e.x], xValues);
  const ys = lines([s.y, e.y], yValues);
  const nx = xs.length;
  const ny = ys.length;
  if (nx * ny > MAX_VERTICES) return null;

  const hCount = (nx - 1) * ny;
  const vCount = nx * (ny - 1);
  const flags = new Uint8Array(hCount + vCount);
  /** Clearance penalty weight (0..1) of every unit edge, see `rampFactor`. */
  const ramp = new Float32Array(hCount + vCount);

  type Box = { x: number; y: number; w: number; h: number };
  const mark = (r: Box, core?: Box): void => {
    const x0 = r.x + IN_EPS;
    const x1 = r.x + r.w - IN_EPS;
    const y0 = r.y + IN_EPS;
    const y1 = r.y + r.h - IN_EPS;
    if (x1 <= x0 || y1 <= y0) return;
    // Horizontal unit edges: rows strictly between y0 and y1, columns overlapping (x0, x1).
    const rowLo = upper(ys, y0);
    const rowHi = lower(ys, y1) - 1;
    const colLo = Math.max(0, upper(xs, x0) - 1);
    const colHi = Math.min(nx - 2, lower(xs, x1) - 1);
    for (let j = rowLo; j <= rowHi; j++) {
      const weight = core ? rampFactor(ys[j], core.y, core.y + core.h, r.y, r.y + r.h) : 1;
      for (let i = colLo; i <= colHi; i++) {
        const at = j * (nx - 1) + i;
        if (core) {
          if (weight > ramp[at]) ramp[at] = weight;
        } else flags[at] |= HARD;
      }
    }
    // Vertical unit edges: columns strictly between x0 and x1, rows overlapping (y0, y1).
    const col2Lo = upper(xs, x0);
    const col2Hi = lower(xs, x1) - 1;
    const row2Lo = Math.max(0, upper(ys, y0) - 1);
    const row2Hi = Math.min(ny - 2, lower(ys, y1) - 1);
    for (let i = col2Lo; i <= col2Hi; i++) {
      const weight = core ? rampFactor(xs[i], core.x, core.x + core.w, r.x, r.x + r.w) : 1;
      for (let j = row2Lo; j <= row2Hi; j++) {
        const at = hCount + j * nx + i;
        if (core) {
          if (weight > ramp[at]) ramp[at] = weight;
        } else flags[at] |= HARD;
      }
    }
  };
  for (let k = 0; k < soft.length; k++) mark(soft[k], hard[k]);
  for (const r of hard) mark(r);

  const vertices = nx * ny;
  const states = vertices * 4;
  scratch.g = grow(scratch.g, states + 1, (n) => new Float64Array(n));
  scratch.parent = grow(scratch.parent, states + 1, (n) => new Int32Array(n));
  scratch.open = grow(scratch.open, states + 1, (n) => new Uint32Array(n));
  scratch.closed = grow(scratch.closed, states + 1, (n) => new Uint32Array(n));
  const { g, parent, open, closed } = scratch;
  const tick = ++scratch.tick;

  // Cost of every unit edge, filled in when the search first looks at it (-1 = not yet).
  scratch.unit = grow(scratch.unit, hCount + vCount, (n) => new Float32Array(n));
  const unitCost = scratch.unit;
  unitCost.fill(-1, 0, hCount + vCount);
  const needsExtra = p.home !== null || p.strips.length > 0 || p.routed.count > 0;

  const startI = indexOf(xs, s.x);
  const startJ = indexOf(ys, s.y);
  const goalI = indexOf(xs, e.x);
  const goalJ = indexOf(ys, e.y);
  const goal = goalJ * nx + goalI;
  const sink = states;
  const startDir = direction(p.n0);
  const straightIn = (direction(p.n1) + 2) % 4;
  const reverseIn = direction(p.n1);
  const arrival = (d: number): number => (d === straightIn ? 0 : d === reverseIn ? REVERSAL : BEND);

  /** Cost of the unit edge leaving vertex (i, j) in direction d. */
  const unit = (i: number, j: number, d: number): number => {
    const horizontal = (d & 1) === 0;
    const key = horizontal ? j * (nx - 1) + (d === 0 ? i : i - 1) : hCount + (d === 1 ? j : j - 1) * nx + i;
    const cached = unitCost[key];
    if (cached >= 0) return cached;
    let length: number;
    let cost: number;
    if (horizontal) {
      const left = d === 0 ? i : i - 1;
      length = xs[left + 1] - xs[left];
      cost = length;
      if (needsExtra) cost += extraCost(p, true, ys[j], xs[left], xs[left + 1]);
    } else {
      const top = d === 1 ? j : j - 1;
      length = ys[top + 1] - ys[top];
      cost = length;
      if (needsExtra) cost += extraCost(p, false, xs[i], ys[top], ys[top + 1]);
    }
    if (flags[key] & HARD) cost += length * CROSS_PER_PX;
    else cost += length * SOFT_PER_PX * ramp[key];
    unitCost[key] = cost;
    return cost;
  };

  const heuristic = (i: number, j: number, d: number): number => {
    const dx = xs[goalI] - xs[i];
    const dy = ys[goalJ] - ys[j];
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let bends = 0;
    if (ax > 0 && ay > 0) bends = 1;
    else if (ay === 0 && ax > 0) {
      if (d % 2 === 1) bends = 1;
      else bends = (dx > 0 ? 0 : 2) === d ? 0 : 2;
    } else if (ax === 0 && ay > 0) {
      if (d % 2 === 0) bends = 1;
      else bends = (dy > 0 ? 1 : 3) === d ? 0 : 2;
    }
    return (ax + ay) * GREED + bends * BEND;
  };

  // Binary min-heap on (key, state); the key folds in a hair of -g so that deeper states win ties.
  scratch.heapKey = grow(scratch.heapKey, 64, (n) => new Float64Array(n));
  scratch.heapState = grow(scratch.heapState, 64, (n) => new Int32Array(n));
  let size = 0;
  const push = (key: number, state: number): void => {
    if (size >= scratch.heapKey.length) {
      const keys = new Float64Array(scratch.heapKey.length * 2);
      const stateArr = new Int32Array(scratch.heapState.length * 2);
      keys.set(scratch.heapKey);
      stateArr.set(scratch.heapState);
      scratch.heapKey = keys;
      scratch.heapState = stateArr;
    }
    const keys = scratch.heapKey;
    const stateArr = scratch.heapState;
    let at = size++;
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (keys[up] < key || (keys[up] === key && stateArr[up] <= state)) break;
      keys[at] = keys[up];
      stateArr[at] = stateArr[up];
      at = up;
    }
    keys[at] = key;
    stateArr[at] = state;
  };
  const pop = (): number => {
    const keys = scratch.heapKey;
    const stateArr = scratch.heapState;
    const top = stateArr[0];
    size--;
    if (size > 0) {
      const key = keys[size];
      const state = stateArr[size];
      let at = 0;
      for (;;) {
        let child = at * 2 + 1;
        if (child >= size) break;
        if (child + 1 < size && (keys[child + 1] < keys[child] || (keys[child + 1] === keys[child] && stateArr[child + 1] < stateArr[child]))) child++;
        if (key < keys[child] || (key === keys[child] && state <= stateArr[child])) break;
        keys[at] = keys[child];
        stateArr[at] = stateArr[child];
        at = child;
      }
      keys[at] = key;
      stateArr[at] = state;
    }
    return top;
  };

  const startState = (startJ * nx + startI) * 4 + startDir;
  g[startState] = 0;
  open[startState] = tick;
  parent[startState] = -1;
  push(heuristic(startI, startJ, startDir), startState);

  g[sink] = Infinity;
  open[sink] = tick;
  parent[sink] = -1;
  if (startJ * nx + startI === goal) {
    g[sink] = arrival(startDir);
    parent[sink] = startState;
    push(g[sink], sink);
  }

  let expansions = 0;
  let found = false;
  while (size > 0) {
    const state = pop();
    if (state === sink) {
      found = true;
      break;
    }
    if (closed[state] === tick) continue;
    closed[state] = tick;
    if (++expansions > MAX_EXPANSIONS) return null;

    const d = state & 3;
    const v = state >> 2;
    const i = v % nx;
    const j = (v - i) / nx;
    const base = g[state];
    for (let turn = 0; turn < 3; turn++) {
      const nd = turn === 0 ? d : turn === 1 ? (d + 1) & 3 : (d + 3) & 3;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const ng = base + unit(i, j, nd) + (nd === d ? 0 : BEND);
      const next = (nj * nx + ni) * 4 + nd;
      if (closed[next] === tick) continue;
      if (open[next] === tick && g[next] <= ng) continue;
      open[next] = tick;
      g[next] = ng;
      parent[next] = state;
      push(ng + heuristic(ni, nj, nd) - ng * 1e-7, next);
      if (nj * nx + ni === goal) {
        const total = ng + arrival(nd);
        if (total < g[sink]) {
          g[sink] = total;
          parent[sink] = next;
          push(total, sink);
        }
      }
    }
  }
  if (!found) return null;

  const route: Point[] = [];
  for (let state = parent[sink]; state >= 0; state = parent[state]) {
    const v = state >> 2;
    const i = v % nx;
    route.push({ x: xs[i], y: ys[(v - i) / nx] });
  }
  route.reverse();
  // The ends are the exact port coordinates (they were passed as priority lines).
  if (route.length === 1) return [{ x: s.x, y: s.y }, { x: e.x, y: e.y }];
  route[0] = { x: s.x, y: s.y };
  route[route.length - 1] = { x: e.x, y: e.y };
  return route;
}
