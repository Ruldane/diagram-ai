import type { Point, Rect } from "../../model/types";
import { best, detourCandidates, simpleCandidates, type Scored } from "./candidates";
import { evaluate, insideLength, type Problem } from "./cost";
import { boundsOfPoints, cleanPolyline, countBends } from "./polyline";
import { RoutedIndex } from "./routed";
import { searchGrid } from "./search";
import { BoxIndex } from "./spatial";
import { CLEARANCE, HARD_MARGIN, IN_EPS, WINDOW, type RouteEnd, type RouteResult, type SceneBox } from "./types";

/** Shortest run a centred segment leaves on its neighbours. */
const MIN_LEG = 12;
/** Windows tried before the best result so far is accepted. */
const ROUNDS = 4;
/** A simple shape paying less than this in penalties is taken without searching: a search could not save a bend. */
const SIMPLE_SLACK = 20;
/** Times the obstacle set is grown by what the previous answer touched. */
const LAZY_PASSES = 6;

const expand = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const strictlyInside = (r: Rect, p: Point): boolean =>
  p.x > r.x + IN_EPS && p.x < r.x + r.w - IN_EPS && p.y > r.y + IN_EPS && p.y < r.y + r.h - IN_EPS;

/**
 * Obstacle-aware orthogonal router for one diagram.
 *
 * A scene is built once per routing pass and shared by every connector: it owns
 * the spatial index of nodes and the runs of connectors routed so far, so later
 * connectors steer around earlier ones.
 */
export class RoutingScene {
  /** Runs of connectors that are already routed; add the finished ones here. */
  readonly routed = new RoutedIndex();
  private readonly byId = new Map<string, SceneBox>();
  private readonly solid: SceneBox[] = [];
  private readonly containers: SceneBox[] = [];
  private readonly index = new BoxIndex();

  constructor(boxes: readonly SceneBox[]) {
    for (const box of boxes) {
      this.byId.set(box.id, box);
      if (box.container) this.containers.push(box);
      else {
        this.solid.push(box);
        this.index.add(box.box);
      }
    }
  }

  /** Raw (uninflated) boxes of the solid nodes meeting `area`, for post-passes. */
  nodesIn(area: Rect): SceneBox[] {
    return this.index.query(area).map((i) => this.solid[i]);
  }

  /** Nearest container that holds both nodes, if any. */
  private commonContainer(a: string | undefined, b: string | undefined): SceneBox | undefined {
    if (!a || !b) return undefined;
    const chain = new Set<string>();
    for (let id = this.byId.get(a)?.parent, guard = 0; id && guard < 64; guard++) {
      chain.add(id);
      id = this.byId.get(id)?.parent;
    }
    for (let id = this.byId.get(b)?.parent, guard = 0; id && guard < 64; guard++) {
      if (chain.has(id)) return this.byId.get(id);
      id = this.byId.get(id)?.parent;
    }
    return undefined;
  }

  private problem(from: RouteEnd, to: RouteEnd, s: Point, e: Point, home: SceneBox | undefined, area: Rect): Problem {
    const soft: Rect[] = [];
    const hard: Rect[] = [];
    const nodes = this.nodesIn(area);
    // A container the edge is attached to is a wall too (its children are inside it, so the ladder below lets them out).
    for (const end of [from, to]) {
      const box = end.node ? this.byId.get(end.node) : undefined;
      if (box?.container && !nodes.includes(box)) nodes.push(box);
    }
    for (const node of nodes) {
      const attached = node.id === from.node || node.id === to.node;
      const stub = attached ? Math.min(node.id === from.node ? from.stub : Infinity, node.id === to.node ? to.stub : Infinity) : Infinity;
      const zone = expand(node.box, attached ? Math.min(CLEARANCE, stub) : CLEARANCE);
      let core = expand(node.box, attached ? Math.min(HARD_MARGIN, stub) : HARD_MARGIN);
      // An end that starts inside a node's wall is let out through it; one inside the node itself leaves the node out.
      if (strictlyInside(core, s) || strictlyInside(core, e)) core = node.box;
      if (strictlyInside(node.box, s) || strictlyInside(node.box, e)) continue;
      soft.push(zone);
      hard.push(core);
    }
    const strips: Rect[] = [];
    for (const c of this.containers) {
      if (c.header > 0 && c.box.x < area.x + area.w && c.box.x + c.box.w > area.x && c.box.y < area.y + area.h && c.box.y + c.box.h > area.y) {
        strips.push({ x: c.box.x, y: c.box.y, w: c.box.w, h: c.header });
      }
    }
    return { p0: from.point, n0: from.normal, s, p1: to.point, n1: to.normal, e, soft, hard, home: home ? home.box : null, strips, routed: this.routed };
  }

