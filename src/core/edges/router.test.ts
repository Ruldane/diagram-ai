import { describe, expect, it } from "vitest";

import type { DiagramDoc, DNode, Point, Rect } from "../model/types";
import { nodeBox, routeEdge, routeEdges, type EdgeGeometry } from "./geometry";
import { RoutingScene } from "./router";
import {
  box,
  crossesRect,
  docOf,
  freeRouteExists,
  group,
  legacyRoute,
  link,
  randomScene,
  scenarios,
} from "./router.fixtures";

/* ------------------------------------------------------------------ helpers */

const isOrthogonal = (points: Point[]): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return false;
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) return false;
  }
  return true;
};

const bendsOf = (points: Point[]): number => {
  let bends = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const horizontalIn = Math.abs(points[i].y - points[i - 1].y) < 1e-6;
    const horizontalOut = Math.abs(points[i + 1].y - points[i].y) < 1e-6;
    if (horizontalIn !== horizontalOut) bends++;
  }
  return bends;
};

const endNodes = (doc: DiagramDoc, id: string): DNode[] => {
  const edge = doc.edges[id];
  return [edge.from.node, edge.to.node].flatMap((n) => (n ? [doc.nodes[n]] : []));
};

const others = (doc: DiagramDoc, id: string): DNode[] => {
  const ends = new Set(endNodes(doc, id).map((n) => n.id));
  return Object.values(doc.nodes).filter((n) => !ends.has(n.id) && n.shape !== "basic/group" && n.shape !== "basic/frame");
};

const lengthOf = (points: Point[]): number => {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += Math.abs(points[i].x - points[i + 1].x) + Math.abs(points[i].y - points[i + 1].y);
  return total;
};

/** Normals of a route's first and last run, pointing away from the node. */
const normals = (points: Point[]): [Point, Point] => {
  const unit = (a: Point, b: Point): Point => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  };
  return [unit(points[0], points[1]), unit(points[points.length - 1], points[points.length - 2])];
};

/* ----------------------------------------------------------- hand-made scenes */

