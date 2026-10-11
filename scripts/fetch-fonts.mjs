#!/usr/bin/env node
/**
 * Downloads the diagram fonts as static TTF files and generates the glyph
 * advance-width table used by the shared text measurer.
 *
 * Why TTF + a metrics table?
 *  - The same TTF is used by the browser canvas, the SVG/PDF exporters and the
 *    server-side PNG renderer, so text looks identical everywhere.
 *  - Text wrapping is computed from the metrics table (no DOM needed), so the
 *    browser, the exporters and the MCP server always break lines identically.
 *
 * Run: `npm run fonts`  (output is committed, so this is only needed when
 * changing the font set).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = path.join(ROOT, "public", "fonts");
const METRICS_FILE = path.join(ROOT, "src", "core", "text", "font-metrics.json");

/** family key -> Google Fonts family + the styles we ship. */
const FAMILIES = {
  sans: { google: "IBM Plex Sans", css: "IBM Plex Sans", file: "plex-sans", styles: ["400", "400i", "600", "600i"] },
  serif: { google: "IBM Plex Serif", css: "IBM Plex Serif", file: "plex-serif", styles: ["400", "400i", "600"] },
  mono: { google: "IBM Plex Mono", css: "IBM Plex Mono", file: "plex-mono", styles: ["400", "400i", "600"] },
  hand: { google: "Kalam", css: "Kalam", file: "kalam", styles: ["400", "700"] },
};

/** Codepoint ranges stored in the metrics table. */
const RANGES = [
  [0x20, 0x7e], // Basic Latin
  [0xa0, 0x24f], // Latin-1 Supplement, Latin Extended-A/B
  [0x2010, 0x2026], // dashes, quotes, ellipsis
  [0x2030, 0x203a],
  [0x20ac, 0x20ac], // euro
  [0x2190, 0x2199], // arrows
  [0x21d0, 0x21d4],
  [0x2200, 0x2265], // common math
  [0x25a0, 0x25cf], // geometric shapes
  [0x2713, 0x2717], // check marks
];

function cssUrl(family, styles) {
  const hasItalic = styles.some((s) => s.endsWith("i"));
  const tuples = styles
    .map((s) => (hasItalic ? `${s.endsWith("i") ? 1 : 0},${parseInt(s, 10)}` : `${parseInt(s, 10)}`))
    .sort()
    .join(";");
  const axis = hasItalic ? "ital,wght" : "wght";
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axis}@${tuples}`;
}

/** Google serves static TTF to clients it does not recognise as a browser. */
async function resolveTtfUrls(family, styles) {
  const res = await fetch(cssUrl(family, styles), { headers: { "User-Agent": "curl/8.0" } });
  if (!res.ok) throw new Error(`Google Fonts CSS request failed for ${family}: ${res.status}`);
  const css = await res.text();
  const urls = {};
  for (const block of css.split("@font-face").slice(1)) {
    const style = /font-style:\s*(\w+)/.exec(block)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
    const url = /url\((https:[^)]+\.ttf)\)/.exec(block)?.[1];
    if (style && weight && url) urls[`${weight}${style === "italic" ? "i" : ""}`] = url;
  }
  return urls;
}

function extractMetrics(buffer) {
  const font = opentype.parse(buffer);
  const widths = {};
  let total = 0;
  let count = 0;
  for (const [from, to] of RANGES) {
    for (let cp = from; cp <= to; cp++) {
      const glyph = font.charToGlyph(String.fromCodePoint(cp));
      if (!glyph || glyph.index === 0) continue;
      widths[cp] = Math.round(glyph.advanceWidth);
      if (cp >= 0x61 && cp <= 0x7a) {
        total += glyph.advanceWidth;
        count++;
      }
    }
  }
  const os2 = font.tables.os2 ?? {};
  return {
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    capHeight: os2.sCapHeight || Math.round(font.ascender * 0.7),
    xHeight: os2.sxHeight || Math.round(font.ascender * 0.5),
    avg: Math.round(total / Math.max(count, 1)),
    widths,
  };
}

async function main() {
  await mkdir(FONT_DIR, { recursive: true });
  await mkdir(path.dirname(METRICS_FILE), { recursive: true });
  const metrics = {};

  for (const [key, family] of Object.entries(FAMILIES)) {
    const urls = await resolveTtfUrls(family.google, family.styles);
    for (const style of family.styles) {
      const url = urls[style];
      if (!url) throw new Error(`No TTF found for ${family.google} ${style}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed: ${url}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const fileName = `${family.file}-${style}.ttf`;
      await writeFile(path.join(FONT_DIR, fileName), buffer);
      metrics[`${key}-${style}`] = extractMetrics(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      console.log(`✓ ${fileName} (${(buffer.length / 1024).toFixed(0)} kB)`);
    }
  }

  await writeFile(METRICS_FILE, JSON.stringify(metrics));
  console.log(`✓ metrics → ${path.relative(ROOT, METRICS_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
