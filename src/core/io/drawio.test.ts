import { describe, expect, it } from "vitest";

import { createDoc } from "../model/defaults";
import { applyPatch } from "../model/patch";
import type { DEdge, DiagramDoc, DNode } from "../model/types";
import { resolveShape } from "../shapes/registry";
import { applySpec } from "../spec/apply";
import { DRAWIO_MAPPED_SHAPES, exportDrawio, importDrawio } from "./drawio";
import { descendantsNamed, findElement, firstChild, parseXml, type XmlElement } from "./xml";

/* ----------------------------------------------------------------- fixtures */

const NODES: DNode[] = [
  { id: "frame", shape: "basic/frame", x: 40, y: 40, w: 420, h: 300, z: -1, text: "Checkout" },
  { id: "start", shape: "basic/rect", x: 80, y: 100, w: 140, h: 60, z: 1, parent: "frame", text: "Receive\norder" },
  { id: "check", shape: "flowchart/decision", x: 280, y: 90, w: 150, h: 100, z: 2, parent: "frame", text: "In stock?" },
  {
    id: "db",
    shape: "basic/cylinder",
    x: 560,
    y: 80,
    w: 100,
    h: 110,
    z: 3,
    text: 'Orders & "stock" <db>',
    style: { fill: "#e5efff", stroke: "#2f6fed", strokeWidth: 2, dash: "dashed", bold: true, italic: true, fontFamily: "mono", opacity: 0.5, shadow: true },
    rotation: 15,
    link: "https://example.com/db?a=1&b=2",
    note: "Primary store",
  },
];

const EDGES: DEdge[] = [
  {
    id: "e1",
    from: { node: "start" },
    to: { node: "check" },
    routing: "orthogonal",
    text: "validate",
    startText: "1",
    endText: "0..*",
    waypoints: [
      { x: 250, y: 130 },
      { x: 250, y: 140 },
    ],
    style: { startMarker: "diamond", endMarker: "triangle-open", dash: "dashed", stroke: "#e03131", strokeWidth: 2 },
  },
  { id: "e2", from: { node: "check", anchor: { x: 1, y: 0.5 } }, to: { node: "db", anchor: { x: 0.5, y: 0.25 } }, routing: "straight" },
];

function makeDoc(nodes: DNode[] = NODES, edges: DEdge[] = EDGES): DiagramDoc {
  const doc = createDoc({ id: "doc1", name: 'Orders "v2" <draft>' }, new Date(0));
  return applyPatch(doc, { nodes: { set: nodes }, edges: { set: edges } }).doc;
}

const cellsOf = (xml: string): XmlElement[] => descendantsNamed(parseXml(xml), "mxCell");
const cell = (cells: XmlElement[], id: string): XmlElement => {
  const found = cells.find((candidate) => candidate.attrs.id === id);
  if (!found) throw new Error(`no cell ${id}`);
  return found;
};
const geometry = (element: XmlElement): Record<string, string> => firstChild(element, "mxGeometry")!.attrs;

/** Applies an imported spec to an empty document, the way the app does. */
function materialise(spec: Parameters<typeof applySpec>[1]): { doc: DiagramDoc; warnings: string[] } {
  const empty = createDoc({ id: "imported" }, new Date(0));
  const result = applySpec(empty, spec);
  return { doc: applyPatch(empty, result.patch).doc, warnings: result.warnings };
}

/* ------------------------------------------------------------------- export */

