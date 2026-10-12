import { describe, expect, it } from "vitest";

import { routeEdge, routeEdges } from "./edges/geometry";
import { exportPages } from "./export/pages";
import { renderPdf } from "./export/pdf";
import { renderPptx } from "./export/pptx";
import { parseSvgPath, pathBounds, pointInPath, rectPath } from "./geometry/path";
import { loadElk } from "./layout/engine";
import { computeLayout } from "./layout/layout";
import { placeNear } from "./layout/place";
import { createDoc } from "./model/defaults";
import { applyPatch } from "./model/patch";
import { nodeBounds } from "./model/queries";
import type { DEdge, DiagramDoc, DNode } from "./model/types";
import { buildScene } from "./render/scene";
import { renderSvg } from "./render/svg";
import { applySpec } from "./spec/apply";
import { buildSequence } from "./spec/sequence";
import { layoutText, wrapText } from "./text/layout";
import { measureText } from "./text/measure";

const node = (id: string, x: number, y: number, extra: Partial<DNode> = {}): DNode => ({ id, shape: "basic/rect", x, y, w: 120, h: 60, z: 1, ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<DEdge> = {}): DEdge => ({
  id,
  from: { node: from },
  to: { node: to },
  routing: "orthogonal",
  ...extra,
});

function docWith(nodes: DNode[], edges: DEdge[] = []): DiagramDoc {
  return applyPatch(createDoc(), { nodes: { set: nodes }, edges: { set: edges } }).doc;
}

const overlaps = (a: DNode, b: DNode): boolean => {
  const p = nodeBounds(a);
  const q = nodeBounds(b);
  return p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
};

describe("geometry", () => {
  it("parses SVG paths with arcs, relative commands and glued arc flags", () => {
    const circle = parseSvgPath("M2 12a10 10 0 1020 0a10 10 0 10-20 0z");
    const bounds = pathBounds(circle)!;
    expect(bounds.x).toBeCloseTo(2, 1);
    expect(bounds.w).toBeCloseTo(20, 1);
    expect(bounds.h).toBeCloseTo(20, 1);
    expect(pointInPath(circle, { x: 12, y: 12 })).toBe(true);
    expect(pointInPath(circle, { x: 2.5, y: 2.5 })).toBe(false);
  });

  it("rounded rectangles stay inside their box", () => {
    expect(pathBounds(rectPath(10, 20, 100, 40, 12))).toEqual({ x: 10, y: 20, w: 100, h: 40 });
  });
});

describe("text", () => {
  const font = { family: "sans", size: 14 } as const;

  it("measures deterministically and scales with font size", () => {
    const width = measureText("Diagram", font);
    expect(width).toBeGreaterThan(30);
    expect(measureText("Diagram", { ...font, size: 28 })).toBeCloseTo(width * 2, 5);
    expect(measureText("Diagram", { ...font, bold: true })).toBeGreaterThan(width);
  });

  it("wraps at word boundaries, keeps explicit newlines and breaks very long words", () => {
    const lines = wrapText("The quick brown fox jumps over the lazy dog", font, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measureText(line, font)).toBeLessThanOrEqual(120);
    expect(wrapText("one\ntwo", font, 500)).toEqual(["one", "two"]);
    expect(wrapText("Supercalifragilisticexpialidocious", font, 60).length).toBeGreaterThan(2);
  });

  it("centres text vertically in its box", () => {
    const layout = layoutText({ text: "A\nB", font, box: { x: 0, y: 0, w: 200, h: 100 } });
    expect(layout.bounds.y + layout.bounds.h / 2).toBeCloseTo(50, 5);
    expect(layout.anchor).toBe("middle");
  });
});

describe("connector routing", () => {
  it("orthogonal routes are axis-aligned and end on the node borders", () => {
    const doc = docWith([node("a", 0, 0), node("b", 300, 200)], [edge("e", "a", "b")]);
    const { points, start, end } = routeEdges(doc).get("e")!;
    for (let i = 0; i < points.length - 1; i++) {
      expect(Math.min(Math.abs(points[i].x - points[i + 1].x), Math.abs(points[i].y - points[i + 1].y))).toBeLessThan(0.5);
    }
    // Diagonal placement follows the diagram's flow (top-down by default): bottom of a → top of b.
    expect(start.y).toBeCloseTo(60, 3);
    expect(end.y).toBeCloseTo(200, 3);
  });

  it("clips straight connectors to the real outline of non-rectangular shapes", () => {
    const doc = docWith([node("a", 0, 0, { shape: "basic/ellipse", w: 100, h: 100 }), node("b", 300, 300, { shape: "basic/diamond", w: 100, h: 100 })]);
    const geometry = routeEdge(edge("e", "a", "b", { routing: "straight" }), doc.nodes);
    // On the circle of radius 50 around (50, 50).
    expect(Math.hypot(geometry.start.x - 50, geometry.start.y - 50)).toBeCloseTo(50, 0);
    // Inside the diamond's bounding box but not at its corner.
    expect(geometry.end.x).toBeGreaterThan(300);
    expect(geometry.end.x).toBeLessThan(350);
  });

  it("fans out connectors that share a side instead of stacking them", () => {
    const doc = docWith(
      [node("hub", 0, 100), node("x", 300, 0), node("y", 300, 100), node("z", 300, 200)],
      [edge("e1", "hub", "x"), edge("e2", "hub", "y"), edge("e3", "hub", "z")],
    );
    const routes = routeEdges(doc);
    const starts = ["e1", "e2", "e3"].map((id) => routes.get(id)!.start.y);
    expect(new Set(starts.map((y) => Math.round(y))).size).toBe(3);
    expect(starts).toEqual([...starts].sort((p, q) => p - q));
  });

  it("draws a loop for a connector from a node to itself and tolerates missing nodes", () => {
    const doc = docWith([node("a", 0, 0)]);
    expect(routeEdge(edge("loop", "a", "a"), doc.nodes).points.length).toBeGreaterThan(3);
    expect(() => routeEdge(edge("dangling", "a", "ghost"), doc.nodes)).not.toThrow();
  });
});

describe("spec builder (what agents send)", () => {
  it("creates sized nodes with readable ids, resolves aliases and palette colours", () => {
    const { patch, created, warnings, unplaced } = applySpec(createDoc(), {
      nodes: [{ text: "Auth Service" }, { id: "db", shape: "database", text: "Users", color: "green" }],
      edges: [{ from: "auth-service", to: "db", kind: "dashed", text: "reads" }],
    });
    expect(warnings).toEqual([]);
    expect(created.nodes).toEqual(["auth-service", "db"]);
    expect(unplaced).toHaveLength(2);
    const db = patch.nodes!.set!.find((n) => n.id === "db")!;
    expect(db.shape).toBe("basic/cylinder");
    expect(db.style?.fill).toBe("#e4f5e6");
    expect(patch.edges!.set![0].style).toMatchObject({ dash: "dashed", endMarker: "arrow" });
  });

  it("grows nodes to fit long labels", () => {
    const { patch } = applySpec(createDoc(), { nodes: [{ id: "n", text: "A deliberately long label that cannot fit in the default box" }] });
    const sized = patch.nodes!.set![0];
    // Wider than the default 140px box, and wrapped rather than one very long line.
    expect(sized.w).toBeGreaterThan(140);
    expect(sized.w).toBeLessThanOrEqual(260);
  });

  it("reports recoverable problems as warnings instead of failing", () => {
    const { warnings, created } = applySpec(createDoc(), {
      nodes: [{ id: "a", shape: "definitely-not-a-shape" }, { id: "b", parent: "a" }],
      edges: [{ from: "a", to: "nowhere" }, { from: "a", to: "b", kind: "telepathy" }],
    });
    expect(created.nodes).toEqual(["a", "b"]);
    expect(created.edges).toHaveLength(1);
    expect(warnings.join("\n")).toMatch(/unknown shape/);
    expect(warnings.join("\n")).toMatch(/not a container/);
    expect(warnings.join("\n")).toMatch(/unknown node id/);
    expect(warnings.join("\n")).toMatch(/unknown kind/);
  });

  it("update mode merges fields and rejects unknown ids", () => {
    const doc = applyPatch(createDoc(), applySpec(createDoc(), { nodes: [{ id: "a", text: "Old", color: "blue" }] }).patch).doc;
    const result = applySpec(doc, { nodes: [{ id: "a", text: "New" }, { id: "ghost", text: "?" }] }, { mode: "update" });
    const updated = result.patch.nodes!.set![0];
    expect(updated.text).toBe("New");
    expect(updated.style?.fill).toBe("#e5efff");
    expect(result.updated.nodes).toEqual(["a"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("create mode refuses to overwrite an existing element", () => {
    const doc = applyPatch(createDoc(), applySpec(createDoc(), { nodes: [{ id: "a", text: "Keep me" }] }).patch).doc;
    const result = applySpec(doc, { nodes: [{ id: "a", text: "Overwrite" }] }, { mode: "create" });
    expect(result.patch.nodes).toBeUndefined();
    expect(result.warnings[0]).toMatch(/already exists/);
  });
});

describe("layout", () => {
  it("arranges a flow without overlaps, respecting the direction", async () => {
    let doc = createDoc();
    doc = applyPatch(doc, applySpec(doc, { nodes: ["a", "b", "c", "d"].map((id) => ({ id, text: id })), edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }] }).patch).doc;
    doc = applyPatch(doc, await computeLayout(doc, { algorithm: "layered", direction: "right" }, await loadElk())).doc;
    const nodes = Object.values(doc.nodes);
    for (const p of nodes) for (const q of nodes) if (p.id < q.id) expect(overlaps(p, q), `${p.id} overlaps ${q.id}`).toBe(false);
    expect(doc.nodes.a.x).toBeLessThan(doc.nodes.b.x);
    expect(doc.nodes.b.x).toBeLessThan(doc.nodes.d.x);
    expect(doc.settings.autoLayout).toBe(true);
  });

  it("arranging only some nodes leaves the diagram's layout settings alone", async () => {
    let doc = createDoc();
    doc = applyPatch(doc, applySpec(doc, { nodes: ["a", "b", "c"].map((id) => ({ id, text: id })), edges: [{ from: "a", to: "b" }] }).patch).doc;
    const before = doc.settings;
    const patch = await computeLayout(doc, { algorithm: "grid", direction: "right" }, await loadElk(), { ids: new Set(["a", "b"]) });
    expect(patch.doc).toBeUndefined();
    expect(applyPatch(doc, patch).doc.settings).toEqual(before);
    expect(patch.nodes?.set?.some((n) => n.id === "c")).toBeFalsy();
  });

  it("grows containers around their children", async () => {
    let doc = createDoc();
    doc = applyPatch(doc, applySpec(doc, { nodes: [{ id: "g", shape: "group", text: "Group" }, { id: "a", text: "A", parent: "g" }, { id: "b", text: "B", parent: "g" }, { id: "out", text: "Outside" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "out" }] }).patch).doc;
    doc = applyPatch(doc, await computeLayout(doc, { algorithm: "layered", direction: "down" }, await loadElk())).doc;
    const group = nodeBounds(doc.nodes.g);
    for (const id of ["a", "b"]) {
      const child = nodeBounds(doc.nodes[id]);
      expect(child.x).toBeGreaterThanOrEqual(group.x);
      expect(child.y).toBeGreaterThanOrEqual(group.y);
      expect(child.x + child.w).toBeLessThanOrEqual(group.x + group.w);
      expect(child.y + child.h).toBeLessThanOrEqual(group.y + group.h);
    }
    expect(overlaps(doc.nodes.out, doc.nodes.g)).toBe(false);
  });

  it("places new nodes beside their neighbours without moving existing ones", () => {
    const base = docWith([node("a", 0, 0), node("b", 0, 200)], [edge("e", "a", "b")]);
    const staged = applyPatch(base, { nodes: { set: [node("c", 900, 900)] }, edges: { set: [edge("e2", "a", "c")] } }).doc;
    const patch = placeNear(staged, ["c"]);
    const placed = patch.nodes!.set![0];
    expect(patch.nodes!.set).toHaveLength(1);
    expect(placed.y).toBeGreaterThan(60);
    expect(overlaps(placed, staged.nodes.b)).toBe(false);
  });
});

describe("regressions", () => {
  it("lays out a graph that contains a node called 'root'", async () => {
    let doc = createDoc();
    doc = applyPatch(doc, applySpec(doc, { nodes: [{ id: "root", text: "Root" }, { id: "child", text: "Child" }], edges: [{ from: "root", to: "child" }] }).patch).doc;
    for (const algorithm of ["layered", "tree", "force", "radial"] as const) {
      const patch = await computeLayout(doc, { algorithm, direction: "down" }, await loadElk());
      expect(patch.nodes?.set?.length ?? 0, algorithm).toBeGreaterThan(0);
    }
  });

  it("keeps layout-routed connectors straight: end points stay exactly on the node border", async () => {
    let doc = createDoc();
    // Labels and mixed widths make ELK produce fractional coordinates.
    doc = applyPatch(doc, applySpec(doc, { nodes: [{ id: "a", text: "Reserve stock" }, { id: "b", shape: "decision", text: "In stock?" }, { id: "c", text: "Confirm the order with the customer" }, { id: "d", shape: "terminator", text: "End" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c", text: "Yes" }, { from: "b", to: "d", text: "No" }, { from: "c", to: "d" }] }).patch).doc;
    doc = applyPatch(doc, await computeLayout(doc, { algorithm: "layered", direction: "down" }, await loadElk())).doc;
    for (const item of Object.values(doc.edges)) {
      expect(item.autoRoute, item.id).toBe(true);
      for (const end of [item.from, item.to]) {
        const at = end.anchor as { x: number; y: number };
        expect([0, 1].includes(at.x) || [0, 1].includes(at.y), `${item.id} anchor ${JSON.stringify(at)} is off the border`).toBe(true);
      }
    }
    // A connector between vertically aligned nodes is a single straight segment, with no hook.
    const straight = Object.values(doc.edges).find((item) => !item.waypoints);
    if (straight) expect(routeEdges(doc).get(straight.id)!.points).toHaveLength(2);
  });

  it("a re-layout keeps anchors the author chose and drops routes it computed earlier", async () => {
    let doc = docWith([node("a", 0, 0), node("b", 0, 300)], [edge("chosen", "a", "b", { from: { node: "a", anchor: { x: 1, y: 0.5 } } }), edge("auto", "a", "b")]);
    doc = applyPatch(doc, await computeLayout(doc, { algorithm: "layered", direction: "down" }, await loadElk())).doc;
    expect(doc.edges.auto.autoRoute).toBe(true);
    doc = applyPatch(doc, await computeLayout(doc, { algorithm: "force", direction: "down" }, await loadElk())).doc;
    expect(doc.edges.auto.autoRoute).toBeUndefined();
    expect(doc.edges.auto.from.anchor).toBeUndefined();
  });

  it("never wraps a connector label narrower than it was measured", () => {
    for (const label of ["Pass", "close", "U(s)", "happens in", "Yes", "publishes"]) {
      const doc = docWith([node("a", 0, 0), node("b", 400, 0)], [edge("e", "a", "b", { text: label })]);
      const labels = buildScene(doc).layers.find((layer) => layer.kind === "edge-labels")!.prims;
      const prim = labels[0];
      if (prim.kind !== "text") throw new Error("expected a text primitive");
      expect(layoutText(prim).lines.map((line) => line.text), label).toEqual([label]);
    }
  });

  it("follows the diagram's flow direction for diagonally placed nodes", () => {
    const nodes = [node("parent", 0, 0), node("child", 600, 200)];
    const vertical = routeEdges({ ...docWith(nodes, [edge("e", "parent", "child")]), settings: { layout: { algorithm: "tree", direction: "down" } } });
    // Leaves from the bottom of the parent rather than from its side.
    expect(vertical.get("e")!.start.y).toBeCloseTo(60, 3);
  });
});

describe("sequence builder", () => {
  it("orders messages top to bottom and resolves participants by name or id", () => {
    const { patch, warnings } = buildSequence({
      participants: [{ id: "u", name: "User", kind: "actor" }, { name: "API" }],
      messages: [{ from: "u", to: "API", text: "request" }, { from: "API", to: "u", text: "response", kind: "return" }, { from: "API", to: "ghost" }],
    });
    expect(warnings).toHaveLength(1);
    const [first, second] = patch.edges!.set!;
    const y = (e: DEdge) => (typeof e.from.anchor === "object" ? e.from.anchor.y : 0);
    expect(y(second)).toBeGreaterThan(y(first));
    expect(second.style?.dash).toBe("dashed");
    expect(patch.nodes!.set!.map((n) => n.shape)).toEqual(["uml/actor-lifeline", "uml/lifeline"]);
  });
});

describe("export", () => {
  async function exampleDoc(): Promise<DiagramDoc> {
    let doc = createDoc({ name: "Export test" });
    doc = applyPatch(doc, applySpec(doc, { nodes: [{ id: "frame", shape: "frame", text: "Page one" }, { id: "a", text: "Alpha & <Beta>", parent: "frame" }, { id: "b", shape: "decision", text: "Ok?", parent: "frame" }, { id: "c", shape: "database", text: "Store", color: "green" }], edges: [{ from: "a", to: "b", text: "check" }, { from: "b", to: "c", kind: "dashed" }] }).patch).doc;
    return applyPatch(doc, await computeLayout(doc, { algorithm: "layered", direction: "down" }, await loadElk())).doc;
  }

  it("renders well-formed, escaped SVG whose viewBox contains every element", async () => {
    const doc = await exampleDoc();
    const scene = buildScene(doc);
    const { svg, viewBox } = renderSvg(scene, { padding: 20 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Alpha &amp; &lt;Beta&gt;");
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    for (const item of Object.values(doc.nodes)) {
      const box = nodeBounds(item);
      expect(box.x).toBeGreaterThanOrEqual(viewBox.x);
      expect(box.y + box.h).toBeLessThanOrEqual(viewBox.y + viewBox.h);
    }
  });

  it("splits into one page per frame, and exports only the selection when asked", async () => {
    const doc = await exampleDoc();
    const frames = exportPages(doc, { kind: "frames" });
    expect(frames).toHaveLength(1);
    expect(frames[0].name).toBe("Page one");
    expect(frames[0].scene.layers.some((layer) => layer.id === "c")).toBe(false);
    const selection = exportPages(doc, { kind: "selection", ids: ["c"] });
    expect(selection[0].scene.layers.map((layer) => layer.id)).toEqual(["c"]);
  });

  it("writes a vector PDF sized to the diagram, or fitted to a sheet", async () => {
    const pages = exportPages(await exampleDoc());
    const fit = new Uint8Array(await renderPdf(pages));
    expect(new TextDecoder().decode(fit.slice(0, 5))).toBe("%PDF-");
    const a4 = new TextDecoder("latin1").decode(new Uint8Array(await renderPdf(pages, { pageSize: "a4" })));
    // A4 in points, portrait for this tall diagram.
    expect(a4).toMatch(/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
  });

  it("writes a PowerPoint file (a zip archive) with editable shapes", async () => {
    const data = await renderPptx(exportPages(await exampleDoc()));
    expect(data[0]).toBe(0x50);
    expect(data[1]).toBe(0x4b);
    expect(data.length).toBeGreaterThan(5000);
  });
});
