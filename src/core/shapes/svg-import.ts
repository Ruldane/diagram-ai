/**
 * SVG → icon artwork, for imported icon packs.
 *
 * A small, tolerant reader that flattens an SVG file into painted paths in one
 * viewBox: no DOM, so it runs in the browser, the server and the CLI alike.
 * It covers what icon sets use (shapes, groups, transforms, `<use>`, inline
 * styles and simple `<style>` rules, solid and gradient fills) and says so in
 * `warnings` when something had to be dropped or simplified.
 */
import { IDENTITY, multiply, type Matrix } from "../geometry/basics";
import { parseSvgPath, pathBounds, pathToSvg, polyPath, transformPath, type Path } from "../geometry/path";
import { parseXml, type XmlElement } from "../io/xml";
import type { PackIcon, PackLayer } from "./packs";

export interface SvgArtwork {
  viewBox: PackIcon["viewBox"];
  layers: PackLayer[];
}

export interface SvgImportResult {
  /** `null` when nothing drawable was found. */
  artwork: SvgArtwork | null;
  warnings: string[];
}

/* ------------------------------------------------------------------ limits */

const MAX_ELEMENTS = 20_000;
const MAX_DEPTH = 48;
const MAX_USE_DEPTH = 8;
/** A shape covering at least this much of the viewBox, edge to edge, counts as a background. */
const BACKGROUND_COVERAGE = 0.97;
const KAPPA = 0.5522847498;

/* ----------------------------------------------------------------- colours */

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500",
  purple: "#800080", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", olive: "#808000", lime: "#00ff00",
  aqua: "#00ffff", cyan: "#00ffff", teal: "#008080", navy: "#000080", fuchsia: "#ff00ff", magenta: "#ff00ff", pink: "#ffc0cb",
  brown: "#a52a2a", gold: "#ffd700", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
  dimgray: "#696969", dimgrey: "#696969", whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", darkblue: "#00008b", lightblue: "#add8e6",
  skyblue: "#87ceeb", steelblue: "#4682b4", royalblue: "#4169e1", dodgerblue: "#1e90ff", crimson: "#dc143c", tomato: "#ff6347",
  coral: "#ff7f50", salmon: "#fa8072", darkgreen: "#006400", limegreen: "#32cd32", forestgreen: "#228b22", darkorange: "#ff8c00",
  indigo: "#4b0082", violet: "#ee82ee", turquoise: "#40e0d0", beige: "#f5f5dc", ivory: "#fffff0", khaki: "#f0e68c", tan: "#d2b48c",
  chocolate: "#d2691e", darkred: "#8b0000", orangered: "#ff4500", slategray: "#708090", slategrey: "#708090",
};

interface Rgba {
  /** `#rrggbb`, or `none`. */
  color: string;
  alpha: number;
}

const NONE: Rgba = { color: "none", alpha: 1 };

const hex2 = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

function channel(token: string): number {
  const value = parseFloat(token);
  return token.trim().endsWith("%") ? (value / 100) * 255 : value;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const at = (t: number): number => {
    const x = (t + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [at(hue + 1 / 3) * 255, at(hue) * 255, at(hue - 1 / 3) * 255];
}

/** CSS colour → `#rrggbb` + alpha. Returns null for anything that is not a plain colour. */
function parseColor(value: string, current: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent") return NONE;
  if (v === "currentcolor") return parseColor(current, "#000000");
  if (v[0] === "#") {
    const digits = v.slice(1);
    if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(digits)) return null;
    const full = digits.length <= 4 ? [...digits].map((c) => c + c).join("") : digits;
    const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1;
    return { color: `#${full.slice(0, 6)}`, alpha };
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts[3] === undefined ? 1 : Math.max(0, Math.min(1, parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])));
    if (fn[1].startsWith("rgb")) {
      const [r, g, b] = parts.slice(0, 3).map(channel);
      return [r, g, b].some(Number.isNaN) ? null : { color: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha };
    }
    const [r, g, b] = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    return [r, g, b].some(Number.isNaN) ? null : { color: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha };
  }
  const named = NAMED_COLORS[v];
  return named ? { color: named, alpha: 1 } : null;
}