describe("obstacle-aware routing", () => {
  it("goes around a wall instead of through it", () => {
    const doc = scenarios().find((s) => s.name === "wall")!.doc;
    const { points } = routeEdges(doc).get("e1")!;
    expect(isOrthogonal(points)).toBe(true);
    for (const wall of others(doc, "e1")) expect(crossesRect(points, nodeBox(wall)), wall.id).toBe(false);
    // Out of A, around one end of the wall, into B: no more than four bends.
    expect(bendsOf(points)).toBeLessThanOrEqual(4);
    expect(Math.abs(points[0].y - points[points.length - 1].y)).toBeLessThan(1);
  });

  it("detours around a single node in the straight path, keeping its clearance", () => {
    const doc = docOf([box("A", 0, 100), box("X", 220, 100), box("B", 440, 100)], [link("e", "A", "B")]);
    const { points } = routeEdges(doc).get("e")!;
    expect(crossesRect(points, nodeBox(doc.nodes.X))).toBe(false);
    // No run hugs the node: every run that passes beside it keeps at least 8 px away.
    const x = nodeBox(doc.nodes.X);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (Math.abs(a.y - b.y) > 1e-6) continue; // horizontal runs only
      const overlapsX = Math.min(Math.max(a.x, b.x), x.x + x.w) - Math.max(Math.min(a.x, b.x), x.x) > 0;
      if (!overlapsX) continue;
      const gap = Math.min(Math.abs(a.y - x.y), Math.abs(a.y - (x.y + x.h)));
      expect(gap).toBeGreaterThanOrEqual(8);
    }
  });

  it("keeps a straight connector straight when nothing is in the way", () => {
    const doc = docOf([box("A", 0, 0), box("B", 300, 0)], [link("e", "A", "B")]);
    expect(routeEdges(doc).get("e")!.points).toHaveLength(2);
  });

  it("uses a narrow gap rather than a long detour, down the middle of it", () => {
    const doc = scenarios().find((s) => s.name === "narrow-gap")!.doc;
    const { points } = routeEdges(doc).get("e1")!;
    expect(points).toHaveLength(2);
    for (const wall of others(doc, "e1")) expect(crossesRect(points, nodeBox(wall)), wall.id).toBe(false);
    // The gap between the two walls is x 235..265; the line sits in it.
    expect(points[0].x).toBeGreaterThan(236);
    expect(points[0].x).toBeLessThan(264);
  });

  it("falls back to the cheapest crossing when the end node is boxed in", () => {
    // B is walled in on all four sides: no free route exists, but a route must still come out.
    const walls = [
      box("t", 280, 90, { w: 200, h: 20 }),
      box("b", 280, 190, { w: 200, h: 20 }),
      box("l", 270, 90, { w: 20, h: 120 }),
      box("r", 470, 90, { w: 20, h: 120 }),
    ];
    const doc = docOf([box("A", 0, 120), box("B", 330, 120, { w: 100, h: 60 }), ...walls], [link("e", "A", "B")]);
    const { points } = routeEdges(doc).get("e")!;
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(points)).toBe(true);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // Crosses one thin wall at most, not a detour through several.
    const crossed = walls.filter((w) => crossesRect(points, nodeBox(w), 1, points.length - 2));
    expect(crossed.length).toBeLessThanOrEqual(1);
  });

  it("treats containers as passable and keeps siblings' connectors inside their container", () => {
    const doc = scenarios().find((s) => s.name === "containers")!.doc;
    const routes = routeEdges(doc);
    const g1 = nodeBox(doc.nodes.G1);
    for (const id of ["e1", "e2"]) {
      const { points } = routes.get(id)!;
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(g1.x);
        expect(p.x).toBeLessThanOrEqual(g1.x + g1.w);
        expect(p.y).toBeGreaterThanOrEqual(g1.y);
        expect(p.y).toBeLessThanOrEqual(g1.y + g1.h);
      }
    }
    // The connector from a client crosses the container border freely and still avoids the nodes inside.
    for (const id of ["e3", "e4"]) {
      for (const node of others(doc, id)) expect(crossesRect(routes.get(id)!.points, nodeBox(node)), `${id} through ${node.id}`).toBe(false);
    }
  });

  it("does not run along a container's title strip when there is another way", () => {
    // Both nodes sit just below the 32 px header; a detour over the top would run along it.
    const doc = docOf(
      [group("G", 0, 0, 500, 260), box("A", 30, 70, { parent: "G" }), box("B", 350, 70, { parent: "G" }), box("X", 190, 70, { parent: "G", w: 120, h: 120 })],
      [link("e", "A", "B")],
    );
    const { points } = routeEdges(doc).get("e")!;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const horizontal = Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 20;
      if (horizontal) expect(a.y, "run inside the title strip").toBeGreaterThan(32);
    }
  });

  it("keeps fixed anchors exactly where the author put them", () => {
    const doc = scenarios().find((s) => s.name === "anchors")!.doc;
    const routes = routeEdges(doc);
    const a = nodeBox(doc.nodes.A);
    const b = nodeBox(doc.nodes.B);
    expect(routes.get("e1")!.start.x).toBeCloseTo(a.x + a.w / 2, 3);
    expect(routes.get("e1")!.start.y).toBeCloseTo(a.y, 3);
    expect(routes.get("e1")!.end.x).toBeCloseTo(b.x + b.w / 2, 3);
    expect(routes.get("e2")!.start.y).toBeCloseTo(a.y + a.h, 3);
    expect(routes.get("e3")!.start.x).toBeCloseTo(a.x + a.w, 3);
    for (const id of ["e1", "e2", "e3"]) expect(isOrthogonal(routes.get(id)!.points), id).toBe(true);
  });

  it("leaves stored routes, straight lines and loops alone", () => {
    const doc = docOf(
      [box("A", 0, 0), box("B", 300, 200), box("X", 150, 80)],
      [
        link("stored", "A", "B", { waypoints: [{ x: 60, y: 230 }] }),
        link("line", "A", "B", { routing: "straight" }),
        link("loop", "A", "A"),
        { id: "free", from: { node: "A" }, to: { point: { x: 500, y: 40 } }, routing: "orthogonal" },
        { id: "curve", from: { node: "A" }, to: { node: "B" }, routing: "curved" },
      ],
    );
    const routes = routeEdges(doc);
    expect(routes.get("stored")!.points).toHaveLength(3);
    expect(routes.get("stored")!.points[1]).toEqual({ x: 60, y: 230 });
    expect(routes.get("line")!.points).toHaveLength(2);
    expect(routes.get("loop")!.points.length).toBeGreaterThan(3);
    expect(isOrthogonal(routes.get("free")!.points)).toBe(true);
    expect(routes.get("free")!.end).toEqual({ x: 500, y: 40 });
    expect(routes.size).toBe(5);
    for (const geometry of routes.values()) expect(Number.isFinite(geometry.bounds.w + geometry.bounds.h)).toBe(true);
  });

  it("never drops a connector, whatever its ends refer to", () => {
    const doc = docOf(
      [box("A", 0, 0), box("B", 300, 0)],
      [
        link("ghost-ghost", "ghost", "ghost"),
        link("ghost-a", "ghost", "A"),
        { id: "nowhere", from: {}, to: {}, routing: "orthogonal" },
        link("ok", "A", "B"),
      ],
    );
    const routes = routeEdges(doc);
    expect([...routes.keys()].sort()).toEqual(["ghost-a", "ghost-ghost", "nowhere", "ok"]);
    for (const g of routes.values()) expect(isOrthogonal(g.points)).toBe(true);
  });

  it("routes a single edge on its own with the same result as in a whole document", () => {
    const doc = scenarios().find((s) => s.name === "blocker")!.doc;
    const alone = routeEdge(doc.edges.e1, doc.nodes);
    expect(alone.points).toEqual(routeEdges(doc).get("e1")!.points);
  });

  it("spreads connectors that share a corridor", () => {
    const doc = scenarios().find((s) => s.name === "channel")!.doc;
    const routes = routeEdges(doc);
    // No two connectors may share a stretch of line longer than a few px.
    const runs: { id: string; horizontal: boolean; at: number; lo: number; hi: number }[] = [];
    for (const [id, geometry] of routes) {
      const p = geometry.points;
      // Interior runs only: the first and last belong to the ports.
      for (let i = 1; i < p.length - 2; i++) {
        const horizontal = Math.abs(p[i].y - p[i + 1].y) < 1e-6;
        runs.push({
          id,
          horizontal,
          at: horizontal ? p[i].y : p[i].x,
          lo: horizontal ? Math.min(p[i].x, p[i + 1].x) : Math.min(p[i].y, p[i + 1].y),
          hi: horizontal ? Math.max(p[i].x, p[i + 1].x) : Math.max(p[i].y, p[i + 1].y),
        });
      }
    }
    let shared = 0;
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const p = runs[i];
        const q = runs[j];
        if (p.id === q.id || p.horizontal !== q.horizontal || Math.abs(p.at - q.at) > 1.2) continue;
        shared += Math.max(0, Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo));
      }
    }
    expect(shared).toBeLessThan(40);
  });
});

