/**
 * Authoring kit for shape libraries. Import everything a shape needs from here.
 */
import { ellipsePath, rectPath, type Path } from "../geometry/path";
import type { ResolvedNodeStyle } from "../model/defaults";
import { mix } from "../model/palette";
import type { Color, HAlign, Rect, VAlign } from "../model/types";
import type { FontSpec } from "../text/fonts";
import { LINE_HEIGHT } from "../text/layout";
import { iconPrims } from "./icons";
import type { PathPrim, Prim, ShapeCtx, ShapeDef, TextPrim } from "./types";

export {
  ellipsePath,
  fitPath,
  linePath,
  parseSvgPath,
  polyPath,
  rectPath,
  roundedPolyPath,
  transformPath,
  translatePath,
  type Path,
} from "../geometry/path";
export { measureBlock, wrapText, LINE_HEIGHT } from "../text/layout";
export { measureText } from "../text/measure";
export { mix, readableTextOn, INK, PAPER, PALETTE } from "../model/palette";
export { iconPrims, hasIcon } from "./icons";
export { brandPrims, glyphPrims, type GlyphLayer } from "./glyph";
export type { LabelSpec, PathPrim, Prim, ShapeCtx, ShapeDef, ShapeLibrary, TextPrim } from "./types";

/* ------------------------------------------------------------------- paint */

/** The node's own fill + stroke: use for the main body of a shape. */
export function body(ctx: ShapeCtx, d: Path, overrides: Partial<PathPrim> = {}): PathPrim {
  const { style } = ctx;
  return {
    kind: "path",
    d,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    dash: style.dash,
    ...overrides,
  };
}

/** Stroke only, in the node's stroke colour: inner lines, decorations. */
export function line(ctx: ShapeCtx, d: Path, overrides: Partial<PathPrim> = {}): PathPrim {
  return { kind: "path", d, stroke: ctx.style.stroke, strokeWidth: ctx.style.strokeWidth, ...overrides };
}

/** Fill only. */
export function solid(d: Path, fill: Color, overrides: Partial<PathPrim> = {}): PathPrim {
  return { kind: "path", d, fill, ...overrides };
}

/** Lightens a colour towards white (`amount` 0..1). */
export const tint = (color: Color, amount: number): Color => (color === "none" ? color : mix(color, "#ffffff", amount));
/** Darkens a colour towards black (`amount` 0..1). */
export const shade = (color: Color, amount: number): Color => (color === "none" ? color : mix(color, "#000000", amount));

/* -------------------------------------------------------------------- text */

export function fontOf(style: ResolvedNodeStyle, overrides: Partial<FontSpec> = {}): FontSpec {
  return { family: style.fontFamily, size: style.fontSize, bold: style.bold, italic: style.italic, ...overrides };
}

export interface TextOptions {
  font?: Partial<FontSpec>;
  color?: Color;
  align?: HAlign;
  valign?: VAlign;
  padding?: number;
  wrap?: boolean;
  underline?: boolean;
}

/** A text primitive using the node's text style unless overridden. */
export function text(ctx: ShapeCtx, content: string, box: Rect, options: TextOptions = {}): TextPrim {
  return {
    kind: "text",
    text: content,
    box,
    font: fontOf(ctx.style, options.font),
    color: options.color ?? ctx.style.textColor,
    align: options.align ?? ctx.style.align,
    valign: options.valign ?? ctx.style.valign,
    padding: options.padding ?? 0,
    wrap: options.wrap,
    underline: options.underline ?? ctx.style.underline,
  };
}

/** Height of `lines` lines of text at the given font size. */
export const linesHeight = (lines: number, fontSize: number): number => lines * fontSize * LINE_HEIGHT;

/** Non-empty lines of a text section. */
export const linesOf = (section: string | undefined): string[] =>
  (section ?? "").split("\n").filter((l) => l.trim().length > 0);

/* ------------------------------------------------------------------- icons */

/** Icon drawn in the node's stroke colour unless a colour is given. */
export function icon(ctx: ShapeCtx, name: string, x: number, y: number, size: number, color?: Color): PathPrim[] {
  return iconPrims(name, x, y, size, color ?? ctx.style.stroke);
}

/* ---------------------------------------------------------------- builders */

type SimpleShape = Omit<ShapeDef, "draw" | "outline"> & {
  /** Single closed outline that is both the drawn body and the connector clip path. */
  path: (w: number, h: number, style: ResolvedNodeStyle) => Path;
  /** Extra primitives drawn on top of the body. */
  extra?: (ctx: ShapeCtx) => Prim[];
};

/** Defines a shape whose body is one closed path. Covers most shapes. */
export function simpleShape(def: SimpleShape): ShapeDef {
  const { path, extra, ...rest } = def;
  return {
    ...rest,
    outline: path,
    draw: (ctx) => [body(ctx, path(ctx.w, ctx.h, ctx.style)), ...(extra?.(ctx) ?? [])],
  };
}

export const boxPath = (w: number, h: number, style: ResolvedNodeStyle): Path => rectPath(0, 0, w, h, style.radius);
export const ovalPath = (w: number, h: number): Path => ellipsePath(w / 2, h / 2, w / 2, h / 2);

/** Reads a typed value from `node.data` with a fallback. */
export function param<T extends string | number | boolean>(ctx: Pick<ShapeCtx, "data">, key: string, fallback: T): T {
  const value = ctx.data[key];
  return typeof value === typeof fallback ? (value as T) : fallback;
}
