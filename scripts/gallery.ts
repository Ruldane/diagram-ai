/**
 * Renders every shape of the given libraries into a contact-sheet PNG, for
 * visual review while authoring shapes.
 *
 *   npx tsx scripts/gallery.ts                 → all libraries, one PNG each
 *   npx tsx scripts/gallery.ts uml er          → only these libraries
 *   npx tsx scripts/gallery.ts uml --out dir   → custom output directory
 *
 * Output goes to `.gallery/<library>.png` (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { DEFAULT_SETTINGS } from "../src/core/model/defaults";
import type { DNode } from "../src/core/model/types";
import { buildScene } from "../src/core/render/scene";
import { renderSvg } from "../src/core/render/svg";
import { fitSize, listLibraries } from "../src/core/shapes/registry";
import { allFontVariants } from "../src/core/text/fonts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : ".gallery");
const wanted = args.filter((a, i) => !a.startsWith("--") && (outIndex < 0 || i !== outIndex + 1));

const COLUMNS = 4;
const CELL_W = 320;
const GAP_Y = 64;
const fontFiles = allFontVariants().map((v) => path.resolve("public", "fonts", v.file));

mkdirSync(outDir, { recursive: true });

for (const library of listLibraries()) {
  if (wanted.length && !wanted.includes(library.id)) continue;
  if (library.shapes.length === 0) {
    console.log(`– ${library.id}: no shapes yet`);
    continue;
  }

  const nodes: Record<string, DNode> = {};
  let rowTop = 0;
  let rowHeight = 0;
  library.shapes.forEach((shape, index) => {
    const column = index % COLUMNS;
    if (column === 0 && index > 0) {
      rowTop += rowHeight + GAP_Y;
      rowHeight = 0;
    }
    const size = fitSize({ shape: shape.id, text: shape.text, data: shape.data });
    const scale = Math.min(1, (CELL_W - 30) / size.w);
    const w = size.w * scale;
    const h = size.h * scale;
    const cx = column * CELL_W + CELL_W / 2;
    nodes[`s${index}`] = { id: `s${index}`, shape: shape.id, x: cx - w / 2, y: rowTop, w, h, z: index + 1, text: shape.text };
    nodes[`c${index}`] = {
      id: `c${index}`,
      shape: "basic/text",
      x: cx - CELL_W / 2 + 6,
      y: rowTop + h + 26,
      w: CELL_W - 12,
      h: 18,
      z: 0,
      text: shape.id,
      style: { fontFamily: "mono", fontSize: 10, textColor: "#9aa1a9" },
    };
    rowHeight = Math.max(rowHeight, h + 30);
  });

  const scene = buildScene({ nodes, edges: {}, settings: DEFAULT_SETTINGS });
  const { svg } = renderSvg(scene, { padding: 36 });
  const png = new Resvg(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "IBM Plex Sans" },
  })
    .render()
    .asPng();
  const file = path.join(outDir, `${library.id}.png`);
  writeFileSync(file, png);
  console.log(`✓ ${library.id}: ${library.shapes.length} shapes → ${path.relative(process.cwd(), file)}`);
}
