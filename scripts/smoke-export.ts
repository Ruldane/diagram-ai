/**
 * End-to-end smoke test of the core pipeline: spec → layout → SVG / PNG / PDF / PPTX.
 * Writes the results to `.gallery/smoke.*` for visual inspection.
 *
 *   npx tsx scripts/smoke-export.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { getDiagramType } from "../src/core/catalog";
import { exportPages } from "../src/core/export/pages";
import { renderPdf } from "../src/core/export/pdf";
import { renderPptx } from "../src/core/export/pptx";
import { loadElk } from "../src/core/layout/engine";
import { computeLayout } from "../src/core/layout/layout";
import { createDoc } from "../src/core/model/defaults";
import { applyPatch } from "../src/core/model/patch";
import { renderSvg } from "../src/core/render/svg";
import { applySpec } from "../src/core/spec/apply";
import { allFontVariants } from "../src/core/text/fonts";

const out = path.resolve(".gallery");
mkdirSync(out, { recursive: true });
const fontFiles = allFontVariants().map((v) => path.resolve("public", "fonts", v.file));
const fonts = Object.fromEntries(allFontVariants().map((v) => [v.file, readFileSync(path.resolve("public", "fonts", v.file)).toString("base64")]));

async function main() {
  const type = getDiagramType(process.argv[2] ?? "flowchart");
  let doc = createDoc({ name: `${type.name} smoke test`, type: type.id });
  const template = type.template!;
  const built = applySpec(doc, template, { defaultShape: type.defaultShape });
  if (built.warnings.length) console.log("warnings:", built.warnings);
  doc = applyPatch(doc, built.patch).doc;
  if (template.layout === "auto") doc = applyPatch(doc, await computeLayout(doc, type.layout, await loadElk())).doc;

  const pages = exportPages(doc);
  const { svg } = renderSvg(pages[0].scene, { bounds: pages[0].view, padding: 0 });
  writeFileSync(path.join(out, "smoke.svg"), svg);
  writeFileSync(
    path.join(out, "smoke.png"),
    new Resvg(svg, { fitTo: { mode: "zoom", value: 2 }, font: { fontFiles, loadSystemFonts: false } }).render().asPng(),
  );
  writeFileSync(path.join(out, "smoke.pdf"), Buffer.from(await renderPdf(pages, { fonts })));
  writeFileSync(path.join(out, "smoke-a4.pdf"), Buffer.from(await renderPdf(pages, { fonts, pageSize: "a4" })));
  writeFileSync(path.join(out, "smoke.pptx"), Buffer.from(await renderPptx(pages)));
  console.log(`✓ ${Object.keys(doc.nodes).length} nodes, ${Object.keys(doc.edges).length} edges → .gallery/smoke.{svg,png,pdf,pptx}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