/* ------------------------------------------------------------------ styles */

/** The inherited part of an element's style, still as written (paints are resolved per element). */
interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Product of the `opacity` of every ancestor (groups are flattened). */
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  evenOdd: boolean;
  round: boolean;
  color: string;
  hidden: boolean;
}

const ROOT_STYLE: Style = {
  fill: "#000000",
  stroke: "none",
  strokeWidth: 1,
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  evenOdd: false,
  round: false,
  color: "#000000",
  hidden: false,
};

const PRESENTATION = [
  "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "stroke-linecap", "stroke-linejoin",
  "color", "display", "visibility", "stop-color", "stroke-dasharray", "clip-path", "mask", "filter",
] as const;

type Declarations = Record<string, string>;

function parseDeclarations(css: string): Declarations {
  const out: Declarations = {};
  for (const part of css.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).replace(/!important/i, "").trim();
    if (name && value) out[name] = value;
  }
  return out;
}

interface Rules {
  tags: Map<string, Declarations>;
  classes: Map<string, Declarations>;
  ids: Map<string, Declarations>;
  /** Selectors this reader does not understand were present. */
  unsupported: boolean;
}

function addRule(map: Map<string, Declarations>, key: string, declarations: Declarations): void {
  map.set(key, { ...map.get(key), ...declarations });
}

/** Reads simple `tag`, `.class` and `#id` selectors (lists allowed); everything else is skipped. */
function parseStyleSheet(css: string, rules: Rules): void {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[a-z-]+[^{;]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, "");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = parseDeclarations(match[2]);
    for (const raw of match[1].split(",")) {
      const selector = raw.trim();
      if (/^\.[\w-]+$/.test(selector)) addRule(rules.classes, selector.slice(1), declarations);
      else if (/^#[\w-]+$/.test(selector)) addRule(rules.ids, selector.slice(1), declarations);
      else if (/^[a-z][\w-]*$/i.test(selector)) addRule(rules.tags, selector.toLowerCase(), declarations);
      else if (selector === "*") addRule(rules.tags, "*", declarations);
      else if (selector) rules.unsupported = true;
    }
  }
}

const localName = (name: string): string => {
  const colon = name.indexOf(":");
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
};

const hrefOf = (element: XmlElement): string | undefined => {
  const value = element.attrs.href ?? element.attrs["xlink:href"];
  return value?.startsWith("#") ? value.slice(1) : undefined;
};

/* -------------------------------------------------------------- transforms */