/* ---------------------------------------------------------- property checks */

describe("routing properties on generated scenes", () => {
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
  const size = (seed: number) => 5 + ((seed * 7) % 36); // 5 … 40 boxes

  it("every route is axis-aligned and finite, and nodes are avoided whenever a free route exists", () => {
    let checked = 0;
    let blocked = 0;
    for (const seed of seeds) {
      const boxes = size(seed);
      const doc = randomScene(seed, boxes, Math.round(boxes * 1.3));
      const routes = routeEdges(doc);
      expect(routes.size).toBe(Object.keys(doc.edges).length);
      for (const [id, geometry] of routes) {
        expect(isOrthogonal(geometry.points), `seed ${seed} ${id}`).toBe(true);
        expect(geometry.path.every((cmd) => cmd.slice(1).every((v) => typeof v !== "number" || Number.isFinite(v)))).toBe(true);
        const walls = others(doc, id);
        const rects = walls.map(nodeBox);
        const ends = endNodes(doc, id).map(nodeBox);
        const p = geometry.points;
        if (!freeRouteExists(p[0], p[p.length - 1], rects, 6, 6, ends)) {
          blocked++;
          continue;
        }
        checked++;
        for (const wall of walls) expect(crossesRect(p, nodeBox(wall)), `seed ${seed} ${id} crosses ${wall.id}`).toBe(false);
      }
    }
    // The oracle must actually have been exercised.
    expect(checked).toBeGreaterThan(200);
    expect(blocked).toBeLessThan(checked);
  });

  it("is deterministic: the same scene routes to the same geometry, every time", () => {
    for (const seed of [3, 11, 19]) {
      const first = routeEdges(randomScene(seed, 30, 40));
      const second = routeEdges(randomScene(seed, 30, 40));
      expect([...second.entries()]).toEqual([...first.entries()]);
    }
  });

  it("does not depend on the order edges are stored in", () => {
    const doc = randomScene(5, 28, 34);
    const reversed: DiagramDoc = { ...doc, edges: Object.fromEntries(Object.entries(doc.edges).reverse()) };
    const a = routeEdges(doc);
    const b = routeEdges(reversed);
    for (const id of Object.keys(doc.edges)) expect(b.get(id)!.points, id).toEqual(a.get(id)!.points);
  });

  it("uses no more bends than the old heuristic where that one found an obstacle-free route", () => {
    let comparable = 0;
    let notWorse = 0;
    for (const seed of seeds) {
      const boxes = size(seed);
      const doc = randomScene(seed, boxes, Math.round(boxes * 1.3));
      const routes = routeEdges(doc);
      for (const [id, geometry] of routes) {
        const [a, b] = endNodes(doc, id);
        const p = geometry.points;
        const [n0, n1] = normals(p);
        const old = legacyRoute(p[0], n0, p[p.length - 1], n1, [nodeBox(a), nodeBox(b)]);
        const clear = others(doc, id).every((wall) => !crossesRect(old, nodeBox(wall)));
        if (!clear) continue;
        comparable++;
        if (bendsOf(p) <= bendsOf(old)) notWorse++;
      }
    }
    expect(comparable).toBeGreaterThan(100);
    expect(notWorse / comparable).toBeGreaterThanOrEqual(0.95);
  });

  it("routes 300 nodes and 400 connectors well inside a generous time budget", () => {
    const doc = randomScene(99, 300, 400);
    expect(Object.keys(doc.nodes).length).toBe(300);
    const started = performance.now();
    const routes = routeEdges(doc);
    const elapsed = performance.now() - started;
    expect(routes.size).toBe(Object.keys(doc.edges).length);
    for (const geometry of routes.values()) expect(isOrthogonal(geometry.points)).toBe(true);
    // The goal is ~150 ms on a laptop; the bound only has to catch accidental quadratic blow-ups.
    expect(elapsed).toBeLessThan(2500);
  });
});

