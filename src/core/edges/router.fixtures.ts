/**
 * Scenes and reference implementations shared by the router tests and
 * `scripts/routing-gallery.ts`. Not part of the product.
 */
import { createDoc } from "../model/defaults";
import { applyPatch } from "../model/patch";
import type { DEdge, DiagramDoc, DNode, Id, Point, Rect } from "../model/types";

/* ------------------------------------------------------------------ builders */

export const box = (id: string, x: number, y: number, extra: Partial<DNode> = {}): DNode => ({
  id,
  shape: "basic/rect",
  x,
  y,
  w: 120,
  h: 60,
  z: 1,
  text: id,
  ...extra,
});

export const link = (id: string, from: string, to: string, extra: Partial<DEdge> = {}): DEdge => ({
  id,
  from: { node: from },
  to: { node: to },
  routing: "orthogonal",
  ...extra,
});

export const group = (id: string, x: number, y: number, w: number, h: number, extra: Partial<DNode> = {}): DNode => ({
  id,
  shape: "basic/group",
  x,
  y,
  w,
  h,
  z: 0,
  text: id,
  ...extra,
});

export function docOf(nodes: DNode[], edges: DEdge[] = []): DiagramDoc {
  return applyPatch(createDoc(), { nodes: { set: nodes }, edges: { set: edges } }).doc;
}

/* -------------------------------------------------------------- seeded noise */

/** mulberry32: small, fast, good enough for test scenes. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Boxes on a jittered grid (never overlapping) joined by random orthogonal connectors. */
export function randomScene(seed: number, boxes: number, edges: number): DiagramDoc {
  const random = seeded(seed);
  const columns = Math.ceil(Math.sqrt(boxes * 1.4));
  const nodes: DNode[] = [];
  for (let i = 0; nodes.length < boxes; i++) {
    const w = 60 + Math.floor(random() * 80);
    const h = 36 + Math.floor(random() * 44);
    const cell = i % (columns * columns);
    const col = cell % columns;
    const row = Math.floor(cell / columns);
    const jitterX = Math.floor(random() * (220 - w - 30));
    const jitterY = Math.floor(random() * (150 - h - 30));
    if (random() < 0.12) continue;
    nodes.push(box(`n${nodes.length}`, col * 220 + jitterX + 15, row * 150 + jitterY + 15, { w, h }));
  }
  const links: DEdge[] = [];
  const seen = new Set<string>();
  for (let guard = 0; links.length < edges && guard < edges * 20; guard++) {
    const a = Math.floor(random() * nodes.length);
    const b = Math.floor(random() * nodes.length);
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (a === b || seen.has(key)) continue;
    seen.add(key);
    links.push(link(`e${links.length}`, nodes[a].id, nodes[b].id));
  }
  return docOf(nodes, links);
}

/**
 * Boxes in ranks (as a layered layout leaves them) with connectors mostly
 * between neighbouring ranks and a few that skip ranks.
 */
export function layeredScene(seed: number, boxes: number, edges: number, perRank = 12): DiagramDoc {
  const random = seeded(seed);
  const ranks = Math.ceil(boxes / perRank);
  const nodes: DNode[] = [];
  for (let i = 0; i < boxes; i++) {
    const rank = Math.floor(i / perRank);
    const index = i % perRank;
    nodes.push(box(`n${i}`, index * 170 + Math.floor(random() * 20), rank * 130 + Math.floor(random() * 10), { w: 100 + Math.floor(random() * 30) }));
  }
  const links: DEdge[] = [];
  for (let i = 0; i < edges; i++) {
    const from = Math.floor(random() * boxes);
    const rank = Math.floor(from / perRank);
    const hop = random() < 0.12 ? 2 + Math.floor(random() * 3) : 1;
    const targetRank = Math.min(ranks - 1, rank + hop);
    const column = Math.max(0, Math.min(perRank - 1, (from % perRank) + Math.floor(random() * 7) - 3));
    const to = Math.min(boxes - 1, targetRank * perRank + column);
    if (to === from) continue;
    links.push(link(`e${links.length}`, nodes[from].id, nodes[to].id));
  }
  return docOf(nodes, links);
}

/* ---------------------------------------------------------- hand-made scenes */

export interface Scenario {
  name: string;
  title: string;
  doc: DiagramDoc;
}

