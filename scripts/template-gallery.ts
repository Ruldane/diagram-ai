/**
 * Renders the starter template of diagram types to PNG, exactly the way the
 * server instantiates them, for visual review while authoring the catalog.
 *
 *   npx tsx scripts/template-gallery.ts                → every type + contact sheets
 *   npx tsx scripts/template-gallery.ts er-diagram swot → only these types
 *   npx tsx scripts/template-gallery.ts @strategy       → every type of a category
 *
 * Output goes to `.gallery/templates/<typeId>.png` (2× scale) and, per
 * category, `.gallery/templates/_sheet-<category>.png` (continued in
 * `-2`, `-3`… when a category has more templates than fit on one sheet).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { CATEGORIES, listDiagramTypes, type DiagramTypeDef } from "../src/core/catalog";
import { exportPages } from "../src/core/export/pages";
import { loadElk } from "../src/core/layout/engine";
import { computeLayout } from "../src/core/layout/layout";
import { createDoc } from "../src/core/model/defaults";
import { applyPatch } from "../src/core/model/patch";
import type { DiagramDoc } from "../src/core/model/types";
import { escapeXml, renderSvg, type SvgResult } from "../src/core/render/svg";
import { applySpec } from "../src/core/spec/apply";
import { buildSequence } from "../src/core/spec/sequence";
import { allFontVariants } from "../src/core/text/fonts";

const outDir = path.resolve(".gallery", "templates");
const fontFiles = allFontVariants().map((v) => path.resolve("public", "fonts", v.file));
const resvgFont = { fontFiles, loadSystemFonts: false, defaultFontFamily: "IBM Plex Sans" };

const SHEET = { columns: 3, rows: 3, cellW: 640, cellH: 460, caption: 34, gap: 16 };

/** Same steps as `DiagramService.create` with `template: true`. */
async function instantiate(type: DiagramTypeDef): Promise<{ doc: DiagramDoc; warnings: string[] }> {
  let doc = createDoc({ name: type.name, type: type.id, settings: { routing: type.routing, layout: type.layout } });
  const template = type.template;
  if (!template) return { doc, warnings: [] };
  if (template.sequence) {
    const built = buildSequence(template.sequence);
    return { doc: applyPatch(doc, built.patch).doc, warnings: built.warnings };
  }
  const built = applySpec(doc, template, { mode: "create", defaultShape: type.defaultShape });
  doc = applyPatch(doc, built.patch).doc;
  if (template.layout === "auto") doc = applyPatch(doc, await computeLayout(doc, type.layout, await loadElk())).doc;
  return { doc, warnings: built.warnings };
}

const toPng = (svg: string, zoom: number): Buffer => new Resvg(svg, { fitTo: { mode: "zoom", value: zoom }, font: resvgFont }).render().asPng();

/** Places a rendered template inside a cell, scaled down to fit and centred. */
function embed(rendered: SvgResult, x: number, y: number, w: number, h: number): string {
  const scale = Math.min(1, w / rendered.width, h / rendered.height);
  const width = rendered.width * scale;
  const height = rendered.height * scale;
  return rendered.svg.replace(
    /^<svg xmlns="[^"]+" width="[^"]+" height="[^"]+"/,
    `<svg x="${x + (w - width) / 2}" y="${y + (h - height) / 2}" width="${width}" height="${height}"`,
  );
}

function contactSheet(tiles: { type: DiagramTypeDef; rendered: SvgResult }[]): string {
  const { columns, cellW, cellH, caption, gap } = SHEET;
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * cellW + (columns + 1) * gap;
  const height = rows * (cellH + caption) + (rows + 1) * gap;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#e9ecef"/>`,
  ];
  tiles.forEach(({ type, rendered }, index) => {
    const x = gap + (index % columns) * (cellW + gap);
    const y = gap + Math.floor(index / columns) * (cellH + caption + gap);
    parts.push(
      `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH + caption}" rx="6" fill="#ffffff"/>`,
      `<text x="${x + 12}" y="${y + 22}" font-family="IBM Plex Sans" font-size="15" font-weight="600" fill="#1c1f23">${escapeXml(type.name)}</text>`,
      `<text x="${x + cellW - 12}" y="${y + 22}" text-anchor="end" font-family="IBM Plex Mono" font-size="11" fill="#868e96">${escapeXml(`${type.id} · ${type.support}`)}</text>`,
      embed(rendered, x + 8, y + caption, cellW - 16, cellH - 8),
    );
  });
  parts.push("</svg>");
  return parts.join("");
}

async function main() {
  const args = process.argv.slice(2);
  const categories = new Set(args.filter((a) => a.startsWith("@")).map((a) => a.slice(1)));
  const ids = new Set(args.filter((a) => !a.startsWith("@")));
  const all = listDiagramTypes();
  const unknown = [...ids].filter((id) => !all.some((t) => t.id === id));
  if (unknown.length) console.warn(`Unknown type ids: ${unknown.join(", ")}`);
  const selected = args.length ? all.filter((t) => ids.has(t.id) || categories.has(t.category)) : all;

  mkdirSync(outDir, { recursive: true });
  const tiles = new Map<string, { type: DiagramTypeDef; rendered: SvgResult }[]>();
  let failures = 0;

  for (const type of selected) {
    if (!type.template) {
      console.log(`– ${type.id}: no template`);
      continue;
    }
    try {
      const { doc, warnings } = await instantiate(type);
      const page = exportPages(doc)[0];
      const rendered = renderSvg(page.scene, { bounds: page.view, padding: 0 });
      writeFileSync(path.join(outDir, `${type.id}.png`), toPng(rendered.svg, 2));
      const size = `${Math.round(rendered.width)}×${Math.round(rendered.height)}`;
      console.log(`${warnings.length ? "!" : "✓"} ${type.id}: ${Object.keys(doc.nodes).length} nodes, ${Object.keys(doc.edges).length} edges, ${size}`);
      for (const warning of warnings) console.log(`    warning: ${warning}`);
      if (warnings.length) failures++;
      const list = tiles.get(type.category) ?? [];
      list.push({ type, rendered });
      tiles.set(type.category, list);
    } catch (error) {
      failures++;
      console.log(`✗ ${type.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Contact sheets only when whole categories were rendered.
  const perSheet = SHEET.columns * SHEET.rows;
  for (const category of CATEGORIES) {
    const list = tiles.get(category.id);
    if (!list?.length || (ids.size > 0 && !categories.has(category.id))) continue;
    for (let page = 0; page * perSheet < list.length; page++) {
      const file = `_sheet-${category.id}${page ? `-${page + 1}` : ""}.png`;
      writeFileSync(path.join(outDir, file), toPng(contactSheet(list.slice(page * perSheet, (page + 1) * perSheet)), 1));
      console.log(`  sheet → .gallery/templates/${file}`);
    }
  }
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