  /**
   * Cheapest route for a problem. Open-space shapes are tried first; otherwise
   * the grid search runs over just the obstacles the answer has to care about,
   * growing that set by whatever the answer turns out to touch. Obstacles
   * left out cannot make the result worse (they only ever add cost), so the
   * route is optimal for the full set while the grid stays small.
   */
  private solve(p: Problem): Scored {
    const simple = best(p, simpleCandidates(p.s, p.e));
    if (simple.cost.crossing === 0 && simple.cost.penalty <= SIMPLE_SLACK && Number.isFinite(simple.cost.total)) return simple;

    const touched = (core: Point[], from: number[]): number[] => {
      const hits: number[] = [];
      for (let k = 0; k < p.soft.length; k++) {
        if (from.includes(k)) continue;
        for (let i = 0; i < core.length - 1; i++) {
          if (insideLength(core[i], core[i + 1], p.soft[k]) > 0) {
            hits.push(k);
            break;
          }
        }
      }
      return hits;
    };
    let active = touched(simple.core, []);
    for (let pass = 0; pass < LAZY_PASSES; pass++) {
      const sub: Problem = { ...p, soft: active.map((k) => p.soft[k]), hard: active.map((k) => p.hard[k]) };
      const grid = searchGrid(sub);
      if (!grid) break;
      const more = touched(grid, active);
      if (more.length === 0) {
        const cost = evaluate(p, grid);
        return cost.total < simple.cost.total ? { core: grid, cost } : simple;
      }
      active = [...active, ...more].sort((x, y) => x - y);
    }
    // Over budget: the simple shapes plus swings around everything nearby, judged against the real obstacles.
    const around = boundsOfPoints([p.s, p.e, ...p.soft.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }])]);
    return best(p, [...simpleCandidates(p.s, p.e), ...detourCandidates(p.s, p.e, expand(around, CLEARANCE))]);
  }

  /**
   * Routes one connector between two resolved ports. Never throws and always
   * returns an orthogonal polyline: when no obstacle-free route exists the one
   * crossing the least node area is returned (`crossing > 0`).
   */
  route(from: RouteEnd, to: RouteEnd): RouteResult {
    const s = { x: from.point.x + from.normal.x * (from.depth + from.stub), y: from.point.y + from.normal.y * (from.depth + from.stub) };
    const e = { x: to.point.x + to.normal.x * (to.depth + to.stub), y: to.point.y + to.normal.y * (to.depth + to.stub) };
    const home = this.commonContainer(from.node, to.node);
    const focus = boundsOfPoints([from.point, to.point, s, e]);

    let area = expand(focus, WINDOW);
    let chosen: { scored: Scored; problem: Problem } | null = null;
    for (let round = 0; round < ROUNDS; round++) {
      const problem = this.problem(from, to, s, e, home, area);
      const scored = this.solve(problem);
      if (!chosen || scored.cost.total < chosen.scored.cost.total) chosen = { scored, problem };
      const reach = boundsOfPoints(scored.core);
      if (!contains(area, reach)) {
        // The route left the window, so obstacles beyond it were never considered: widen and ask again.
        area = expand(boundsOfPoints([...scored.core, { x: area.x, y: area.y }, { x: area.x + area.w, y: area.y + area.h }]), CLEARANCE * 2);
        chosen = null;
        continue;
      }
      if (scored.cost.crossing === 0) break;
      // Blocked inside the window: a detour may exist further out.
      area = expand(area, Math.max(area.w, area.h) / 2 + WINDOW);
    }
    // `chosen` is only unset when every round left its window; take the last round's answer then.
    if (!chosen) {
      const problem = this.problem(from, to, s, e, home, area);
      chosen = { scored: this.solve(problem), problem };
    }

    const { scored, problem } = chosen;
    let points = cleanPolyline([from.point, ...scored.core, to.point]);
    points = this.center(points, problem, from.depth + from.stub, to.depth + to.stub);
    return {
      points,
      cost: scored.cost.total,
      shared: scored.cost.shared,
      bends: countBends(points),
      clean: scored.cost.crossing === 0 && scored.cost.soft === 0 && scored.cost.shared === 0,
      crossing: scored.cost.crossing,
    };
  }

  /**
   * Slides every interior run to the middle of the free space it can move in,
   * so a connector crossing a channel runs down the channel rather than along
   * whichever wall the search happened to touch. Runs with open space on one
   * side stay where the search put them (at the clearance distance).
   */
  private center(points: Point[], p: Problem, reachFrom: number, reachTo: number): Point[] {
    const n = points.length;
    if (n < 4) return points;
    const pts = points.map((q) => ({ x: q.x, y: q.y }));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i <= n - 3; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const horizontal = a.y === b.y;
        if (!horizontal && a.x !== b.x) continue;
        const c = horizontal ? a.y : a.x;
        const lo0 = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
        const hi0 = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        const before = pts[i - 1];
        const after = pts[i + 2];
        const cb = horizontal ? before.y : before.x;
        const ca = horizontal ? after.y : after.x;

        let low = -Infinity;
        let high = Infinity;
        const legBefore = Math.min(Math.abs(c - cb), i === 1 ? reachFrom : MIN_LEG);
        const legAfter = Math.min(Math.abs(c - ca), i === n - 3 ? reachTo : MIN_LEG);
        if (c > cb) low = Math.max(low, cb + legBefore);
        else high = Math.min(high, cb - legBefore);
        if (c > ca) low = Math.max(low, ca + legAfter);
        else high = Math.min(high, ca - legAfter);

        let blocked = false;
        const bound = (r: Rect): "low" | "high" | "across" | "none" => {
          const along0 = horizontal ? r.x : r.y;
          const along1 = along0 + (horizontal ? r.w : r.h);
          if (along1 <= lo0 + IN_EPS || along0 >= hi0 - IN_EPS) return "none";
          const across0 = horizontal ? r.y : r.x;
          const across1 = across0 + (horizontal ? r.h : r.w);
          if (across1 <= c + 0.01) {
            low = Math.max(low, across1);
            return "low";
          }
          if (across0 >= c - 0.01) {
            high = Math.min(high, across0);
            return "high";
          }
          return "across";
        };
        for (let k = 0; k < p.soft.length; k++) {
          const lowBefore = low;
          const highBefore = high;
          if (bound(p.soft[k]) === "across") {
            // Inside this node's clearance zone: only its core is a wall now.
            low = lowBefore;
            high = highBefore;
            if (bound(p.hard[k]) === "across") blocked = true;
          }
        }
        if (horizontal) {
          for (const strip of p.strips) bound(strip);
        }
        if (blocked || !Number.isFinite(low) || !Number.isFinite(high) || high - low < 1) continue;
        const target = (low + high) / 2;
        if (Math.abs(target - c) < 0.5) continue;
        if (horizontal) {
          a.y = target;
          b.y = target;
        } else {
          a.x = target;
          b.x = target;
        }
      }
    }
    return cleanPolyline(pts);
  }
}