export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  const add = (name: string, title: string, nodes: DNode[], edges: DEdge[]) => out.push({ name, title, doc: docOf(nodes, edges) });

  add(
    "wall",
    "A solid wall between two nodes: the route goes around its end",
    [
      box("A", 0, 190),
      box("B", 560, 190),
      box("w1", 250, 40, { w: 120, h: 110 }),
      box("w2", 250, 150, { w: 120, h: 110 }),
      box("w3", 250, 260, { w: 120, h: 110 }),
    ],
    [link("e1", "A", "B")],
  );

  add(
    "blocker",
    "A node in the straight path, a second connector crossing the same area",
    [box("A", 0, 100), box("B", 460, 100), box("X", 220, 100), box("C", 220, 300), box("D", 220, -100)],
    [link("e1", "A", "B"), link("e2", "C", "D")],
  );

  add(
    "narrow-gap",
    "A 30 px gap in a tall wall: the vertical connector runs down its middle, the horizontal one goes around",
    [
      box("A", 0, 100),
      box("B", 400, 100),
      box("L", 175, -20, { w: 60, h: 300 }),
      box("R", 265, -20, { w: 60, h: 300 }),
      box("up", 190, -150),
      box("down", 190, 330),
    ],
    [link("e1", "up", "down"), link("e2", "A", "B")],
  );

  add(
    "behind",
    "Target sits behind the source: leave sideways, wrap around instead of doubling back",
    [box("A", 300, 100), box("B", 0, 100), box("C", 300, 300), box("D", 0, 300)],
    [link("e1", "A", "B", { from: { node: "A", anchor: { x: 1, y: 0.5 } }, to: { node: "B", anchor: { x: 0, y: 0.5 } } }), link("e2", "C", "D"), link("e3", "A", "D")],
  );

  add(
    "containers",
    "Containers are crossed freely; siblings stay inside and avoid the title strip",
    [
      group("G1", 0, 0, 440, 320, { text: "Backend" }),
      box("api", 30, 60, { parent: "G1" }),
      box("auth", 290, 60, { parent: "G1" }),
      box("cache", 160, 120, { parent: "G1", w: 100, h: 50 }),
      box("db", 160, 230, { parent: "G1" }),
      group("G2", 560, 0, 260, 320, { text: "Clients" }),
      box("web", 620, 60, { parent: "G2" }),
      box("mobile", 620, 220, { parent: "G2" }),
      box("cdn", 250, 380),
    ],
    [
      link("e1", "api", "auth"),
      link("e2", "api", "db"),
      link("e3", "web", "api"),
      link("e4", "mobile", "db"),
      link("e5", "auth", "cdn"),
      link("e6", "web", "mobile"),
    ],
  );

  add(
    "hub",
    "Hub and spokes with obstacles scattered around",
    [
      box("hub", 300, 200),
      box("n1", 20, 20),
      box("n2", 300, -80),
      box("n3", 600, 20),
      box("n4", 640, 200),
      box("n5", 600, 420),
      box("n6", 300, 480),
      box("n7", 20, 420),
      box("n8", -20, 200),
      box("o1", 180, 110, { w: 70, h: 40 }),
      box("o2", 440, 330, { w: 70, h: 40 }),
    ],
    ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"].map((id, index) => link(`s${index}`, "hub", id)),
  );

  add(
    "channel",
    "Eight connectors squeeze through one corridor in a wall: they run side by side, not on top of each other",
    [
      ...[0, 1, 2, 3].map((i) => box(`l${i}`, 0, i * 90)),
      ...[0, 1, 2, 3].map((i) => box(`r${i}`, 620, i * 90)),
      box("wallTop", 280, -40, { w: 60, h: 140 }),
      box("wallBottom", 280, 200, { w: 60, h: 140 }),
    ],
    [0, 1, 2, 3].flatMap((i) => [link(`a${i}`, `l${i}`, `r${(i + 1) % 4}`), link(`b${i}`, `l${i}`, `r${(i + 2) % 4}`)]),
  );

  add(
    "anchors",
    "Fixed anchors are never moved, the route adapts around them",
    [box("A", 0, 140), box("B", 420, 140), box("X", 180, 120, { w: 80, h: 100 }), box("C", 200, 340)],
    [
      link("e1", "A", "B", { from: { node: "A", anchor: { x: 0.5, y: 0 } }, to: { node: "B", anchor: { x: 0.5, y: 0 } } }),
      link("e2", "A", "B", { from: { node: "A", anchor: { x: 0.5, y: 1 } }, to: { node: "B", anchor: { x: 0.5, y: 1 } } }),
      link("e3", "A", "C", { from: { node: "A", anchor: { x: 1, y: 0.8 } } }),
    ],
  );

  add(
    "loops",
    "Self loop, free ends and a straight connector among obstacles",
    [box("A", 0, 0), box("B", 300, 0), box("C", 150, 140)],
    [
      link("loop", "A", "A"),
      link("e1", "A", "B"),
      { id: "free", from: { node: "C" }, to: { point: { x: 500, y: 260 } }, routing: "orthogonal" },
      link("straight", "B", "C", { routing: "straight" }),
    ],
  );

  out.push({ name: "random-24", title: "24 boxes, 30 random connectors (seed 7)", doc: randomScene(7, 24, 30) });
  out.push({ name: "random-40", title: "40 boxes, 60 random connectors (seed 21)", doc: randomScene(21, 40, 60) });
  return out;
}

/* ---------------------------------------------------- reference implementations */

const segmentHitsRect = (a: Point, b: Point, r: Rect): boolean => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > r.x + 1 && minX < r.x + r.w - 1 && maxY > r.y + 1 && minY < r.y + r.h - 1;
};

function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const forward = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
    if (Math.abs(cross) < 0.5 && forward) out.splice(i, 1);
  }
  return out;
}