describe("exportDrawio", () => {
  const xml = exportDrawio(makeDoc());
  const cells = cellsOf(xml);

  it("writes a complete, uncompressed mxfile", () => {
    const root = parseXml(xml);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<mxfile ')).toBe(true);
    expect(root.name).toBe("mxfile");
    expect(firstChild(root, "diagram")?.attrs).toMatchObject({ id: "doc1", name: 'Orders "v2" <draft>' });
    expect(findElement(root, "mxGraphModel")?.attrs).toMatchObject({ grid: "1", gridSize: "10", background: "#ffffff" });
    expect(xml).toContain('name="Orders &quot;v2&quot; &lt;draft&gt;"');
  });

  it("emits the root cells, one vertex per node and one edge per edge", () => {
    expect(cells[0].attrs).toEqual({ id: "0" });
    expect(cells[1].attrs).toEqual({ id: "1", parent: "0" });
    const vertices = cells.filter((c) => c.attrs.vertex === "1" && c.attrs.connectable !== "0");
    const edges = cells.filter((c) => c.attrs.edge === "1");
    const labels = cells.filter((c) => c.attrs.connectable === "0");
    expect(vertices).toHaveLength(4);
    expect(edges).toHaveLength(2);
    expect(labels).toHaveLength(2);
    expect(cells).toHaveLength(2 + 4 + 2 + 2);
  });

  it("maps shapes to draw.io styles", () => {
    expect(cell(cells, "start").attrs.style).toMatch(/^rounded=0;whiteSpace=wrap;html=1;/);
    expect(cell(cells, "check").attrs.style).toMatch(/^rhombus;/);
    expect(cell(cells, "frame").attrs.style).toMatch(/^swimlane;startSize=32;/);
    expect(cell(cells, "frame").attrs.style).toContain("swimlaneFillColor=#fafafa;");
    expect(cell(cells, "frame").attrs.style).toContain("rounded=1;absoluteArcSize=1;arcSize=20;");
  });

  it("carries node styling", () => {
    // The node with link + note is wrapped in a UserObject that owns the id and label.
    const wrapper = descendantsNamed(parseXml(xml), "UserObject")[0];
    expect(wrapper.attrs).toMatchObject({ id: "db", link: "https://example.com/db?a=1&b=2", tooltip: "Primary store" });
    const style = firstChild(wrapper, "mxCell")!.attrs.style;
    for (const part of [
      "shape=cylinder3;",
      "fillColor=#e5efff;",
      "strokeColor=#2f6fed;",
      "strokeWidth=2;",
      "dashed=1;",
      "fontFamily=IBM Plex Mono;",
      "fontSize=14;",
      "fontStyle=3;",
      "align=center;",
      "verticalAlign=middle;",
      "opacity=50;",
      "shadow=1;",
      "rotation=15;",
    ]) {
      expect(style, part).toContain(part);
    }
  });

  it("escapes labels as HTML inside XML", () => {
    expect(cell(cells, "start").attrs.value).toBe("Receive<br>order");
    expect(xml).toContain('value="Receive&lt;br&gt;order"');
    const wrapper = descendantsNamed(parseXml(xml), "UserObject")[0];
    expect(wrapper.attrs.label).toBe("Orders &amp; \"stock\" &lt;db&gt;");
  });

  it("nests children with parent-relative geometry", () => {
    expect(cell(cells, "frame").attrs.parent).toBe("1");
    expect(geometry(cell(cells, "frame"))).toMatchObject({ x: "40", y: "40", width: "420", height: "300" });
    expect(cell(cells, "start").attrs.parent).toBe("frame");
    expect(geometry(cell(cells, "start"))).toMatchObject({ x: "40", y: "60", width: "140", height: "60" });
    expect(geometry(cell(cells, "check"))).toMatchObject({ x: "240", y: "50" });
    const order = cells.map((c) => c.attrs.id);
    expect(order.indexOf("frame")).toBeLessThan(order.indexOf("start"));
  });

  it("wires edges with routing, markers, labels and waypoints", () => {
    const edge = cell(cells, "e1");
    expect(edge.attrs).toMatchObject({ source: "start", target: "check", parent: "1", value: "validate" });
    for (const part of [
      "edgeStyle=orthogonalEdgeStyle;",
      "startArrow=diamond;",
      "startFill=1;",
      "endArrow=block;",
      "endFill=0;",
      "dashed=1;",
      "strokeColor=#e03131;",
      "strokeWidth=2;",
    ]) {
      expect(edge.attrs.style, part).toContain(part);
    }
    const points = firstChild(firstChild(edge, "mxGeometry")!, "Array")!;
    expect(points.attrs.as).toBe("points");
    expect(points.children.map((p) => p.attrs)).toEqual([
      { x: "250", y: "130" },
      { x: "250", y: "140" },
    ]);

    const [startLabel, endLabel] = cells.filter((c) => c.attrs.connectable === "0");
    expect(startLabel.attrs).toMatchObject({ value: "1", parent: "e1", vertex: "1" });
    expect(geometry(startLabel)).toMatchObject({ x: "-0.8", relative: "1" });
    expect(endLabel.attrs.value).toBe("0..*");
    expect(geometry(endLabel).x).toBe("0.8");
  });

  it("writes fixed anchors, keeping interior ones off the perimeter", () => {
    const style = cell(cells, "e2").attrs.style;
    expect(style).toContain("edgeStyle=none;");
    expect(style).toContain("exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.5;entryY=0.25;entryDx=0;entryDy=0;entryPerimeter=0;");
    expect(style).not.toContain("exitPerimeter");
    expect(style).toContain("startArrow=none;endArrow=classic;endFill=1;");
  });

  it("writes free ends as source and target points", () => {
    const free: DEdge = { id: "free", from: { point: { x: 10, y: 20 } }, to: { node: "ghost", point: { x: 30, y: 40 } }, routing: "curved" };
    const edge = cell(cellsOf(exportDrawio(makeDoc(NODES, [free]))), "free");
    expect(edge.attrs.source).toBeUndefined();
    expect(edge.attrs.target).toBeUndefined();
    expect(edge.attrs.style).toContain("curved=1;");
    expect(firstChild(edge, "mxGeometry")!.children.map((p) => p.attrs)).toEqual([
      { x: "10", y: "20", as: "sourcePoint" },
      { x: "30", y: "40", as: "targetPoint" },
    ]);
  });

  it("turns section breaks into horizontal rules and tables into HTML tables", () => {
    const nodes: DNode[] = [
      { id: "cls", shape: "uml/class", x: 0, y: 0, w: 160, h: 120, z: 1, text: "Order\n---\n+ id: UUID\n+ total: Money\n---\n+ submit()" },
      { id: "tbl", shape: "basic/table", x: 0, y: 200, w: 200, h: 64, z: 2, text: "Name | Type\nid | uuid" },
    ];
    const out = cellsOf(exportDrawio(makeDoc(nodes, [])));
    expect(cell(out, "cls").attrs.value).toBe("Order<hr>+ id: UUID<br>+ total: Money<hr>+ submit()");
    expect(cell(out, "tbl").attrs.value).toContain("<tr><th>Name</th><th>Type</th></tr><tr><td>id</td><td>uuid</td></tr>");
  });

  it("sizes slanted shapes from the node box, like our own shapes do", () => {
    const nodes: DNode[] = [
      { id: "hex", shape: "basic/hexagon", x: 0, y: 0, w: 120, h: 80, z: 1 },
      { id: "io", shape: "flowchart/data", x: 0, y: 100, w: 400, h: 60, z: 2 },
    ];
    const out = cellsOf(exportDrawio(makeDoc(nodes, [])));
    expect(cell(out, "hex").attrs.style).toMatch(/^shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=26\.4;/);
    expect(cell(out, "io").attrs.style).toMatch(/^shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;size=30;/);
  });

  it("falls back to a rectangle for unmapped shapes and a swimlane for unmapped containers", () => {
    const nodes: DNode[] = [
      { id: "odd", shape: "nope/unknown", x: 0, y: 0, w: 100, h: 50, z: 1, text: "Odd", style: { radius: 8 } },
      { id: "vpc", shape: "infra/vpc", x: 0, y: 100, w: 300, h: 200, z: 0, text: "VPC" },
    ];
    const out = cellsOf(exportDrawio(makeDoc(nodes, [])));
    expect(cell(out, "odd").attrs.style).toMatch(/^rounded=1;absoluteArcSize=1;arcSize=16;whiteSpace=wrap;html=1;/);
    expect(cell(out, "odd").attrs.value).toBe("Odd");
    expect(cell(out, "vpc").attrs.style).toMatch(/^swimlane;startSize=\d+;/);
    expect(DRAWIO_MAPPED_SHAPES).toContain("basic/cylinder");
    expect(DRAWIO_MAPPED_SHAPES).not.toContain("nope/unknown");
  });

  it("keeps ids clear of the root cells and breaks parent cycles", () => {
    const nodes: DNode[] = [
      { id: "1", shape: "basic/frame", x: 0, y: 0, w: 200, h: 200, z: 0, parent: "0" },
      { id: "0", shape: "basic/frame", x: 10, y: 10, w: 100, h: 100, z: 1, parent: "1" },
    ];
    const out = cellsOf(exportDrawio(makeDoc(nodes, [{ id: "e", from: { node: "0" }, to: { node: "1" }, routing: "straight" }])));
    const ids = out.map((c) => c.attrs.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.filter((c) => c.attrs.vertex === "1").every((c) => c.attrs.parent === "1")).toBe(true);
    const edge = out.find((c) => c.attrs.edge === "1")!;
    expect(edge.attrs.source).not.toBe("0");
    expect(ids).toContain(edge.attrs.source);
    expect(ids).toContain(edge.attrs.target);
  });

  it("is deterministic and independent of insertion order", () => {
    expect(exportDrawio(makeDoc())).toBe(xml);
    expect(exportDrawio(makeDoc([...NODES].reverse()))).toBe(xml);
  });
});

