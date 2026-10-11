import {
  add,
  center,
  clamp,
  dist,
  nodeMatrix,
  applyMatrix,
  normalize,
  rotatedBounds,
  scale,
  sub,
} from "../geometry/basics";
import {
  flattenPath,
  intersectSegmentWithPath,
  roundedPolyPath,
  transformPath,
  type Path,
} from "../geometry/path";
import { resolveEdgeStyle } from "../model/defaults";
import type { DEdge, DiagramDoc, DNode, EdgeEnd, Id, Point, Rect } from "../model/types";
import { containerInsets, getShape, shapeOutline } from "../shapes/registry";
import { markerInset } from "./markers";
import { nudge, RoutingScene, type RouteEnd, type RouteResult, type SceneBox } from "./router";

export type Side = "top" | "right" | "bottom" | "left";

const NORMAL: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Length of the straight run leaving a node before an orthogonal edge may turn. */
const STUB = 20;
const CORNER_RADIUS = 8;
const PORT_SPACING = 18;

export interface EdgeGeometry {
  /** Route vertices in world space, start → end, clipped to the shapes. */
  points: Point[];
  /** Drawable line, already pulled back to leave room for the markers. */
  path: Path;
  /** Marker tips. */
  start: Point;
  end: Point;
  /** Unit travel direction arriving at each tip (pointing into the node). */
  startDir: Point;
  endDir: Point;
  labelPoint: Point;
  startLabelPoint: Point;
  endLabelPoint: Point;
  bounds: Rect;
}

/* ------------------------------------------------------------ node helpers */

const outlineCache = new WeakMap<DNode, Path>();

/** Node outline in world space. Cached per node object (nodes are immutable). */
export function worldOutline(node: DNode): Path {
  let outline = outlineCache.get(node);
  if (!outline) {
    outline = transformPath(shapeOutline(node), nodeMatrix(node));
    outlineCache.set(node, outline);
  }
  return outline;
}

export const nodeBox = (node: DNode): Rect => rotatedBounds(node, node.rotation);

/** Where the segment `inside → outside` leaves the node. */
function exitPoint(node: DNode, inside: Point, outside: Point): Point {
  const hits = intersectSegmentWithPath(worldOutline(node), inside, outside);
  return hits.length ? hits[hits.length - 1] : inside;
}

/** Point on the node outline along one side, `offset` px from the side's middle. */
function sidePoint(node: DNode, side: Side, offset = 0): Point {
  const box = nodeBox(node);
  const c = center(box);
  const n = NORMAL[side];
  const span = n.x !== 0 ? box.h : box.w;
  const shift = clamp(offset, -span * 0.36, span * 0.36);
  const origin = { x: c.x + (n.y !== 0 ? shift : 0), y: c.y + (n.x !== 0 ? shift : 0) };
  const far = add(origin, scale(n, box.w + box.h));
  const hits = intersectSegmentWithPath(worldOutline(node), origin, far);
  if (hits.length) return hits[hits.length - 1];
  return { x: origin.x + (n.x * box.w) / 2, y: origin.y + (n.y * box.h) / 2 };
}

const EPS = 1e-3;

const anchorWorld = (node: DNode, anchor: Point): Point =>
  applyMatrix(nodeMatrix(node), { x: anchor.x * node.w, y: anchor.y * node.h });

/**
 * World position of a fixed anchor. Anchors on the box border are slid onto the
 * shape outline along the line of travel (`toward` is the next route point), so
 * a route computed against the bounding box still meets a diamond or ellipse squarely.
 */
function anchorPoint(node: DNode, anchor: Point, toward: Point): Point {
  const world = anchorWorld(node, anchor);
  const onBorder = anchor.x <= EPS || anchor.x >= 1 - EPS || anchor.y <= EPS || anchor.y >= 1 - EPS;
  if (!onBorder) return world;
  const outline = worldOutline(node);
  const box = nodeBox(node);
  const inward = normalize(sub(world, toward));
  if (inward.x !== 0 || inward.y !== 0) {
    const hits = intersectSegmentWithPath(outline, world, add(world, scale(inward, box.w + box.h)));
    if (hits.length) return hits[0];
  }
  const hits = intersectSegmentWithPath(outline, world, center(box));
  return hits.length ? hits[0] : world;
}