/**
 * The connector router this one replaced: nine hand-written candidates scored
 * against the two end nodes only. Kept as the baseline the new router is
 * measured against (bend counts, gallery "before" pictures).
 */
export function legacyRoute(p0: Point, n0: Point, p1: Point, n1: Point, obstacles: Rect[]): Point[] {
  const STUB = 20;
  const facing = n0.x === -n1.x && n0.y === -n1.y;
  const gap = (p1.x - p0.x) * n0.x + (p1.y - p0.y) * n0.y;
  const stub = facing && gap > 0 ? Math.min(STUB, gap / 2) : STUB;
  const s = { x: p0.x + n0.x * stub, y: p0.y + n0.y * stub };
  const e = { x: p1.x + n1.x * stub, y: p1.y + n1.y * stub };
  const mx = (s.x + e.x) / 2;
  const my = (s.y + e.y) / 2;
  const candidates: Point[][] = [
    [s, e],
    [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e],
    [s, { x: s.x, y: my }, { x: e.x, y: my }, e],
    [s, { x: e.x, y: s.y }, e],
    [s, { x: s.x, y: e.y }, e],
  ];
  if (obstacles.length) {
    const minX = Math.min(...obstacles.map((r) => r.x)) - STUB;
    const minY = Math.min(...obstacles.map((r) => r.y)) - STUB;
    const maxX = Math.max(...obstacles.map((r) => r.x + r.w)) + STUB;
    const maxY = Math.max(...obstacles.map((r) => r.y + r.h)) + STUB;
    candidates.push(
      [s, { x: s.x, y: minY }, { x: e.x, y: minY }, e],
      [s, { x: s.x, y: maxY }, { x: e.x, y: maxY }, e],
      [s, { x: minX, y: s.y }, { x: minX, y: e.y }, e],
      [s, { x: maxX, y: s.y }, { x: maxX, y: e.y }, e],
    );
  }
  const cost = (points: Point[]): number => {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return Infinity;
      total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const o of obstacles) if (segmentHitsRect(a, b, o)) total += 1500;
      if (i > 0) {
        const p = points[i - 1];
        const reversed = (a.x - p.x) * (b.x - a.x) + (a.y - p.y) * (b.y - a.y) < 0;
        total += reversed ? 3000 : 40;
      }
    }
    return total;
  };
  let best: Point[] = [p0, s, e, p1];
  let bestCost = Infinity;
  for (const candidate of candidates) {
    const points = simplify([p0, ...candidate, p1]);
    const c = cost(points);
    if (c < bestCost) {
      best = points;
      bestCost = c;
    }
  }
  return best;
}

/** True when `route` runs through the interior of `rect` (a hair of tolerance for borders). */
export function crossesRect(route: Point[], rect: Rect, from = 0, to = route.length - 1): boolean {
  for (let i = from; i < to; i++) {
    if (segmentHitsRect(route[i], route[i + 1], { x: rect.x + 0.5, y: rect.y + 0.5, w: rect.w - 1, h: rect.h - 1 })) return true;
  }
  return false;
}

/**
 * Brute-force oracle: is there any axis-aligned route from `from` to `to`
 * that keeps `margin` px away from every rectangle in `rects` (and out of
 * those in `bare`)? Breadth-first search on a lattice, so small scenes only.
 */
export function freeRouteExists(from: Point, to: Point, rects: Rect[], margin: number, step = 4, bare: Rect[] = []): boolean {
  const all = [from, to, ...[...rects, ...bare].flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }])];
  const minX = Math.min(...all.map((p) => p.x)) - 120;
  const minY = Math.min(...all.map((p) => p.y)) - 120;
  const maxX = Math.max(...all.map((p) => p.x)) + 120;
  const maxY = Math.max(...all.map((p) => p.y)) + 120;
  const cols = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxY - minY) / step) + 1;
  const blocked = new Uint8Array(cols * rows);
  const block = (r: Rect, by: number): void => {
    const c0 = Math.max(0, Math.floor((r.x - by - minX) / step));
    const c1 = Math.min(cols - 1, Math.ceil((r.x + r.w + by - minX) / step));
    const r0 = Math.max(0, Math.floor((r.y - by - minY) / step));
    const r1 = Math.min(rows - 1, Math.ceil((r.y + r.h + by - minY) / step));
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const px = minX + x * step;
        const py = minY + y * step;
        if (px > r.x - by && px < r.x + r.w + by && py > r.y - by && py < r.y + r.h + by) blocked[y * cols + x] = 1;
      }
    }
  };
  for (const r of rects) block(r, margin);
  // Rectangles the route may touch (the end nodes): walls with no margin.
  for (const r of bare) block(r, 0);
  const cell = (p: Point): number => Math.round((p.y - minY) / step) * cols + Math.round((p.x - minX) / step);
  const start = cell(from);
  const goal = cell(to);
  blocked[start] = 0;
  blocked[goal] = 0;
  const seen = new Uint8Array(cols * rows);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === goal) return true;
    const x = at % cols;
    const y = (at - x) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      if (seen[next] || blocked[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

export const idsOf = (doc: DiagramDoc): Id[] => Object.keys(doc.edges);
