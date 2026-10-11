/**
 * Filled / multi-colour artwork for shapes: brand logos and imported icon packs.
 * `icons.ts` draws monochrome strokes; this draws SVG path data with its own paint.
 */
import { parseSvgPath, transformPath, type Path } from "../geometry/path";
import type { Color, Size } from "../model/types";
import type { PathPrim } from "./types";

/** One painted path of an icon, in the icon's own viewBox units. */
export interface GlyphLayer {
  /** SVG path data. */
  d: string;
  /** `#rrggbb` or `"none"`. Omitted: black, unless there is a stroke. */
  fill?: Color;
  stroke?: Color;
  /** In viewBox units. */
  strokeWidth?: number;
  opacity?: number;
  /** Round line caps and joins. */
  round?: boolean;
  evenOdd?: boolean;
}

const BLACK = "#000000";
const PATH_CACHE_LIMIT = 4000;

/** Layers are immutable once a pack is loaded, so their parsed paths are cached per object. */
const layerPaths = new WeakMap<GlyphLayer, Path>();
const dataPaths = new Map<string, Path>();

function layerPath(layer: GlyphLayer): Path {
  let path = layerPaths.get(layer);
  if (!path) {
    path = parseSvgPath(layer.d);
    layerPaths.set(layer, path);
  }
  return path;
}

function dataPath(d: string): Path {
  let path = dataPaths.get(d);
  if (!path) {
    if (dataPaths.size >= PATH_CACHE_LIMIT) dataPaths.clear();
    path = parseSvgPath(d);
    dataPaths.set(d, path);
  }
  return path;
}

/** Single-colour filled glyph authored on a 24×24 grid (a simple-icons path), fitted into a `size × size` square. */
export function brandPrims(d: string, x: number, y: number, size: number, fill: Color): PathPrim[] {
  return [{ kind: "path", d: transformPath(dataPath(d), [size / 24, 0, 0, size / 24, x, y]), fill }];
}

/**
 * Layered artwork authored in a `view` box, scaled to fit `w × h` (aspect ratio
 * kept) and centred there. Stroke widths scale with the artwork.
 */
export function glyphPrims(layers: GlyphLayer[], view: Size, x: number, y: number, w: number, h: number): PathPrim[] {
  const scale = Math.min(w / view.w, h / view.h);
  const ox = x + (w - view.w * scale) / 2;
  const oy = y + (h - view.h * scale) / 2;
  return layers.map((layer): PathPrim => {
    const stroked = layer.stroke !== undefined && layer.stroke !== "none";
    return {
      kind: "path",
      d: transformPath(layerPath(layer), [scale, 0, 0, scale, ox, oy]),
      fill: layer.fill ?? (stroked ? "none" : BLACK),
      stroke: stroked ? layer.stroke : undefined,
      strokeWidth: stroked ? (layer.strokeWidth ?? 1) * scale : undefined,
      opacity: layer.opacity,
      round: layer.round || undefined,
      evenOdd: layer.evenOdd || undefined,
    };
  });
}
