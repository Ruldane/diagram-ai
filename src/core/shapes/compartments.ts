/**
 * Shared renderers for "structured" shapes whose label is split into sections
 * on `---` lines: UML classes, ER entities, states with internal activities,
 * and stacked title/subtitle cards.
 */
import type { Color, HAlign, Rect, Size, VAlign } from "../model/types";
import type { FontSpec } from "../text/fonts";
import { measureBlock, wrapText, LINE_HEIGHT } from "../text/layout";
import { measureText } from "../text/measure";
import { body, fontOf, line, linePath, linesOf, rectPath, shade, solid, text, type TextOptions } from "./kit";
import type { Prim, ShapeCtx } from "./types";

/* ------------------------------------------------------ compartment boxes */

export interface CompartmentOptions {
  /** Corner radius of the box. */
  radius?: number;
  /** Fill of the header band; defaults to a slightly darker node fill. */
  headerFill?: Color | "auto" | "none";
  /** Italic header (abstract class). */
  italicHeader?: boolean;
  /** Underlined header (UML object). */
  underlineHeader?: boolean;
  /** Text shown above the name, e.g. `«interface»`. */
  stereotype?: string;
  /** Font family for body rows (mono reads well for attributes). */
  bodyFont?: Partial<FontSpec>;
  /** Padding inside each compartment. */
  padding?: number;
  /** Minimum number of body compartments drawn even when empty. */
  minSections?: number;
}

const PAD = 10;
const BODY_SCALE = 0.93;

interface CompartmentModel {
  header: string[];
  bodies: string[][];
  headerFont: FontSpec;
  stereoFont: FontSpec;
  bodyFont: FontSpec;
  headerH: number;
  bodyHeights: number[];
  padding: number;
}

function model(ctx: Pick<ShapeCtx, "style" | "sections">, options: CompartmentOptions): CompartmentModel {
  const padding = options.padding ?? PAD;
  const headerFont = fontOf(ctx.style, { bold: true, italic: options.italicHeader || ctx.style.italic });
  const stereoFont = fontOf(ctx.style, { size: ctx.style.fontSize * 0.85, bold: false, italic: false });
  const bodyFont = fontOf(ctx.style, { size: ctx.style.fontSize * BODY_SCALE, bold: false, italic: false, ...options.bodyFont });
  const header = linesOf(ctx.sections[0]);
  const bodies = ctx.sections.slice(1).map((s) => linesOf(s));
  while (bodies.length < (options.minSections ?? 0)) bodies.push([]);
  const stereoLines = options.stereotype ? 1 : 0;
  const headerH =
    padding * 2 + Math.max(1, header.length) * headerFont.size * LINE_HEIGHT + stereoLines * stereoFont.size * LINE_HEIGHT;
  const bodyHeights = bodies.map((rows) => padding * 1.4 + Math.max(1, rows.length) * bodyFont.size * LINE_HEIGHT);
  return { header, bodies, headerFont, stereoFont, bodyFont, headerH, bodyHeights, padding };
}

/** Natural size of a compartment box for its content. */
export function compartmentFit(ctx: Pick<ShapeCtx, "style" | "sections">, options: CompartmentOptions = {}, min: Size = { w: 140, h: 0 }): Size {
  const m = model(ctx, options);
  let w = min.w;
  for (const row of m.header) w = Math.max(w, measureText(row, m.headerFont) + m.padding * 2 + 8);
  if (options.stereotype) w = Math.max(w, measureText(options.stereotype, m.stereoFont) + m.padding * 2);
  for (const rows of m.bodies) for (const row of rows) w = Math.max(w, measureText(row, m.bodyFont) + m.padding * 2 + 4);
  return { w, h: Math.max(min.h, m.headerH + m.bodyHeights.reduce((a, b) => a + b, 0)) };
}

/**
 * Header band + stacked body compartments.
 * Body compartments stretch to fill the node height proportionally.
 */
