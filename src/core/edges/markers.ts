import { ellipsePath, polyPath, transformPath, type Path } from "../geometry/path";
import type { Color, MarkerKind, Point } from "../model/types";
import type { PathPrim } from "../shapes/types";

export const MARKER_KINDS: MarkerKind[] = [
  "none",
  "arrow",
  "open-arrow",
  "triangle",
  "triangle-open",
  "diamond",
  "diamond-open",
  "circle",
  "circle-open",
  "bar",
  "cross",
  "crow-one",
  "crow-many",
  "crow-zero-one",
  "crow-one-many",
  "crow-zero-many",
];

export const MARKER_LABELS: Record<MarkerKind, string> = {
  none: "None",
  arrow: "Arrow",
  "open-arrow": "Open arrow",
  triangle: "Triangle",
  "triangle-open": "Hollow triangle (inheritance)",
  diamond: "Diamond (composition)",
  "diamond-open": "Hollow diamond (aggregation)",
  circle: "Dot",
  "circle-open": "Circle",
  bar: "Bar",
  cross: "Cross",
  "crow-one": "One (ER)",
  "crow-many": "Many (ER)",
  "crow-zero-one": "Zero or one (ER)",
  "crow-one-many": "One or many (ER)",
  "crow-zero-many": "Zero or many (ER)",
};

type Fill = "stroke" | "background" | "none";

interface MarkerPart {
  d: Path;
  fill: Fill;
}

interface MarkerDef {
  /** Authored with the tip at (0, 0) and the line arriving from −x. */
  parts: MarkerPart[];
  /** How far the line is pulled back so it stops at the marker's base. */
  inset: number;
}

const open = (points: [number, number][]): Path => polyPath(points, false);
const bar = (x: number, half = 6): Path => open([[x, -half], [x, half]]);
const foot: Path = [...open([[-12, 0], [0, -6]]), ...open([[-12, 0], [0, 6]])];
const ring = (cx: number, r: number): Path => ellipsePath(cx, 0, r, r);

const DEFS: Record<Exclude<MarkerKind, "none">, MarkerDef> = {
  arrow: { parts: [{ d: polyPath([[0, 0], [-10, 4.2], [-10, -4.2]]), fill: "stroke" }], inset: 8 },
  "open-arrow": { parts: [{ d: open([[-10, 4.6], [0, 0], [-10, -4.6]]), fill: "none" }], inset: 0 },
  triangle: { parts: [{ d: polyPath([[0, 0], [-12, 6], [-12, -6]]), fill: "stroke" }], inset: 11 },
  "triangle-open": { parts: [{ d: polyPath([[0, 0], [-12, 6], [-12, -6]]), fill: "background" }], inset: 12 },
  diamond: { parts: [{ d: polyPath([[0, 0], [-8, 4.8], [-16, 0], [-8, -4.8]]), fill: "stroke" }], inset: 15 },
  "diamond-open": { parts: [{ d: polyPath([[0, 0], [-8, 4.8], [-16, 0], [-8, -4.8]]), fill: "background" }], inset: 16 },
  circle: { parts: [{ d: ring(-4.5, 4.5), fill: "stroke" }], inset: 8 },
  "circle-open": { parts: [{ d: ring(-4.5, 4.5), fill: "background" }], inset: 9 },
  bar: { parts: [{ d: bar(-1), fill: "none" }], inset: 0 },
  cross: { parts: [{ d: [...open([[-12, -5], [-4, 5]]), ...open([[-12, 5], [-4, -5]])], fill: "none" }], inset: 0 },
  "crow-one": { parts: [{ d: [...bar(-7), ...bar(-12)], fill: "none" }], inset: 0 },
  "crow-many": { parts: [{ d: foot, fill: "none" }], inset: 0 },
  "crow-zero-one": { parts: [{ d: bar(-7), fill: "none" }, { d: ring(-16, 4), fill: "background" }], inset: 0 },
  "crow-one-many": { parts: [{ d: [...foot, ...bar(-15)], fill: "none" }], inset: 0 },
  "crow-zero-many": { parts: [{ d: foot, fill: "none" }, { d: ring(-17, 4), fill: "background" }], inset: 0 },
};

/** Scale markers gently with the line weight so thick lines keep readable heads. */
export function markerScale(strokeWidth: number): number {
  return 0.85 + Math.max(0, strokeWidth - 1) * 0.3;
}

export function markerInset(kind: MarkerKind, strokeWidth: number): number {
  return kind === "none" ? 0 : DEFS[kind].inset * markerScale(strokeWidth);
}

/**
 * Marker primitives placed with their tip at `tip`, pointing along `direction`
 * (unit vector of travel towards the tip).
 */
export function markerPrims(
  kind: MarkerKind,
  tip: Point,
  direction: Point,
  stroke: Color,
  strokeWidth: number,
  background: Color,
): PathPrim[] {
  if (kind === "none") return [];
  const k = markerScale(strokeWidth);
  const { x: dx, y: dy } = direction;
  const matrix: [number, number, number, number, number, number] = [dx * k, dy * k, -dy * k, dx * k, tip.x, tip.y];
  return DEFS[kind].parts.map((part) => ({
    kind: "path",
    d: transformPath(part.d, matrix),
    fill: part.fill === "stroke" ? stroke : part.fill === "background" ? (background === "none" ? "#ffffff" : background) : undefined,
    stroke,
    strokeWidth,
    round: true,
  }));
}
