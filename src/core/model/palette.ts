import type { Color } from "./types";

/** A named colour resolves to a coordinated fill / stroke / text triple. */
export interface Swatch {
  fill: Color;
  stroke: Color;
  text: Color;
}

export const INK = "#1c1f23";
export const PAPER = "#ffffff";

export const PALETTE = {
  default: { fill: "#ffffff", stroke: INK, text: INK },
  gray: { fill: "#f1f3f5", stroke: "#5c6670", text: "#212529" },
  blue: { fill: "#e5efff", stroke: "#2f6fed", text: "#123a8f" },
  teal: { fill: "#dff6f2", stroke: "#0f9d8c", text: "#0b5d54" },
  green: { fill: "#e4f5e6", stroke: "#2f9e44", text: "#1b5e28" },
  yellow: { fill: "#fff4cc", stroke: "#d99a00", text: "#6b4f00" },
  orange: { fill: "#ffe8d2", stroke: "#e8792a", text: "#7a3e00" },
  red: { fill: "#ffe2df", stroke: "#e03131", text: "#861b1b" },
  pink: { fill: "#ffe3ef", stroke: "#d6478f", text: "#7c1d4f" },
  purple: { fill: "#eee6ff", stroke: "#7b4fe0", text: "#3f2391" },
  dark: { fill: "#1c1f23", stroke: "#1c1f23", text: "#ffffff" },
} as const satisfies Record<string, Swatch>;

export type PaletteName = keyof typeof PALETTE;

export const PALETTE_NAMES = Object.keys(PALETTE) as PaletteName[];

export function isPaletteName(value: unknown): value is PaletteName {
  return typeof value === "string" && value in PALETTE;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isColor(value: unknown): value is Color {
  return typeof value === "string" && (value === "none" || HEX.test(value));
}

/** Expands `#abc` to `#aabbcc` and lowercases. Returns undefined when invalid. */
export function normalizeColor(value: string): Color | undefined {
  const v = value.trim().toLowerCase();
  if (v === "none" || v === "transparent") return "none";
  if (!HEX.test(v)) return undefined;
  if (v.length === 4) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return v;
}

export function hexToRgb(hex: Color): [number, number, number] {
  const v = normalizeColor(hex);
  if (!v || v === "none") return [0, 0, 0];
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
}

/** Relative luminance (0 = black, 1 = white), used to pick readable text. */
export function luminance(hex: Color): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableTextOn(fill: Color): Color {
  if (fill === "none") return INK;
  return luminance(fill) > 0.45 ? INK : "#ffffff";
}

/** Linear mix of two colours; `t = 0` returns `a`, `t = 1` returns `b`. */
export function mix(a: Color, b: Color, t: number): Color {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const out = ca.map((c, i) => Math.round(c + (cb[i] - c) * t));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