function parseTransform(value: string | undefined): Matrix {
  let result = IDENTITY;
  if (!value) return result;
  for (const match of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = (match[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let m: Matrix | null = null;
    switch (match[1]) {
      case "matrix":
        if (a.length >= 6) m = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case "translate":
        m = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        m = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const rad = ((a[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const cx = a[1] ?? 0;
        const cy = a[2] ?? 0;
        m = [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos];
        break;
      }
      case "skewX":
        m = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        m = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    // Listed left to right, applied right to left.
    if (m && m.every(Number.isFinite)) result = multiply(result, m);
  }
  return result;
}

/* ---------------------------------------------------------------- geometry */

function length(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return /pt\s*$/.test(value) ? n * (4 / 3) : n;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Path {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

/** Rectangle with independent horizontal and vertical corner radii (SVG `rx` / `ry`). */
function roundedRect(x: number, y: number, w: number, h: number, rxIn: number, ryIn: number): Path {
  const rx = Math.min(Math.max(0, rxIn), w / 2);
  const ry = Math.min(Math.max(0, ryIn), h / 2);
  if (!rx || !ry) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", x + rx, y],
    ["L", x + w - rx, y],
    ["C", x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry],
    ["L", x + w, y + h - ry],
    ["C", x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h],
    ["L", x + rx, y + h],
    ["C", x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry],
    ["L", x, y + ry],
    ["C", x, y + ry - ky, x + rx - kx, y, x + rx, y],
    ["Z"],
  ];
}

function points(value: string | undefined): [number, number][] {
  const numbers = (value ?? "").match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push([numbers[i], numbers[i + 1]]);
  return out;
}

/** Four corners on the bounds, nothing curved: a plain rectangle. */
function isRectangle(path: Path): boolean {
  const bounds = pathBounds(path);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return false;
  const corners = new Set<string>();
  const tolerance = Math.max(bounds.w, bounds.h) * 0.002;
  for (const cmd of path) {
    if (cmd[0] === "C") return false;
    if (cmd[0] === "Z") continue;
    const onX = Math.abs(cmd[1] - bounds.x) <= tolerance ? "l" : Math.abs(cmd[1] - (bounds.x + bounds.w)) <= tolerance ? "r" : "";
    const onY = Math.abs(cmd[2] - bounds.y) <= tolerance ? "t" : Math.abs(cmd[2] - (bounds.y + bounds.h)) <= tolerance ? "b" : "";
    if (!onX || !onY) return false;
    corners.add(onX + onY);
  }
  return corners.size === 4;
}

/* ---------------------------------------------------------------- importer */

interface Painted {
  path: Path;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  round: boolean;
  evenOdd: boolean;
}

interface Context {
  ids: Map<string, XmlElement>;
  rules: Rules;
  painted: Painted[];
  warnings: Set<string>;
  elements: number;
}

const SKIPPED_WITH_WARNING: Record<string, string> = {
  image: "Embedded images are not supported and were left out.",
  text: "Text is not supported and was left out (convert it to outlines in the source file).",
  tspan: "Text is not supported and was left out (convert it to outlines in the source file).",
  foreignobject: "Embedded HTML is not supported and was left out.",
};

/** Elements that never draw by themselves. */
const INERT = new Set([
  "defs", "symbol", "clippath", "mask", "pattern", "marker", "filter", "lineargradient", "radialgradient", "style", "title",
  "desc", "metadata", "script", "namedview", "stop", "view", "animate", "set",
]);

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);

function indexIds(element: XmlElement, ids: Map<string, XmlElement>, rules: Rules): void {
  const id = element.attrs.id;
  if (id && !ids.has(id)) ids.set(id, element);
  if (localName(element.name) === "style") parseStyleSheet(element.text, rules);
  for (const child of element.children) indexIds(child, ids, rules);
}

function declarationsOf(element: XmlElement, rules: Rules): Declarations {
  const out: Declarations = {};
  for (const property of PRESENTATION) {
    const value = element.attrs[property];
    if (value !== undefined) out[property] = value.trim();
  }
  Object.assign(out, rules.tags.get("*"), rules.tags.get(localName(element.name)));
  for (const name of element.attrs.class?.split(/\s+/) ?? []) Object.assign(out, rules.classes.get(name));
  if (element.attrs.id) Object.assign(out, rules.ids.get(element.attrs.id));
  if (element.attrs.style) Object.assign(out, parseDeclarations(element.attrs.style));
  return out;
}

function opacityOf(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, value.trim().endsWith("%") ? n / 100 : n));
}

function inherit(parent: Style, declarations: Declarations): Style {
  const style: Style = { ...parent };
  const pick = (name: string): string | undefined => {
    const value = declarations[name];
    return value === undefined || value === "inherit" ? undefined : value;
  };
  style.fill = pick("fill") ?? style.fill;
  style.stroke = pick("stroke") ?? style.stroke;
  style.color = pick("color") ?? style.color;
  const width = pick("stroke-width");
  if (width !== undefined) style.strokeWidth = length(width, style.strokeWidth);
  style.opacity = parent.opacity * opacityOf(declarations.opacity, 1);
  style.fillOpacity = opacityOf(pick("fill-opacity"), style.fillOpacity);
  style.strokeOpacity = opacityOf(pick("stroke-opacity"), style.strokeOpacity);
  const rule = pick("fill-rule");
  if (rule) style.evenOdd = rule === "evenodd";
  const cap = pick("stroke-linecap");
  const join = pick("stroke-linejoin");
  if (cap || join) style.round = cap === "round" || join === "round";
  const visibility = pick("visibility");
  if (visibility) style.hidden = visibility === "hidden" || visibility === "collapse";
  return style;
}

/** Mean colour of a gradient's stops (following `href` chains), or null when it has none. */
function gradientColor(gradient: XmlElement, ctx: Context, current: string, depth = 0): string | null {
  const stops = gradient.children.filter((child) => localName(child.name) === "stop");
  if (!stops.length) {
    const next = hrefOf(gradient);
    const target = next ? ctx.ids.get(next) : undefined;
    return target && depth < 4 ? gradientColor(target, ctx, current, depth + 1) : null;
  }
  const channels = [0, 0, 0];
  let count = 0;
  for (const stop of stops) {
    const declarations = declarationsOf(stop, ctx.rules);
    const parsed = parseColor(declarations["stop-color"] ?? "#000000", current);
    if (!parsed || parsed.color === "none") continue;
    channels[0] += parseInt(parsed.color.slice(1, 3), 16);
    channels[1] += parseInt(parsed.color.slice(3, 5), 16);
    channels[2] += parseInt(parsed.color.slice(5, 7), 16);
    count++;
  }
  if (!count) return null;
  return `#${hex2(channels[0] / count)}${hex2(channels[1] / count)}${hex2(channels[2] / count)}`;
}

/** Resolves a `fill` / `stroke` value to a colour, flattening gradients and noting what could not be kept. */
function resolvePaint(value: string, style: Style, ctx: Context): Rgba {
  const reference = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i.exec(value);
  if (reference) {
    const target = ctx.ids.get(reference[1]);
    const kind = target ? localName(target.name) : "";
    if (target && (kind === "lineargradient" || kind === "radialgradient")) {
      const flat = gradientColor(target, ctx, style.color);
      if (flat) {
        ctx.warnings.add("Gradients were flattened to a single colour.");
        return { color: flat, alpha: 1 };
      }
    }
    if (reference[2]) {
      const fallback = parseColor(reference[2], style.color);
      if (fallback) return fallback;
    }
    ctx.warnings.add(target && kind === "pattern" ? "Pattern fills are not supported and were left out." : "A paint reference could not be resolved and was left out.");
    return NONE;
  }
  const parsed = parseColor(value, style.color);
  if (parsed) return parsed;
  ctx.warnings.add(`Unsupported colour "${value.slice(0, 30)}" was left out.`);
  return NONE;
}

function shapePath(element: XmlElement, name: string): Path | null {
  const a = element.attrs;
  switch (name) {
    case "path":
      return a.d ? parseSvgPath(a.d) : null;
    case "rect": {
      const w = length(a.width);
      const h = length(a.height);
      if (w <= 0 || h <= 0) return null;
      const rx = a.rx !== undefined ? length(a.rx) : a.ry !== undefined ? length(a.ry) : 0;
      const ry = a.ry !== undefined ? length(a.ry) : rx;
      return roundedRect(length(a.x), length(a.y), w, h, rx, ry);
    }
    case "circle": {
      const r = length(a.r);
      return r > 0 ? ellipse(length(a.cx), length(a.cy), r, r) : null;
    }
    case "ellipse": {
      const rx = length(a.rx);
      const ry = length(a.ry);
      return rx > 0 && ry > 0 ? ellipse(length(a.cx), length(a.cy), rx, ry) : null;
    }
    case "line":
      return [["M", length(a.x1), length(a.y1)], ["L", length(a.x2), length(a.y2)]];
    case "polyline":
    case "polygon": {
      const list = points(a.points);
      return list.length >= 2 ? polyPath(list, name === "polygon") : null;
    }
    default:
      return null;
  }
}

function drawShape(element: XmlElement, name: string, matrix: Matrix, style: Style, declarations: Declarations, ctx: Context): void {
  if (style.hidden || style.opacity <= 0) return;
  const local = shapePath(element, name);
  if (!local || !local.length) return;

  if (declarations["clip-path"] && declarations["clip-path"] !== "none") ctx.warnings.add("Clipping paths are not supported and were ignored.");
  if (declarations.mask && declarations.mask !== "none") ctx.warnings.add("Masks are not supported and were ignored.");
  if (declarations.filter && declarations.filter !== "none") ctx.warnings.add("Filters (shadows, blurs) are not supported and were ignored.");
  if (declarations["stroke-dasharray"] && declarations["stroke-dasharray"] !== "none") ctx.warnings.add("Dashed strokes are drawn solid.");

  // Open shapes have no interior.
  const fillPaint = name === "line" ? NONE : resolvePaint(style.fill, style, ctx);
  const strokePaint = resolvePaint(style.stroke, style, ctx);
  const fillAlpha = fillPaint.color === "none" ? 0 : style.fillOpacity * fillPaint.alpha;
  const strokeAlpha = strokePaint.color === "none" ? 0 : style.strokeOpacity * strokePaint.alpha;
  const fillVisible = fillAlpha > 0.001;
  const strokeVisible = strokeAlpha > 0.001 && style.strokeWidth > 0;
  if (!fillVisible && !strokeVisible) return;

  const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
  ctx.painted.push({
    path: transformPath(local, matrix),
    fill: fillVisible ? fillPaint.color : "none",
    stroke: strokeVisible ? strokePaint.color : "none",
    strokeWidth: style.strokeWidth * scale,
    opacity: Math.max(0, Math.min(1, style.opacity * (fillVisible ? fillAlpha : strokeAlpha))),
    round: style.round,
    evenOdd: style.evenOdd,
  });
}

function walk(element: XmlElement, matrix: Matrix, parent: Style, ctx: Context, depth: number, useDepth: number): void {
  if (++ctx.elements > MAX_ELEMENTS || depth > MAX_DEPTH) {
    ctx.warnings.add("The file is very complex; the rest was left out.");
    return;
  }
  const name = localName(element.name);
  const skipped = SKIPPED_WITH_WARNING[name];
  if (skipped) {
    ctx.warnings.add(skipped);
    return;
  }
  if (INERT.has(name)) return;

  const declarations = declarationsOf(element, ctx.rules);
  if (declarations.display === "none") return;
  const style = inherit(parent, declarations);
  const m = multiply(matrix, parseTransform(element.attrs.transform));

  if (SHAPES.has(name)) {
    drawShape(element, name, m, style, declarations, ctx);
    return;
  }

  if (name === "use") {
    const id = hrefOf(element);
    const target = id ? ctx.ids.get(id) : undefined;
    if (!target || useDepth >= MAX_USE_DEPTH) {
      ctx.warnings.add("A <use> reference could not be resolved and was left out.");
      return;
    }
    const placed = multiply(m, [1, 0, 0, 1, length(element.attrs.x), length(element.attrs.y)]);
    if (localName(target.name) === "symbol") {
      for (const child of target.children) walk(child, placed, style, ctx, depth + 1, useDepth + 1);
    } else {
      walk(target, placed, style, ctx, depth + 1, useDepth + 1);
    }
    return;
  }

  if (name === "svg" && depth > 0) {
    // A nested viewport: honour its position and, when both are given, its scaling.
    const box = (element.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
    const w = length(element.attrs.width);
    const h = length(element.attrs.height);
    let inner = multiply(m, [1, 0, 0, 1, length(element.attrs.x), length(element.attrs.y)]);
    if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
      const s = w > 0 && h > 0 ? Math.min(w / box[2], h / box[3]) : 1;
      inner = multiply(inner, [s, 0, 0, s, -box[0] * s, -box[1] * s]);
    }
    for (const child of element.children) walk(child, inner, style, ctx, depth + 1, useDepth);
    return;
  }

  // g, a, switch, the root svg and anything unknown: a plain group.
  for (const child of element.children) walk(child, m, style, ctx, depth + 1, useDepth);
}

function findRoot(element: XmlElement): XmlElement | null {
  if (localName(element.name) === "svg") return element;
  for (const child of element.children) {
    const found = findRoot(child);
    if (found) return found;
  }
  return null;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

function declaredView(root: XmlElement): View | null {
  const box = (root.attrs.viewBox ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return { x: box[0], y: box[1], w: box[2], h: box[3] };
  const w = length(root.attrs.width);
  const h = length(root.attrs.height);
  // Percentages and missing sizes say nothing about the artwork's extent.
  if (w > 0 && h > 0 && !/%/.test(root.attrs.width ?? "") && !/%/.test(root.attrs.height ?? "")) return { x: 0, y: 0, w, h };
  return null;
}

function isBackground(item: Painted, view: View): boolean {
  if (item.stroke !== "none") return false;
  if (item.fill !== "none" && !(item.fill === "#ffffff" && item.opacity >= 0.999)) return false;
  const bounds = pathBounds(item.path);
  if (!bounds) return false;
  const covers =
    bounds.w >= view.w * BACKGROUND_COVERAGE &&
    bounds.h >= view.h * BACKGROUND_COVERAGE &&
    Math.abs(bounds.x - view.x) <= view.w * (1 - BACKGROUND_COVERAGE) &&
    Math.abs(bounds.y - view.y) <= view.h * (1 - BACKGROUND_COVERAGE);
  return covers && isRectangle(item.path);
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Flattens SVG source into painted paths in a single viewBox, anchored at the
 * origin. Never throws: unreadable input yields `artwork: null` and a warning.
 */
export function importSvg(source: string): SvgImportResult {
  const warnings = new Set<string>();
  let root: XmlElement | null;
  try {
    root = findRoot(parseXml(source));
  } catch (error) {
    return { artwork: null, warnings: [error instanceof Error ? error.message : "The file is not valid XML."] };
  }
  if (!root) return { artwork: null, warnings: ["The file contains no <svg> element."] };

  const rules: Rules = { tags: new Map(), classes: new Map(), ids: new Map(), unsupported: false };
  const ids = new Map<string, XmlElement>();
  indexIds(root, ids, rules);
  if (rules.unsupported) warnings.add("Some CSS selectors are not supported; the colours they set were ignored.");

  const ctx: Context = { ids, rules, painted: [], warnings, elements: 0 };
  walk(root, IDENTITY, ROOT_STYLE, ctx, 0, 0);
  if (!ctx.painted.length) {
    warnings.add("No drawable shapes were found.");
    return { artwork: null, warnings: [...warnings] };
  }

  let view = declaredView(root);
  if (!view) {
    const all = ctx.painted.flatMap((item) => {
      const b = pathBounds(item.path);
      return b ? [b] : [];
    });
    if (!all.length) return { artwork: null, warnings: [...warnings, "No drawable shapes were found."] };
    const x = Math.min(...all.map((b) => b.x));
    const y = Math.min(...all.map((b) => b.y));
    view = { x, y, w: Math.max(...all.map((b) => b.x + b.w)) - x, h: Math.max(...all.map((b) => b.y + b.h)) - y };
  }
  if (!(view.w > 0 && view.h > 0)) return { artwork: null, warnings: [...warnings, "The artwork has no size."] };

  const decimals = Math.max(view.w, view.h) < 16 ? 3 : 2;
  const shift: Matrix = [1, 0, 0, 1, -view.x, -view.y];
  const layers: PackLayer[] = [];
  for (const item of ctx.painted) {
    if (isBackground(item, view)) continue;
    const layer: PackLayer = { d: pathToSvg(transformPath(item.path, shift), decimals), fill: item.fill };
    if (item.stroke !== "none") {
      layer.stroke = item.stroke;
      layer.strokeWidth = round3(item.strokeWidth);
    }
    if (item.opacity < 0.999) layer.opacity = round3(item.opacity);
    if (item.round && item.stroke !== "none") layer.round = true;
    if (item.evenOdd && item.fill !== "none") layer.evenOdd = true;
    layers.push(layer);
  }
  if (!layers.length) return { artwork: null, warnings: [...warnings, "The file only contains a plain background."] };

  return { artwork: { viewBox: { w: round3(view.w), h: round3(view.h) }, layers }, warnings: [...warnings] };
}
