import type { Point, Rect } from "../../model/types";
import { evaluate, type Cost, type Problem } from "./cost";

const ALIGNED = 0.5;

/**
 * The one-to-three segment routes between the free ends `s` and `e`: straight
 * line, both L shapes and both Z shapes through the middle. These are what the
 * grid search would pick in open space, so a clean one needs no search at all.
 */
export function simpleCandidates(s: Point, e: Point): Point[][] {
  const out: Point[][] = [];
  const aligned = Math.abs(s.x - e.x) < ALIGNED || Math.abs(s.y - e.y) < ALIGNED;
  if (aligned) out.push([s, e]);
  const mx = (s.x + e.x) / 2;
  const my = (s.y + e.y) / 2;
  out.push(
    [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e],
    [s, { x: s.x, y: my }, { x: e.x, y: my }, e],
    [s, { x: e.x, y: s.y }, e],
    [s, { x: s.x, y: e.y }, e],
  );
  return out;
}

/** Routes that swing around the whole cluster: the last resort when the grid is over budget. */
export function detourCandidates(s: Point, e: Point, around: Rect): Point[][] {
  const left = around.x;
  const right = around.x + around.w;
  const top = around.y;
  const bottom = around.y + around.h;
  return [
    [s, { x: s.x, y: top }, { x: e.x, y: top }, e],
    [s, { x: s.x, y: bottom }, { x: e.x, y: bottom }, e],
    [s, { x: left, y: s.y }, { x: left, y: e.y }, e],
    [s, { x: right, y: s.y }, { x: right, y: e.y }, e],
  ];
}

export interface Scored {
  core: Point[];
  cost: Cost;
}

/** The cheapest candidate; the earliest wins ties so the result is stable. */
export function best(problem: Problem, candidates: Point[][]): Scored {
  let winner: Scored | null = null;
  for (const core of candidates) {
    const cost = evaluate(problem, core);
    if (!winner || cost.total < winner.cost.total) winner = { core, cost };
  }
  // `candidates` is never empty; the fallback keeps the type honest.
  return winner ?? { core: [problem.s, problem.e], cost: evaluate(problem, [problem.s, problem.e]) };
}