function anchorSide(anchor: Point, towards: Point, from: Point): Side {
  if (anchor.x <= EPS) return "left";
  if (anchor.x >= 1 - EPS) return "right";
  if (anchor.y <= EPS) return "top";
  if (anchor.y >= 1 - EPS) return "bottom";
  // Interior anchors (sequence lifelines) leave towards the other end.
  return towards.x >= from.x ? "right" : "left";
}

export type Flow = "vertical" | "horizontal";

/**
 * Facing sides for two boxes. When the boxes are clear of each other on both
 * axes (placed diagonally) the diagram's flow direction decides, so a tree laid
 * out top-down keeps top-to-bottom connectors however wide it gets; otherwise
 * the axis with the larger gap wins.
 */
function pickSides(a: Rect, b: Rect, flow?: Flow): [Side, Side] {
  const ca = center(a);
  const cb = center(b);
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  let horizontal: boolean;
  if (gapX > 0 && gapY > 0 && flow) horizontal = flow === "horizontal";
  else if (gapX > 0 || gapY > 0) horizontal = gapX >= gapY;
  else horizontal = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
  if (horizontal) return cb.x >= ca.x ? ["right", "left"] : ["left", "right"];
  return cb.y >= ca.y ? ["bottom", "top"] : ["top", "bottom"];
}

function sideTowards(box: Rect, point: Point): Side {
  const c = center(box);
  const dx = (point.x - c.x) / Math.max(box.w, 1);
  const dy = (point.y - c.y) / Math.max(box.h, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function directionTowards(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 };
  return { x: 0, y: dy >= 0 ? 1 : -1 };
}

const isFixed = (end: EdgeEnd): end is EdgeEnd & { anchor: Point } => typeof end.anchor === "object" && end.anchor !== null;

/* ----------------------------------------------------------------- curves */

function bezierPath(p0: Point, c0: Point, c1: Point, p1: Point): Path {
  return [
    ["M", p0.x, p0.y],
    ["C", c0.x, c0.y, c1.x, c1.y, p1.x, p1.y],
  ];
}

/** Smooth curve through all points (Catmull-Rom converted to cubic Béziers). */
function splinePath(points: Point[]): Path {
  const path: Path = [["M", points[0].x, points[0].y]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    path.push([
      "C",
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    ]);
  }
  return path;
}

/* ---------------------------------------------------------- measurements */

function pointAlong(polyline: Point[], distance: number): { point: Point; direction: Point } {
  let remaining = distance;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const length = dist(a, b);
    if (remaining <= length || i === polyline.length - 2) {
      const t = length === 0 ? 0 : clamp(remaining / length, 0, 1);
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, direction: normalize(sub(b, a)) };
    }
    remaining -= length;
  }
  return { point: polyline[0], direction: { x: 1, y: 0 } };
}

function polylineLength(polyline: Point[]): number {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) total += dist(polyline[i], polyline[i + 1]);
  return total;
}

/** Offsets an end label sideways so it does not sit on the line. */
function besideLine(point: Point, direction: Point, distance: number): Point {
  let normal = { x: -direction.y, y: direction.x };
  // Prefer above for horizontal runs and right for vertical ones.
  if (normal.y > 0.1 || (Math.abs(normal.y) <= 0.1 && normal.x < 0)) normal = scale(normal, -1);
  return add(point, scale(normal, distance));
}

/* ------------------------------------------------------------------ router */

export interface PortHint {
  side: Side;
  offset: number;
}

export interface RouteHints {
  from?: PortHint;
  to?: PortHint;
}

