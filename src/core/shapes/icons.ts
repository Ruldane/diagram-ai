import { fitPath, parseSvgPath, type Path } from "../geometry/path";
import type { Color } from "../model/types";
import { ICON_DATA } from "./icon-data";
import type { PathPrim } from "./types";

const cache = new Map<string, Path[]>();

export const ICON_NAMES = Object.keys(ICON_DATA);
export const FALLBACK_ICON = "box";

export function hasIcon(name: string): boolean {
  return name in ICON_DATA;
}

function iconPaths(name: string): Path[] {
  let paths = cache.get(name);
  if (!paths) {
    paths = (ICON_DATA[name] ?? ICON_DATA[FALLBACK_ICON]).map(parseSvgPath);
    cache.set(name, paths);
  }
  return paths;
}

/** Stroked icon fitted into a `size × size` square at (x, y). */
export function iconPrims(name: string, x: number, y: number, size: number, color: Color, strokeWidth?: number): PathPrim[] {
  const width = strokeWidth ?? Math.min(2.25, Math.max(1.25, size / 13));
  return iconPaths(name).map((path) => ({
    kind: "path",
    d: fitPath(path, 24, 24, x, y, size, size),
    stroke: color,
    strokeWidth: width,
    round: true,
  }));
}
