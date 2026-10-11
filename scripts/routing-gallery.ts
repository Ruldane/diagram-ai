/**
 * Renders connector-routing scenarios to PNG so routes can be judged by eye.
 *
 *   npx tsx scripts/routing-gallery.ts                 → every scenario
 *   npx tsx scripts/routing-gallery.ts wall hub        → only these
 *   npx tsx scripts/routing-gallery.ts --before        → also render what the old heuristic drew (`<name>-before.png`)
 *   npx tsx scripts/routing-gallery.ts --templates     → add a few catalog templates with their layout routes replaced by live routing
 *
 * Output goes to `.gallery/routing/` (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { getDiagramType } from "../src/core/catalog";
import { nodeBox, routeEdges } from "../src/core/edges/geometry";
import { legacyRoute, scenarios, type Scenario } from "../src/core/edges/router.fixtures";
import { loadElk } from "../src/core/layout/engine";
import { computeLayout } from "../src/core/layout/layout";
import { createDoc } from "../src/core/model/defaults";
import { applyPatch } from "../src/core/model/patch";
import type { DEdge, DiagramDoc, Point } from "../src/core/model/types";
import { buildScene } from "../src/core/render/scene";
import { renderSvg } from "../src/core/render/svg";
import { applySpec } from "../src/core/spec/apply";
import { allFontVariants } from "../src/core/text/fonts";

const args = process.argv.slice(2);
const before = args.includes("--before");
const withTemplates = args.includes("--templates");
const wanted = args.filter((a) => !a.startsWith("--"));
const outDir = path.resolve(".gallery", "routing");
const fontFiles = allFontVariants().map((v) => path.resolve("public", "fonts", v.file));

const toPng = (doc: DiagramDoc): Buffer => {
  const { svg } = renderSvg(buildScene(doc), { padding: 36 });
  return new Resvg(svg, {
    fitTo: { mode: "zoom", value: 2 },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "IBM Plex Sans" },
  })
    .render()
    .asPng();
};

const unit = (a: Point, b: Point): Point => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
};

/** The same document with every live-routed connector replaced by what the old heuristic would have drawn. */
function withLegacyRoutes(doc: DiagramDoc): DiagramDoc {
  const routes = routeEdges(doc);
  const edges: Record<string, DEdge> = {};
  for (const edge of Object.values(doc.edges)) {
    const a = edge.from.node ? doc.nodes[edge.from.node] : undefined;
    const b = edge.to.node ? doc.nodes[edge.to.node] : undefined;
    const geometry = routes.get(edge.id);
    if (edge.routing !== "orthogonal" || edge.waypoints?.length || !geometry || !a || !b || a === b) {
      edges[edge.id] = edge;
      continue;
    }
    const p = geometry.points;
    const route = legacyRoute(p[0], unit(p[0], p[1]), p[p.length - 1], unit(p[p.length - 1], p[p.length - 2]), [nodeBox(a), nodeBox(b)]);
    const anchor = (point: Point, node: typeof a) => ({
      x: Math.min(1, Math.max(0, (point.x - node.x) / node.w)),
      y: Math.min(1, Math.max(0, (point.y - node.y) / node.h)),
    });
    edges[edge.id] = {
      ...edge,
      from: { node: a.id, anchor: anchor(route[0], a) },
      to: { node: b.id, anchor: anchor(route[route.length - 1], b) },
      // No bend points means "route me": a straight run is drawn as a straight connector instead.
      ...(route.length > 2 ? { waypoints: route.slice(1, -1) } : { routing: "straight" as const }),
    };
  }
  return { ...doc, edges };
}

/** A layered layout of a catalog template, then one extra connector added afterwards (what an agent does). */
async function layoutPlusEdge(): Promise<Scenario> {
  let doc = createDoc();
  const spec = {
    nodes: ["gateway", "auth", "orders", "billing", "catalog", "search", "db", "queue", "mailer"].map((id) => ({ id, text: id })),
    edges: [
      { from: "gateway", to: "auth" },
      { from: "gateway", to: "orders" },
      { from: "gateway", to: "catalog" },
      { from: "orders", to: "billing" },
      { from: "orders", to: "queue" },
      { from: "catalog", to: "search" },
      { from: "billing", to: "db" },
      { from: "queue", to: "mailer" },
      { from: "auth", to: "db" },
    ],
  };
  doc = applyPatch(doc, applySpec(doc, spec).patch).doc;
  doc = applyPatch(doc, await computeLayout(doc, { algorithm: "layered", direction: "down" }, await loadElk())).doc;
  // The agent adds connectors after the layout: no stored route, so they are routed live around everything.
  const extra: DEdge[] = [
    { id: "late1", from: { node: "mailer" }, to: { node: "gateway" }, routing: "orthogonal", style: { stroke: "#d6336c" } },
    { id: "late2", from: { node: "search" }, to: { node: "auth" }, routing: "orthogonal", style: { stroke: "#d6336c" } },
  ];
  doc = applyPatch(doc, { edges: { set: extra } }).doc;
  return { name: "layout-plus-edges", title: "Layered layout with two connectors added afterwards (red)", doc };
}

async function templateScenario(typeId: string): Promise<Scenario> {
  const type = getDiagramType(typeId);
  let doc = createDoc({ name: type.name, type: type.id, settings: { routing: type.routing, layout: type.layout } });
  const built = applySpec(doc, type.template!, { mode: "create", defaultShape: type.defaultShape });
  doc = applyPatch(doc, built.patch).doc;
  if (type.template!.layout === "auto") doc = applyPatch(doc, await computeLayout(doc, type.layout, await loadElk())).doc;
  // Drop stored routes: the whole diagram is routed live, the hardest case for the router.
  const edges: Record<string, DEdge> = {};
  for (const edge of Object.values(doc.edges)) {
    const { waypoints, autoRoute, ...rest } = edge;
    void waypoints;
    void autoRoute;
    edges[edge.id] = { ...rest, from: { node: edge.from.node }, to: { node: edge.to.node } };
  }
  return { name: `live-${typeId}`, title: `${type.name}, every connector routed live`, doc: { ...doc, edges } };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const all: Scenario[] = [...scenarios(), await layoutPlusEdge()];
  if (withTemplates) {
    for (const id of ["c4-container", "uml-activity", "cloud-architecture", "microservices", "data-flow-diagram"]) all.push(await templateScenario(id));
  }
  for (const scenario of all) {
    if (wanted.length && !wanted.includes(scenario.name)) continue;
    const started = performance.now();
    const routes = routeEdges(scenario.doc);
    const ms = performance.now() - started;
    const bends = [...routes.values()].reduce((sum, g) => sum + Math.max(0, g.points.length - 2), 0);
    writeFileSync(path.join(outDir, `${scenario.name}.png`), toPng(scenario.doc));
    if (before) writeFileSync(path.join(outDir, `${scenario.name}-before.png`), toPng(withLegacyRoutes(scenario.doc)));
    console.log(`✓ ${scenario.name}: ${Object.keys(scenario.doc.edges).length} connectors, ${bends} interior points, ${ms.toFixed(1)} ms — ${scenario.title}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