interface ResolvedEnd {
  point: Point;
  /** Outward direction of travel when leaving this end. */
  normal: Point;
  node?: DNode;
  /** Side of the node box the port is on, for ends the router is free to move. */
  side?: Side;
  /** How far the port sits inside the node's bounding box (diamond slopes, fanned ports). */
  depth: number;
}

/** How far a port sits inside `box`, measured along its outward normal. */
function depthInside(box: Rect, point: Point, normal: Point): number {
  let depth = 0;
  if (normal.x > 0) depth = box.x + box.w - point.x;
  else if (normal.x < 0) depth = point.x - box.x;
  else if (normal.y > 0) depth = box.y + box.h - point.y;
  else depth = point.y - box.y;
  return Math.max(0, depth);
}

/** Router-facing description of the two ends; ends that face each other share the gap between them. */
function routeEnds(a: ResolvedEnd, b: ResolvedEnd): [RouteEnd, RouteEnd] {
  let stub = STUB;
  if (a.normal.x === -b.normal.x && a.normal.y === -b.normal.y) {
    const gap = (b.point.x - a.point.x) * a.normal.x + (b.point.y - a.point.y) * a.normal.y;
    if (gap > 0) stub = clamp((gap - a.depth - b.depth) / 2, 0, STUB);
  }
  return [
    { point: a.point, normal: a.normal, depth: a.depth, stub, node: a.node?.id },
    { point: b.point, normal: b.normal, depth: b.depth, stub, node: b.node?.id },
  ];
}