/* ------------------------------------------------------------- the router */

describe("RoutingScene", () => {
  const scene = (boxes: Rect[]) =>
    new RoutingScene(boxes.map((r, i) => ({ id: `b${i}`, box: r, container: false, header: 0 })));

  it("returns a minimal polyline between two ports in open space", () => {
    const result = scene([]).route(
      { point: { x: 0, y: 0 }, normal: { x: 1, y: 0 }, depth: 0, stub: 20 },
      { point: { x: 200, y: 100 }, normal: { x: -1, y: 0 }, depth: 0, stub: 20 },
    );
    expect(result.crossing).toBe(0);
    expect(result.bends).toBe(2);
    expect(result.points[0]).toEqual({ x: 0, y: 0 });
    expect(result.points[result.points.length - 1]).toEqual({ x: 200, y: 100 });
    // The bar sits in the middle of the gap.
    expect(result.points[1].x).toBeCloseTo(100, 3);
  });

  it("centres a bar in the channel between two nodes", () => {
    const walls = [
      { x: 100, y: 0, w: 60, h: 400 },
      { x: 240, y: 0, w: 60, h: 400 },
    ];
    // Vertical corridor x 160..240; the route comes in at the top, goes down the corridor.
    const result = scene(walls).route(
      { point: { x: 100, y: -40 }, normal: { x: 0, y: -1 }, depth: 0, stub: 20 },
      { point: { x: 260, y: 440 }, normal: { x: 0, y: 1 }, depth: 0, stub: 20 },
    );
    const vertical = result.points.find((p, i, all) => i > 0 && p.x === all[i - 1].x && Math.abs(p.y - all[i - 1].y) > 200);
    expect(vertical).toBeDefined();
    expect(vertical!.x).toBeCloseTo(200, 0);
    expect(result.crossing).toBe(0);
  });

  it("never throws or returns diagonals for degenerate input", () => {
    const stack = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 0, h: 0 }];
    const ends = [
      [{ x: 100, y: 50 }, { x: 100, y: 50 }],
      [{ x: 0, y: 0 }, { x: 0.2, y: 0.2 }],
      [{ x: 50, y: 50 }, { x: 55, y: 50 }],
    ];
    for (const [from, to] of ends) {
      for (const normal of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        const result = scene(stack).route({ point: from, normal, depth: 0, stub: 20 }, { point: to, normal: { x: -normal.x, y: -normal.y }, depth: 0, stub: 20 });
        expect(isOrthogonal(result.points)).toBe(true);
        expect(result.points.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("EdgeGeometry contract", () => {
  it("keeps markers, labels and bounds consistent for live-routed connectors", () => {
    const doc = docOf(
      [box("A", 0, 100), box("X", 220, 100), box("B", 440, 100)],
      [link("e", "A", "B", { text: "label", startText: "1", endText: "*" })],
    );
    const g: EdgeGeometry = routeEdges(doc).get("e")!;
    expect(g.start).toEqual(g.points[0]);
    expect(g.end).toEqual(g.points[g.points.length - 1]);
    expect(Math.hypot(g.startDir.x, g.startDir.y)).toBeCloseTo(1, 5);
    expect(Math.hypot(g.endDir.x, g.endDir.y)).toBeCloseTo(1, 5);
    for (const p of g.points) {
      expect(p.x).toBeGreaterThanOrEqual(g.bounds.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(g.bounds.x + g.bounds.w + 1e-6);
    }
    for (const p of [g.labelPoint, g.startLabelPoint, g.endLabelPoint]) expect(Number.isFinite(p.x + p.y)).toBe(true);
    // Rounded corners: the drawable path has curve commands where the route bends.
    expect(g.path.some((cmd) => cmd[0] === "C")).toBe(true);
    expect(lengthOf(g.points)).toBeGreaterThan(320);
  });
});
