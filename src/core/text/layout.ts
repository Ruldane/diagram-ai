import type { HAlign, Rect, Size, VAlign } from "../model/types";
import type { FontSpec } from "./fonts";
import { measureText, verticalMetrics } from "./measure";

export const LINE_HEIGHT = 1.3;
const WRAP_TOLERANCE = 0.01;

export interface TextBlock {
  text: string;
  font: FontSpec;
  box: Rect;
  align?: HAlign;
  valign?: VAlign;
  /** Inner padding in px (default 0). */
  padding?: number;
  /** Wrap to the box width (default true). */
  wrap?: boolean;
  lineHeight?: number;
}

export interface TextLine {
  text: string;
  /** Anchor x: left edge, centre or right edge depending on `anchor`. */
  x: number;
  /** Baseline y. */
  y: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  anchor: "start" | "middle" | "end";
  lineHeight: number;
  /** Bounding box of the laid out text. */
  bounds: Rect;
}

/** Breaks a word that is wider than the available width into chunks. */
function breakWord(word: string, font: FontSpec, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of word) {
    if (current && measureText(current + char, font) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Greedy word wrap. Explicit newlines are always respected. */
export function wrapText(text: string, font: FontSpec, maxWidth: number): string[] {
  const lines: string[] = [];
  // The tolerance absorbs floating-point noise when a box was sized from this very measurement.
  const limit = Math.max(maxWidth, font.size) + WRAP_TOLERANCE;
  for (const paragraph of text.split("\n")) {
    if (!Number.isFinite(maxWidth) || measureText(paragraph, font) <= limit) {
      lines.push(paragraph);
      continue;
    }
    let current = "";
    for (const token of paragraph.split(/(\s+)/)) {
      if (!token) continue;
      const candidate = current + token;
      if (measureText(candidate.trimEnd(), font) <= limit) {
        current = candidate;
        continue;
      }
      if (current.trim()) lines.push(current.trimEnd());
      if (/^\s+$/.test(token)) {
        current = "";
      } else if (measureText(token, font) > limit) {
        const chunks = breakWord(token, font, limit);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] ?? "";
      } else {
        current = token;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

export function layoutText(block: TextBlock): TextLayout {
  const { font, box } = block;
  const padding = block.padding ?? 0;
  const align = block.align ?? "center";
  const valign = block.valign ?? "middle";
  const lineHeight = font.size * (block.lineHeight ?? LINE_HEIGHT);
  const innerWidth = Math.max(0, box.w - padding * 2);

  const rawLines = block.wrap === false ? block.text.split("\n") : wrapText(block.text, font, innerWidth);
  const { ascent, descent } = verticalMetrics(font);
  const totalHeight = rawLines.length * lineHeight;

  let top: number;
  if (valign === "top") top = box.y + padding;
  else if (valign === "bottom") top = box.y + box.h - padding - totalHeight;
  else top = box.y + (box.h - totalHeight) / 2;

  const anchorX = align === "left" ? box.x + padding : align === "right" ? box.x + box.w - padding : box.x + box.w / 2;
  const baselineOffset = (lineHeight - (ascent + descent)) / 2 + ascent;

  let maxWidth = 0;
  const lines = rawLines.map((text, index) => {
    const width = measureText(text, font);
    if (width > maxWidth) maxWidth = width;
    return { text, x: anchorX, y: top + index * lineHeight + baselineOffset, width };
  });

  const left = align === "left" ? anchorX : align === "right" ? anchorX - maxWidth : anchorX - maxWidth / 2;
  return {
    lines,
    anchor: align === "left" ? "start" : align === "right" ? "end" : "middle",
    lineHeight,
    bounds: { x: left, y: top, w: maxWidth, h: totalHeight },
  };
}

/** Size needed to render `text`, optionally wrapped to `maxWidth`. */
export function measureBlock(text: string, font: FontSpec, maxWidth = Infinity, lineHeight = LINE_HEIGHT): Size {
  const lines = wrapText(text, font, maxWidth);
  let width = 0;
  for (const line of lines) width = Math.max(width, measureText(line, font));
  return { w: width, h: lines.length * font.size * lineHeight };
}