function finish(points: Point[], path: Path, curved: boolean, edge: DEdge, tangents?: { start: Point; end: Point }): EdgeGeometry {
  const style = resolveEdgeStyle(edge.style);
  const start = points[0];
  const end = points[points.length - 1];
  const startDir = tangents?.start ?? normalize(sub(start, points[1] ?? start));
  const endDir = tangents?.end ?? normalize(sub(end, points[points.length - 2] ?? end));

  // Pull the line back so it stops at the base of each marker.
  const startInset = markerInset(style.startMarker, style.strokeWidth);
  const endInset = markerInset(style.endMarker, style.strokeWidth);
  let drawPath = path;
  if (startInset || endInset) {
    const first = path[0];
    const last = path[path.length - 1];
    const roomStart = dist(start, points[1] ?? start) > startInset + 2;
    const roomEnd = dist(end, points[points.length - 2] ?? end) > endInset + 2;
    drawPath = [...path];
    if (startInset && roomStart && first[0] === "M") {
      drawPath[0] = ["M", start.x - startDir.x * startInset, start.y - startDir.y * startInset];
    }
    if (endInset && roomEnd) {
      const ex = end.x - endDir.x * endInset;
      const ey = end.y - endDir.y * endInset;
      if (last[0] === "L") drawPath[drawPath.length - 1] = ["L", ex, ey];
      else if (last[0] === "C") drawPath[drawPath.length - 1] = ["C", last[1], last[2], last[3], last[4], ex, ey];
    }
  }

  const flat = curved ? (flattenPath(path, 16)[0]?.points ?? points) : points;
  const total = polylineLength(flat);
  const mid = pointAlong(flat, total / 2);
  const near = Math.min(26, total * 0.25);
  const startRef = pointAlong(flat, near);
  const endRef = pointAlong(flat, total - near);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    points: flat,
    path: drawPath,
    start,
    end,
    startDir,
    endDir,
    labelPoint: mid.point,
    startLabelPoint: besideLine(startRef.point, startRef.direction, 12),
    endLabelPoint: besideLine(endRef.point, endRef.direction, 12),
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

function selfLoop(node: DNode, edge: DEdge): EdgeGeometry {
  const box = nodeBox(node);
  const out = 26;
  const p0 = sidePoint(node, "right", -box.h * 0.18);
  const p1 = sidePoint(node, "top", box.w * 0.22);
  const points = [
    p0,
    { x: box.x + box.w + out, y: p0.y },
    { x: box.x + box.w + out, y: box.y - out },
    { x: p1.x, y: box.y - out },
    p1,
  ];
  return finish(points, roundedPolyPath(points, CORNER_RADIUS, false), false, edge);
}

/** One routing pass: the scene shared by all connectors and the budget for trying other ports. */
interface RoutePass {
  scene: RoutingScene;
  /** Alternative port combinations the pass may still evaluate (keeps a pass bounded and deterministic). */
  alternatives: number;
}

const SIDES: Side[] = ["top", "right", "bottom", "left"];
/** What a connector must save, per end moved off the side the layout rule chose, before another port is taken. */
const PORT_SWITCH = 30;
const ALTERNATIVE_BUDGET = 160;

function sceneBoxes(nodes: Record<Id, DNode>): SceneBox[] {
  return Object.values(nodes).map((node) => {
    const def = getShape(node.shape);
    return {
      id: node.id,
      box: nodeBox(node),
      container: Boolean(def.container),
      header: def.container ? containerInsets(def).header : 0,
      parent: node.parent,
    };
  });
}

/** An orthogonal route between two resolved ends, trying other sides when the preferred ones are blocked. */
function routeOrthogonal(start: ResolvedEnd, end: ResolvedEnd, pass: RoutePass): Point[] {
  const attempt = (a: ResolvedEnd, b: ResolvedEnd): RouteResult => pass.scene.route(...routeEnds(a, b));
  let best = attempt(start, end);
  // Other ports are only worth a look when the preferred ones are blocked or cost a detour.
  const settled = best.crossing === 0 && best.bends <= 2;
  if (settled || pass.alternatives <= 0) return best.points;

  const alternatives = (r: ResolvedEnd): (ResolvedEnd | undefined)[] => {
    const node = r.node;
    if (!node || !r.side) return [undefined];
    return [undefined, ...SIDES.filter((side) => side !== r.side).map((side) => portOn(node, side))];
  };
  // Every combination with the least it could possibly cost (the Manhattan distance between its stubs), cheapest first.
  const options: { a?: ResolvedEnd; b?: ResolvedEnd; bound: number }[] = [];
  for (const a of alternatives(start)) {
    for (const b of alternatives(end)) {
      if (!a && !b) continue;
      const [from, to] = routeEnds(a ?? start, b ?? end);
      const sx = from.point.x + from.normal.x * (from.depth + from.stub);
      const sy = from.point.y + from.normal.y * (from.depth + from.stub);
      const ex = to.point.x + to.normal.x * (to.depth + to.stub);
      const ey = to.point.y + to.normal.y * (to.depth + to.stub);
      options.push({ a, b, bound: Math.abs(sx - ex) + Math.abs(sy - ey) + PORT_SWITCH * ((a ? 1 : 0) + (b ? 1 : 0)) });
    }
  }
  options.sort((p, q) => p.bound - q.bound);

  // Sharing a channel is not a reason to change sides: the nudging pass spreads such connectors.
  let bestTotal = best.cost - best.shared;
  for (const option of options) {
    if (option.bound >= bestTotal - 1 || pass.alternatives-- <= 0) break;
    const result = attempt(option.a ?? start, option.b ?? end);
    const total = result.cost - result.shared + PORT_SWITCH * ((option.a ? 1 : 0) + (option.b ? 1 : 0));
    if (total < bestTotal - 1) {
      best = result;
      bestTotal = total;
    }
  }
  return best.points;
}

function portOn(node: DNode, side: Side): ResolvedEnd {
  const point = sidePoint(node, side, 0);
  const normal = NORMAL[side];
  return { point, normal, node, side, depth: depthInside(nodeBox(node), point, normal) };
}

type Planned = { geometry: EdgeGeometry } | { points: Point[] };

const finishOrthogonal = (points: Point[], edge: DEdge): EdgeGeometry => finish(points, roundedPolyPath(points, CORNER_RADIUS, false), false, edge);

/** Everything about one connector except the orthogonal routes, which are returned as raw polylines. */
function planEdge(edge: DEdge, nodes: Record<Id, DNode>, hints: RouteHints, flow: Flow | undefined, pass: RoutePass | undefined): Planned {
  const a = edge.from.node ? nodes[edge.from.node] : undefined;
  const b = edge.to.node ? nodes[edge.to.node] : undefined;
  const waypoints = edge.waypoints ?? [];

  if (a && a === b && !waypoints.length) return { geometry: selfLoop(a, edge) };

  const rawPoint = (end: EdgeEnd, node: DNode | undefined): Point => {
    if (!node) return end.point ?? { x: 0, y: 0 };
    return isFixed(end) ? anchorWorld(node, end.anchor) : center(nodeBox(node));
  };
  const rawFrom = rawPoint(edge.from, a);
  const rawTo = rawPoint(edge.to, b);
  const fromRef = a && isFixed(edge.from) ? anchorPoint(a, edge.from.anchor, waypoints[0] ?? rawTo) : rawFrom;
  const toRef = b && isFixed(edge.to) ? anchorPoint(b, edge.to.anchor, waypoints[waypoints.length - 1] ?? rawFrom) : rawTo;

  // Straight lines and any route with explicit bend points: clip the polyline to the shapes.
  if (edge.routing === "straight" || waypoints.length) {
    const points = [fromRef, ...waypoints, toRef];
    if (a && !isFixed(edge.from)) points[0] = exitPoint(a, fromRef, points[1]);
    if (b && !isFixed(edge.to)) points[points.length - 1] = exitPoint(b, toRef, points[points.length - 2]);
    if (edge.routing === "curved" && points.length > 2) return { geometry: finish(points, splinePath(points), true, edge) };
    const radius = edge.routing === "orthogonal" ? CORNER_RADIUS : 0;
    return { geometry: finish(points, roundedPolyPath(points, radius, false), false, edge) };
  }

  const resolve = (end: EdgeEnd, node: DNode | undefined, other: Point, otherBox: Rect | undefined, hint?: PortHint): ResolvedEnd => {
    if (!node) {
      const point = end.point ?? { x: 0, y: 0 };
      return { point, normal: directionTowards(point, other), depth: 0 };
    }
    const box = nodeBox(node);
    if (isFixed(end)) {
      const raw = anchorWorld(node, end.anchor);
      const normal = NORMAL[anchorSide(end.anchor, other, raw)];
      const point = anchorPoint(node, end.anchor, add(raw, normal));
      const { x, y } = end.anchor;
      const onBorder = x <= EPS || x >= 1 - EPS || y <= EPS || y >= 1 - EPS;
      return { point, normal, node, depth: onBorder ? depthInside(box, point, normal) : 0 };
    }
    const side = hint?.side ?? (otherBox ? pickSides(box, otherBox, flow)[0] : sideTowards(box, other));
    const point = sidePoint(node, side, hint?.offset ?? 0);
    const normal = NORMAL[side];
    return { point, normal, node, side, depth: depthInside(box, point, normal) };
  };

  const start = resolve(edge.from, a, toRef, b ? nodeBox(b) : undefined, hints.from);
  const end = resolve(edge.to, b, fromRef, a ? nodeBox(a) : undefined, hints.to);

  if (edge.routing === "curved") {
    const reach = clamp(dist(start.point, end.point) * 0.45, 24, 160);
    const c0 = add(start.point, scale(start.normal, reach));
    const c1 = add(end.point, scale(end.normal, reach));
    return {
      geometry: finish([start.point, end.point], bezierPath(start.point, c0, c1, end.point), true, edge, {
        start: scale(start.normal, -1),
        end: scale(end.normal, -1),
      }),
    };
  }

  const scene = pass ?? { scene: new RoutingScene(sceneBoxes(nodes)), alternatives: ALTERNATIVE_BUDGET };
  return { points: routeOrthogonal(start, end, scene) };
}

/** Computes the geometry of a single edge, avoiding every other node in `nodes`. */
export function routeEdge(edge: DEdge, nodes: Record<Id, DNode>, hints: RouteHints = {}, flow?: Flow): EdgeGeometry {
  const planned = planEdge(edge, nodes, hints, flow, undefined);
  return "geometry" in planned ? planned.geometry : finishOrthogonal(planned.points, edge);
}

/**
 * Routes every edge of a document. Edges sharing a node side are fanned out
 * along that side instead of stacking on its midpoint; orthogonal edges
 * without stored bend points are routed around every other node, one after
 * the other, each steering clear of the channels the earlier ones took.
 */
export function routeEdges(doc: Pick<DiagramDoc, "nodes" | "edges"> & { settings?: Pick<DiagramDoc["settings"], "layout"> }): Map<Id, EdgeGeometry> {
  const { nodes, edges } = doc;
  const direction = doc.settings?.layout.direction;
  const flow: Flow | undefined = direction ? (direction === "down" || direction === "up" ? "vertical" : "horizontal") : undefined;
  const hints = new Map<Id, RouteHints>();
  const slots = new Map<string, { edge: Id; end: "from" | "to"; order: number; span: number }[]>();

  // Ports that stored routes and fixed anchors already occupy: live connectors keep clear of them.
  const occupied = new Map<string, number[]>();
  for (const edge of Object.values(edges)) {
    if (edge.routing === "straight") continue;
    for (const end of [edge.from, edge.to]) {
      const node = end.node ? nodes[end.node] : undefined;
      if (!node || !isFixed(end)) continue;
      const { x, y } = end.anchor;
      const side = x <= EPS ? "left" : x >= 1 - EPS ? "right" : y <= EPS ? "top" : y >= 1 - EPS ? "bottom" : undefined;
      if (!side) continue;
      const box = nodeBox(node);
      const key = `${node.id}:${side}`;
      const list = occupied.get(key) ?? [];
      list.push(side === "top" || side === "bottom" ? (x - 0.5) * box.w : (y - 0.5) * box.h);
      occupied.set(key, list);
    }
  }

  for (const edge of Object.values(edges)) {
    if (edge.routing === "straight" || edge.waypoints?.length) continue;
    const a = edge.from.node ? nodes[edge.from.node] : undefined;
    const b = edge.to.node ? nodes[edge.to.node] : undefined;
    if (!a && !b) continue;
    if (a && a === b) continue;
    const boxA = a ? nodeBox(a) : undefined;
    const boxB = b ? nodeBox(b) : undefined;
    const pointA = boxA ? center(boxA) : (edge.from.point ?? { x: 0, y: 0 });
    const pointB = boxB ? center(boxB) : (edge.to.point ?? { x: 0, y: 0 });
    const autoFrom = a && !isFixed(edge.from);
    const autoTo = b && !isFixed(edge.to);
    let sideFrom: Side | undefined;
    let sideTo: Side | undefined;
    if (boxA && boxB) [sideFrom, sideTo] = pickSides(boxA, boxB, flow);
    else if (boxA) sideFrom = sideTowards(boxA, pointB);
    else if (boxB) sideTo = sideTowards(boxB, pointA);

    const register = (node: DNode, box: Rect, side: Side, end: "from" | "to", other: Point) => {
      const horizontalSide = side === "top" || side === "bottom";
      const key = `${node.id}:${side}`;
      const list = slots.get(key) ?? [];
      list.push({ edge: edge.id, end, order: horizontalSide ? other.x : other.y, span: horizontalSide ? box.w : box.h });
      slots.set(key, list);
      const hint = hints.get(edge.id) ?? {};
      hint[end] = { side, offset: 0 };
      hints.set(edge.id, hint);
    };
    if (autoFrom && boxA && sideFrom) register(a, boxA, sideFrom, "from", pointB);
    if (autoTo && boxB && sideTo) register(b, boxB, sideTo, "to", pointA);
  }

  for (const [key, list] of slots) {
    const taken = occupied.get(key) ?? [];
    if (list.length < 2 && !taken.length) continue;
    list.sort((p, q) => p.order - q.order || (p.edge < q.edge ? -1 : 1));
    const span = list[0].span;
    const spacing = Math.min(PORT_SPACING, (span * 0.6) / Math.max(1, list.length - 1 + taken.length));
    let offsets = list.map((_, index) => (index - (list.length - 1) / 2) * spacing);
    if (taken.length) {
      // Candidate slots by distance from the middle of the side, skipping those too close to a stored port.
      const free: number[] = [];
      const reach = span * 0.36;
      for (let k = 0; free.length < list.length && k * spacing <= reach * 2; k++) {
        const offset = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * spacing;
        if (Math.abs(offset) <= reach && taken.every((t) => Math.abs(t - offset) >= spacing * 0.9)) free.push(offset);
      }
      if (free.length === list.length) offsets = free.sort((p, q) => p - q);
    }
    list.forEach((slot, index) => {
      const hint = hints.get(slot.edge)?.[slot.end];
      if (hint) hint.offset = offsets[index];
    });
  }

  const all = Object.values(edges);
  const pass: RoutePass = { scene: new RoutingScene(sceneBoxes(nodes)), alternatives: ALTERNATIVE_BUDGET };
  const done = new Map<Id, EdgeGeometry>();
  const live: { edge: DEdge; weight: number }[] = [];
  const routed: { edge: DEdge; points: Point[] }[] = [];

  // Straight lines, curves, stored routes and loops are fixed points of the picture: they go first,
  // and the channels of the orthogonal ones are what the live-routed connectors steer around.
  for (const edge of all) {
    const selfLoop = Boolean(edge.from.node) && edge.from.node === edge.to.node;
    if (edge.routing === "orthogonal" && !edge.waypoints?.length && !selfLoop) {
      const a = edge.from.node ? nodes[edge.from.node] : undefined;
      const b = edge.to.node ? nodes[edge.to.node] : undefined;
      const pa = a ? center(nodeBox(a)) : (edge.from.point ?? { x: 0, y: 0 });
      const pb = b ? center(nodeBox(b)) : (edge.to.point ?? { x: 0, y: 0 });
      live.push({ edge, weight: Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) });
      continue;
    }
    const planned = planEdge(edge, nodes, hints.get(edge.id) ?? {}, flow, pass);
    if ("points" in planned) {
      // Both ends name the same node id that does not exist: free ends, routed like any other.
      pass.scene.routed.add(planned.points);
      routed.push({ edge, points: planned.points });
      continue;
    }
    done.set(edge.id, planned.geometry);
    if (edge.routing === "orthogonal") pass.scene.routed.add(planned.geometry.points);
  }

  // Short connectors first: they have the fewest options, and long ones can go around them.
  live.sort((p, q) => p.weight - q.weight || (p.edge.id < q.edge.id ? -1 : 1));
  for (const { edge } of live) {
    const planned = planEdge(edge, nodes, hints.get(edge.id) ?? {}, flow, pass);
    if ("geometry" in planned) {
      done.set(edge.id, planned.geometry);
      continue;
    }
    pass.scene.routed.add(planned.points);
    routed.push({ edge, points: planned.points });
  }

  // Connectors that ended up in the same channel are fanned out a few px apart.
  const fixed = all.filter((edge) => edge.routing === "orthogonal" && done.has(edge.id)).map((edge) => done.get(edge.id)!.points);
  const spread = nudge(routed.map((r) => r.points), fixed, pass.scene);
  routed.forEach(({ edge }, index) => done.set(edge.id, finishOrthogonal(spread[index], edge)));

  const out = new Map<Id, EdgeGeometry>();
  for (const edge of all) {
    const geometry = done.get(edge.id);
    if (geometry) out.set(edge.id, geometry);
  }
  return out;
}