export function compartmentBox(ctx: ShapeCtx, options: CompartmentOptions = {}): Prim[] {
  const { w, h, style } = ctx;
  const m = model(ctx, options);
  const radius = options.radius ?? style.radius;
  const prims: Prim[] = [body(ctx, rectPath(0, 0, w, h, radius))];

  const natural = m.headerH + m.bodyHeights.reduce((a, b) => a + b, 0);
  const headerH = m.bodies.length === 0 ? h : Math.min(m.headerH, h);
  const extra = Math.max(0, h - natural);

  // Header band.
  const headerFill =
    options.headerFill === "none" || style.fill === "none"
      ? undefined
      : options.headerFill && options.headerFill !== "auto"
        ? options.headerFill
        : shade(style.fill, 0.05);
  if (headerFill && m.bodies.length > 0) {
    prims.push(solid(rectPath(0, 0, w, headerH, 0), headerFill));
    prims.push(line(ctx, rectPath(0, 0, w, h, radius)));
  }

  let y = m.padding;
  const headerBlockH =
    m.header.length * m.headerFont.size * LINE_HEIGHT + (options.stereotype ? m.stereoFont.size * LINE_HEIGHT : 0);
  if (m.bodies.length === 0) y = (h - headerBlockH) / 2;
  if (options.stereotype) {
    const sh = m.stereoFont.size * LINE_HEIGHT;
    prims.push(text(ctx, options.stereotype, { x: 0, y, w, h: sh }, { font: m.stereoFont, align: "center", valign: "middle", wrap: false }));
    y += sh;
  }
  prims.push(
    text(ctx, m.header.join("\n") || " ", { x: 0, y, w, h: m.header.length * m.headerFont.size * LINE_HEIGHT || m.headerFont.size * LINE_HEIGHT }, {
      font: m.headerFont,
      align: "center",
      valign: "middle",
      padding: m.padding,
      wrap: false,
      underline: options.underlineHeader,
    }),
  );

  // Body compartments.
  let top = headerH;
  m.bodies.forEach((rows, index) => {
    const height = m.bodyHeights[index] + extra / m.bodies.length;
    prims.push(line(ctx, linePath(0, top, w, top), { strokeWidth: Math.min(style.strokeWidth, 1.25) }));
    if (rows.length) {
      prims.push(
        text(ctx, rows.join("\n"), { x: 0, y: top, w, h: height }, {
          font: m.bodyFont,
          align: "left",
          valign: "top",
          padding: m.padding * 0.7,
          wrap: false,
        }),
      );
    }
    top += height;
  });
  return prims;
}

/* ----------------------------------------------------------- stacked text */

export interface StackItem {
  text: string;
  font?: Partial<FontSpec>;
  color?: Color;
  /** Space above this item. */
  gap?: number;
}

export interface StackOptions extends Pick<TextOptions, "padding"> {
  align?: HAlign;
  valign?: VAlign;
}

function stackMeasure(ctx: Pick<ShapeCtx, "style">, items: StackItem[], width: number) {
  return items
    .filter((item) => item.text.trim())
    .map((item) => {
      const font = fontOf(ctx.style, item.font);
      const lines = wrapText(item.text, font, width);
      return { item, font, height: lines.length * font.size * LINE_HEIGHT };
    });
}

/** Total height of a stack of text blocks wrapped to `width`. */
export function stackHeight(ctx: Pick<ShapeCtx, "style">, items: StackItem[], width: number): number {
  return stackMeasure(ctx, items, width).reduce((sum, m, i) => sum + m.height + (i > 0 ? (m.item.gap ?? 2) : 0), 0);
}

/** Widest line across a stack of text blocks, optionally wrapped to `maxWidth`. */
export function stackWidth(ctx: Pick<ShapeCtx, "style">, items: StackItem[], maxWidth = Infinity): number {
  let w = 0;
  for (const item of items) {
    if (!item.text.trim()) continue;
    w = Math.max(w, measureBlock(item.text, fontOf(ctx.style, item.font), maxWidth).w);
  }
  return w;
}

/**
 * Lays several text blocks out as one vertical group (title + subtitle +
 * description…), each with its own font, centred as a whole inside `box`.
 */
export function stackText(ctx: ShapeCtx, box: Rect, items: StackItem[], options: StackOptions = {}): Prim[] {
  const padding = options.padding ?? 10;
  const align = options.align ?? ctx.style.align;
  const valign = options.valign ?? "middle";
  const measured = stackMeasure(ctx, items, box.w - padding * 2);
  const total = measured.reduce((sum, m, i) => sum + m.height + (i > 0 ? (m.item.gap ?? 2) : 0), 0);
  let y = valign === "top" ? box.y + padding : valign === "bottom" ? box.y + box.h - padding - total : box.y + (box.h - total) / 2;
  const prims: Prim[] = [];
  measured.forEach((m, i) => {
    if (i > 0) y += m.item.gap ?? 2;
    prims.push(
      text(ctx, m.item.text, { x: box.x, y, w: box.w, h: m.height }, { font: m.font, color: m.item.color, align, valign: "middle", padding }),
    );
    y += m.height;
  });
  return prims;
}
