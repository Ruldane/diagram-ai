import { fontVariant, type FontSpec } from "./fonts";
import rawMetrics from "./font-metrics.json";

interface FaceMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  avg: number;
  widths: Record<string, number>;
}

const METRICS = rawMetrics as unknown as Record<string, FaceMetrics>;
const FALLBACK_FACE = METRICS["sans-400"];

function face(font: FontSpec): FaceMetrics {
  return METRICS[fontVariant(font).key] ?? FALLBACK_FACE;
}

/** Wide scripts (CJK, Hangul, full-width forms, emoji) take a full em. */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    codePoint >= 0x1f000
  );
}

/**
 * Width of a single line of text in px.
 *
 * Uses the advance widths of the bundled fonts instead of the DOM, so the
 * browser, exporters and the server always agree on where lines break.
 */
export function measureText(text: string, font: FontSpec): number {
  const metrics = face(font);
  let units = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    const width = metrics.widths[codePoint];
    if (width !== undefined) units += width;
    else if (isWide(codePoint)) units += metrics.unitsPerEm;
    else if (codePoint === 0x09) units += (metrics.widths[32] ?? metrics.avg) * 4;
    else units += metrics.avg;
  }
  return (units * font.size) / metrics.unitsPerEm;
}

export interface VerticalMetrics {
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
}

export function verticalMetrics(font: FontSpec): VerticalMetrics {
  const metrics = face(font);
  const k = font.size / metrics.unitsPerEm;
  return {
    ascent: metrics.ascender * k,
    descent: -metrics.descender * k,
    capHeight: metrics.capHeight * k,
    xHeight: metrics.xHeight * k,
  };
}