/* ------------------------------------------------------------------- import */

const HAND_WRITTEN = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="2024-05-01T10:00:00.000Z" agent="Mozilla/5.0" version="24.2.5" type="device">
  <diagram id="p1" name="Fulfilment flow">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="lane" value="Fulfilment" style="swimlane;whiteSpace=wrap;html=1;startSize=30;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="100" y="50" width="400" height="300" as="geometry" />
        </mxCell>
        <mxCell id="2" value="Pick&lt;br&gt;&lt;b&gt;items&lt;/b&gt; &amp;amp; pack" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=16;fontColor=#333333;align=left;verticalAlign=top;" vertex="1" parent="lane">
          <mxGeometry x="20" y="60" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="3" value="Ready?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="lane">
          <mxGeometry x="220" y="50" width="100" height="80" as="geometry" />
        </mxCell>
        <mxCell id="4" value="&lt;div&gt;Shipped&lt;/div&gt;&lt;div&gt;today&lt;br&gt;&lt;/div&gt;" style="ellipse;whiteSpace=wrap;html=1;dashed=1;dashPattern=1 4;opacity=60;rotation=30;" vertex="1" parent="1">
          <mxGeometry x="600" y="100" width="120" height="80" as="geometry" />
        </mxCell>
        <mxCell id="5" value="yes" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=0;strokeColor=#FF0000;strokeWidth=2;exitX=1;exitY=0.5;exitDx=0;exitDy=0;" edge="1" parent="1" source="3" target="4">
          <mxGeometry relative="1" as="geometry">
            <Array as="points">
              <mxPoint x="550" y="140" />
            </Array>
          </mxGeometry>
        </mxCell>
        <mxCell id="5a" value="0..1" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="5">
          <mxGeometry x="-0.7" relative="1" as="geometry"><mxPoint as="offset" /></mxGeometry>
        </mxCell>
        <mxCell id="5b" value="*" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="5">
          <mxGeometry x="0.75" relative="1" as="geometry" />
        </mxCell>
        <mxCell id="6" style="html=1;startArrow=oval;startFill=0;dashed=1;" edge="1" parent="lane" source="2" target="3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="7" value="dangling" style="endArrow=classic;html=1;" edge="1" parent="1" source="4">
          <mxGeometry width="50" height="50" relative="1" as="geometry">
            <mxPoint x="700" y="300" as="targetPoint" />
          </mxGeometry>
        </mxCell>
        <UserObject label="Runbook" link="https://example.com/runbook" tooltip="Ops only" id="doc-1">
          <mxCell style="shape=mxgraph.weird.gizmo;html=1;" vertex="1" parent="1">
            <mxGeometry x="600" y="300" width="80" height="80" as="geometry" />
          </mxCell>
        </UserObject>
        <mxCell id="g" value="" style="group" vertex="1" connectable="0" parent="1">
          <mxGeometry x="50" y="400" width="300" height="100" as="geometry" />
        </mxCell>
        <mxCell id="g1" value="Plain &lt;text&gt;" style="text;strokeColor=none;fillColor=none;align=center;" vertex="1" parent="g">
          <mxGeometry x="10" y="20" width="100" height="30" as="geometry" />
        </mxCell>
        <mxCell id="g2" value="DB" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;" vertex="1" parent="g">
          <mxGeometry x="200" y="10" width="60" height="80" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe("importDrawio", () => {
  it("reads shapes, absolute geometry, parents and styles from a draw.io file", async () => {
    const result = await importDrawio(HAND_WRITTEN);
    expect(result.name).toBe("Fulfilment flow");
    const nodes = new Map(result.spec.nodes!.map((node) => [node.id, node]));
    expect([...nodes.keys()]).toEqual(["lane", "n-2", "n-3", "n-4", "doc-1", "g", "g1", "g2"]);

    expect(nodes.get("lane")).toMatchObject({ shape: "basic/frame", text: "Fulfilment", x: 100, y: 50, w: 400, h: 300 });
    expect(nodes.get("lane")!.parent).toBeUndefined();
    // A swimlane's fillColor is its header colour, not the body's.
    expect(nodes.get("lane")!.style).toMatchObject({ stroke: "#6c8ebf" });
    expect(nodes.get("lane")!.style!.fill).toBeUndefined();

    expect(nodes.get("n-2")).toMatchObject({
      shape: "basic/rounded",
      text: "Pick\nitems & pack",
      x: 120,
      y: 110,
      w: 120,
      h: 60,
      parent: "lane",
      style: { fill: "#d5e8d4", stroke: "#82b366", bold: true, italic: false, underline: false, fontSize: 16, textColor: "#333333", align: "left", valign: "top", radius: 9 },
    });
    expect(nodes.get("n-3")).toMatchObject({ shape: "flowchart/decision", text: "Ready?", x: 320, y: 100, parent: "lane" });
    expect(nodes.get("n-3")!.style).toEqual({ fontSize: 12 });
    expect(nodes.get("n-4")).toMatchObject({
      shape: "basic/ellipse",
      text: "Shipped\ntoday",
      x: 600,
      y: 100,
      rotation: 30,
      style: { dash: "dotted", opacity: 0.6 },
    });
    expect(nodes.get("doc-1")).toMatchObject({ shape: "basic/rect", text: "Runbook", link: "https://example.com/runbook", note: "Ops only" });

    expect(nodes.get("g")).toMatchObject({ shape: "basic/group", text: "", x: 50, y: 400 });
    // html=1 is absent, so the label is literal text.
    expect(nodes.get("g1")).toMatchObject({ shape: "basic/text", text: "Plain <text>", x: 60, y: 420, parent: "g", style: { fill: "none", stroke: "none" } });
    expect(nodes.get("g2")).toMatchObject({ shape: "basic/cylinder", x: 250, y: 410, parent: "g" });
  });

  it("reads edges with endpoints, labels, routing, markers and anchors", async () => {
    const { spec } = await importDrawio(HAND_WRITTEN);
    expect(spec.edges).toHaveLength(2);
    const [yes, plain] = spec.edges!;
    expect(yes).toMatchObject({
      id: "e-5",
      from: "n-3",
      to: "n-4",
      text: "yes",
      startText: "0..1",
      endText: "*",
      routing: "orthogonal",
      fromAnchor: { x: 1, y: 0.5 },
      style: { startMarker: "none", endMarker: "triangle-open", dash: "solid", stroke: "#ff0000", strokeWidth: 2 },
    });
    expect(yes.toAnchor).toBeUndefined();
    expect(yes.kind).toBeUndefined();
    expect(yes).not.toHaveProperty("waypoints");
    expect(plain).toMatchObject({
      id: "e-6",
      from: "n-2",
      to: "n-3",
      routing: "straight",
      style: { startMarker: "circle-open", endMarker: "arrow", dash: "dashed" },
    });
    expect(plain.text).toBeUndefined();
  });

  it("reports unknown shapes and unattached connectors once each", async () => {
    const { warnings } = await importDrawio(HAND_WRITTEN);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toBe("1 draw.io shape type has no equivalent and was imported as rectangles: mxgraph.weird.gizmo.");
    expect(warnings[1]).toMatch(/1 connector skipped.*free-floating/);
  });

  it("produces a spec that applies cleanly", async () => {
    const { spec } = await importDrawio(HAND_WRITTEN);
    const { doc, warnings } = materialise(spec);
    expect(warnings).toEqual([]);
    expect(Object.keys(doc.nodes)).toHaveLength(8);
    expect(Object.keys(doc.edges)).toHaveLength(2);
    expect(doc.nodes["n-2"]).toMatchObject({ parent: "lane", x: 120, y: 110, w: 120, h: 60 });
    expect(doc.edges["e-5"]).toMatchObject({ from: { node: "n-3", anchor: { x: 1, y: 0.5 } }, to: { node: "n-4" } });
  });

  it("imports only the first page and names the skipped ones", async () => {
    const page = (name: string, label: string) =>
      `<diagram name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="${label}" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="1" y="2" width="30" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram>`;
    const result = await importDrawio(`<mxfile>${page("Overview", "one")}${page("Details", "two")}${page("", "three")}</mxfile>`);
    expect(result.name).toBe("Overview");
    expect(result.spec.nodes).toMatchObject([{ id: "a", text: "one", shape: "basic/rect", x: 1, y: 2, w: 30, h: 40 }]);
    expect(result.warnings).toEqual(['The file has 3 pages; only the first ("Overview") was imported. Skipped 2 pages: "Details", "Page-3".']);
  });

  it("accepts a bare mxGraphModel", async () => {
    const result = await importDrawio(
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a b/c" value="A" style="shape=process;html=1;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel>`,
    );
    expect(result.name).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.spec.nodes).toMatchObject([{ id: "a-b-c", shape: "flowchart/predefined-process", x: 0, y: 0 }]);
  });

  it("maps draw.io shape styles back to our shapes", async () => {
    const styles: [string, string][] = [
      ["", "basic/rect"],
      ["whiteSpace=wrap;html=1;", "basic/rect"],
      ["rounded=1;arcSize=50;", "flowchart/terminator"],
      ["rounded=1;absoluteArcSize=1;arcSize=50;", "basic/rounded"],
      ["ellipse;aspect=fixed;", "basic/circle"],
      ["ellipse;shape=cloud;", "basic/cloud"],
      ["shape=hexagon;perimeter=hexagonPerimeter2;", "basic/hexagon"],
      ["shape=parallelogram;", "flowchart/data"],
      ["shape=trapezoid;", "basic/trapezoid"],
      ["shape=document;", "flowchart/document"],
      ["shape=callout;", "basic/callout"],
      ["shape=step;", "basic/chevron"],
      ["shape=mxgraph.basic.star;", "basic/star"],
      ["shape=mxgraph.flowchart.decision;", "flowchart/decision"],
      ["shape=mxgraph.flowchart.database;", "basic/cylinder"],
      ["strokeWidth=2;html=1;shape=mxgraph.flowchart.document2;whiteSpace=wrap;size=0.25;", "flowchart/document"],
      ["shape=mxgraph.flowchart.or_2;", "flowchart/or"],
      ["shape=mxgraph.flowchart.summing_junction;", "flowchart/summing-junction"],
      ["triangle;direction=north;", "basic/triangle"],
      ["triangle;direction=south;", "flowchart/merge"],
      ["shape=singleArrow;direction=west;", "basic/arrow-left"],
      ["line;strokeWidth=2;", "basic/divider"],
      ["rounded=0;container=1;", "basic/group"],
      ["text;html=1;", "basic/text"],
    ];
    const cellsXml = styles
      .map(([style], index) => `<mxCell id="s${index}" value="" style="${style}" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>`)
      .join("");
    const result = await importDrawio(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cellsXml}</root></mxGraphModel>`);
    expect(result.warnings).toEqual([]);
    expect(result.spec.nodes!.map((node) => node.shape)).toEqual(styles.map(([, shape]) => shape));
  });

  it("turns a sideways triangle into a rotated one occupying the same box", async () => {
    const result = await importDrawio(
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="t" value="" style="triangle;html=1;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="60" height="80" as="geometry"/></mxCell></root></mxGraphModel>`,
    );
    expect(result.spec.nodes).toMatchObject([{ shape: "basic/triangle", rotation: 90, x: 90, y: 110, w: 80, h: 60 }]);
  });

  it("maps every draw.io arrow we know to a marker", async () => {
    const arrows: [string, string][] = [
      ["endArrow=none;", "none"],
      ["", "arrow"],
      ["endArrow=open;", "open-arrow"],
      ["endArrow=block;", "triangle"],
      ["endArrow=block;endFill=0;", "triangle-open"],
      ["endArrow=diamond;endFill=1;", "diamond"],
      ["endArrow=diamondThin;endFill=0;", "diamond-open"],
      ["endArrow=oval;", "circle"],
      ["endArrow=oval;endFill=0;", "circle-open"],
      ["endArrow=dash;", "bar"],
      ["endArrow=cross;", "cross"],
      ["endArrow=ERone;", "crow-one"],
      ["endArrow=ERmandOne;", "crow-one"],
      ["endArrow=ERmany;", "crow-many"],
      ["endArrow=ERzeroToOne;", "crow-zero-one"],
      ["endArrow=ERoneToMany;", "crow-one-many"],
      ["endArrow=ERzeroToMany;", "crow-zero-many"],
      ["endArrow=manyOptional;", "crow-zero-many"],
      ["endArrow=somethingNew;", "arrow"],
    ];
    const edgesXml = arrows
      .map(([style], index) => `<mxCell id="e${index}" style="${style}" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>`)
      .join("");
    const box = (id: string) => `<mxCell id="${id}" value="${id}" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>`;
    const result = await importDrawio(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${box("a")}${box("b")}${edgesXml}</root></mxGraphModel>`);
    expect(result.spec.edges!.map((edge) => edge.style?.endMarker)).toEqual(arrows.map(([, marker]) => marker));
  });

  it("round-trips a document through export and import", async () => {
    const original = makeDoc();
    const result = await importDrawio(exportDrawio(original));
    expect(result.warnings).toEqual([]);
    expect(result.name).toBe(original.name);

    const { doc, warnings } = materialise(result.spec);
    expect(warnings).toEqual([]);
    expect(Object.keys(doc.nodes).sort()).toEqual(Object.keys(original.nodes).sort());
    for (const node of Object.values(original.nodes)) {
      const copy = doc.nodes[node.id];
      expect(copy.text ?? "", node.id).toBe(node.text ?? "");
      expect(copy.shape, node.id).toBe(node.shape);
      expect(copy.parent, node.id).toBe(node.parent);
      for (const key of ["x", "y", "w", "h"] as const) expect(Math.abs(copy[key] - node[key]), `${node.id}.${key}`).toBeLessThanOrEqual(1);
    }
    expect(doc.nodes.db).toMatchObject({
      rotation: 15,
      link: "https://example.com/db?a=1&b=2",
      note: "Primary store",
      style: { fill: "#e5efff", stroke: "#2f6fed", strokeWidth: 2, dash: "dashed", bold: true, italic: true, fontFamily: "mono", opacity: 0.5, shadow: true },
    });

    expect(Object.keys(doc.edges).sort()).toEqual(["e1", "e2"]);
    expect(doc.edges.e1).toMatchObject({
      from: { node: "start" },
      to: { node: "check" },
      routing: "orthogonal",
      text: "validate",
      startText: "1",
      endText: "0..*",
      style: { startMarker: "diamond", endMarker: "triangle-open", dash: "dashed", stroke: "#e03131", strokeWidth: 2 },
    });
    expect(doc.edges.e2).toMatchObject({
      from: { node: "check", anchor: { x: 1, y: 0.5 } },
      to: { node: "db", anchor: { x: 0.5, y: 0.25 } },
      routing: "straight",
      style: { startMarker: "none", endMarker: "arrow", dash: "solid" },
    });
  });

  it("round-trips every mapped basic and flowchart shape without warnings", async () => {
    const ids = DRAWIO_MAPPED_SHAPES.filter((id) => id.startsWith("basic/") || id.startsWith("flowchart/"));
    const nodes: DNode[] = ids.map((shape, index) => ({ id: `s${index}`, shape, x: index * 200, y: 0, w: 120, h: 80, z: index + 1, text: shape }));
    const result = await importDrawio(exportDrawio(makeDoc(nodes, [])));
    expect(result.warnings).toEqual([]);
    expect(result.spec.nodes).toHaveLength(ids.length);
    // Shapes that share a draw.io symbol come back as one of the twins; everything else is exact.
    const twins: Record<string, string> = {
      // draw.io's note is the UML one when that library is present.
      "basic/note": resolveShape("uml/note")?.id ?? "basic/note",
      "basic/pill": "flowchart/terminator",
      "basic/diamond": "flowchart/decision",
      "basic/parallelogram": "flowchart/data",
      // A process box has slightly rounded corners.
      "flowchart/process": "basic/rounded",
      "flowchart/preparation": "basic/hexagon",
      "flowchart/manual-operation": "basic/trapezoid",
      "flowchart/connector": "basic/circle",
      "flowchart/extract": "basic/triangle",
    };
    for (const [index, shape] of ids.entries()) {
      const imported = result.spec.nodes![index];
      expect(imported.shape, shape).toBe(twins[shape] ?? shape);
      expect(imported, shape).toMatchObject({ x: index * 200, y: 0, w: 120, h: 80 });
    }
  });

  it("reads compressed pages", async () => {
    // draw.io stores a compressed page as base64(deflateRaw(encodeURIComponent(<mxGraphModel>…))).
    const xml = exportDrawio(makeDoc());
    const inner = xml.slice(xml.indexOf("<mxGraphModel"), xml.indexOf("</diagram>"));

    const bytes = new TextEncoder().encode(encodeURIComponent(inner));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = "";
    for (const byte of compressed) binary += String.fromCharCode(byte);
    const file = `<mxfile host="app.diagrams.net"><diagram id="z" name="Zipped">${btoa(binary)}</diagram></mxfile>`;

    const result = await importDrawio(file);
    expect(result.warnings).toEqual([]);
    expect(result.name).toBe("Zipped");
    expect(result.spec.nodes!.map((node) => node.id)).toEqual(["frame", "start", "check", "db"]);
    expect(result.spec.edges).toHaveLength(2);
  });

  it("reads the diagram embedded in an editable SVG export", async () => {
    const file = `<mxfile><diagram name="In SVG"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${file.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")}"><g/></svg>`;
    const result = await importDrawio(svg);
    expect(result.name).toBe("In SVG");
    expect(result.spec.nodes).toHaveLength(1);
  });

  it("returns warnings instead of throwing on malformed input", async () => {
    const inputs = [
      "",
      "   ",
      "this is not xml at all",
      "<mxfile>",
      "<mxfile></mxfile>",
      "<mxfile><diagram></diagram></mxfile>",
      "<mxfile><diagram>!!!definitely-not-base64!!!</diagram></mxfile>",
      "<mxfile><diagram>aGVsbG8gd29ybGQ=</diagram></mxfile>",
      "<svg><rect/></svg>",
      `<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="x" vertex="1" style="unterminated`,
      `{"json": true}`,
    ];
    for (const input of inputs) {
      const result = await importDrawio(input);
      expect(result.spec, input).toEqual({ nodes: [], edges: [] });
      expect(result.warnings.length, input).toBeGreaterThan(0);
      expect(result.warnings.every((warning) => typeof warning === "string" && warning.length > 10), input).toBe(true);
    }
    // @ts-expect-error — callers outside TypeScript may pass anything.
    expect((await importDrawio(undefined)).warnings).toHaveLength(1);
  });

  it("survives odd but well-formed models", async () => {
    const result = await importDrawio(
      `<mxGraphModel><root>
        <mxCell id="0"/><mxCell id="1" parent="0"/>
        <mxCell id="a" value="self" vertex="1" parent="a"><mxGeometry x="5" y="5" width="10" height="10" as="geometry"/></mxCell>
        <mxCell id="b" vertex="1" parent="missing"/>
        <mxCell id="b" value="duplicate id" vertex="1" parent="1"><mxGeometry x="nope" y="" width="-" as="geometry"/></mxCell>
        <mxCell value="no id" vertex="1" parent="1"/>
        <mxCell id="e" edge="1" source="a" target="a" parent="1"/>
      </root></mxGraphModel>`,
    );
    const ids = result.spec.nodes!.map((node) => node.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(result.spec.nodes!.map((node) => node.text)).toEqual(["self", "", "duplicate id", "no id"]);
    expect(result.spec.nodes!.every((node) => [node.x, node.y, node.w, node.h].every(Number.isFinite))).toBe(true);
    expect(result.spec.edges).toHaveLength(1);
  });
});
