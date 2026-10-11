import {
  body,
  boxPath,
  fontOf,
  line,
  linePath,
  linesOf,
  measureBlock,
  measureText,
  mix,
  ovalPath,
  parseSvgPath,
  fitPath,
  polyPath,
  rectPath,
  shade,
  simpleShape,
  solid,
  text,
  tint,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

/** Regular polygon inscribed in the box, first vertex pointing up. */
function regularPolygon(sides: number, w: number, h: number, rotationDeg = 0): Path {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = ((i * 360) / sides - 90 + rotationDeg) * (Math.PI / 180);
    points.push([w / 2 + (w / 2) * Math.cos(angle), h / 2 + (h / 2) * Math.sin(angle)]);
  }
  return polyPath(points);
}

function star(points: number, w: number, h: number, innerRatio = 0.42): Path {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const angle = ((i * 180) / points - 90) * (Math.PI / 180);
    out.push([w / 2 + (w / 2) * r * Math.cos(angle), h / 2 + (h / 2) * r * Math.sin(angle)]);
  }
  return polyPath(out);
}

const CLOUD = parseSvgPath(
  "M25 80 C8 80 0 68 0 56 C0 44 9 34 21 33 C22 15 37 2 55 2 C70 2 82 11 87 24 C104 24 118 36 118 53 C118 69 106 80 90 80 Z",
);

function cylinder(w: number, h: number): { bodyPath: Path; rim: Path; cap: number } {
  const cap = Math.min(h * 0.14, w * 0.2, 18);
  const bodyPath: Path = [
    ["M", 0, cap],
    ["C", 0, cap * -0.33, w, cap * -0.33, w, cap],
    ["L", w, h - cap],
    ["C", w, h + cap * 0.33, 0, h + cap * 0.33, 0, h - cap],
    ["Z"],
  ];
  const rim: Path = [
    ["M", 0, cap],
    ["C", 0, cap * 2.33, w, cap * 2.33, w, cap],
  ];
  return { bodyPath, rim, cap };
}

function blockArrow(w: number, h: number, direction: "right" | "left" | "up" | "down"): Path {
  const horizontal = direction === "right" || direction === "left";
  const length = horizontal ? w : h;
  const thickness = horizontal ? h : w;
  const head = Math.min(length * 0.42, thickness * 0.75);
  const shaft = thickness * 0.24;
  // Authored pointing right in (length × thickness) space.
  const base: [number, number][] = [
    [0, shaft],
    [length - head, shaft],
    [length - head, 0],
    [length, thickness / 2],
    [length - head, thickness],
    [length - head, thickness - shaft],
    [0, thickness - shaft],
  ];
  const map = (p: [number, number]): [number, number] => {
    switch (direction) {
      case "right":
        return p;
      case "left":
        return [w - p[0], p[1]];
      case "down":
        return [p[1], p[0]];
      default:
        return [p[1], h - p[0]];
    }
  };
  return polyPath(base.map(map));
}

/* --------------------------------------------------------------- table */

interface TableModel {
  rows: string[][];
  columns: number;
}

function parseTable(textValue: string): TableModel {
  const rows = linesOf(textValue).map((row) => row.split("|").map((cell) => cell.trim()));
  const columns = Math.max(1, ...rows.map((r) => r.length));
  return { rows: rows.length ? rows : [[""]], columns };
}

const TABLE_ROW = 32;

const table: ShapeDef = {
  id: "basic/table",
  name: "Table",
  aliases: ["grid", "matrix"],
  keywords: ["rows", "columns", "cells", "spreadsheet"],
  description: "Grid of cells. One row per line, cells separated by `|`. The first row is the header.",
  size: { w: 280, h: 128 },
  minSize: { w: 80, h: 40 },
  style: { align: "left", fontSize: 13 },
  text: "Name | Type | Notes\nid | uuid | primary key\nemail | text | unique\ncreated_at | timestamp |",
  label: () => null,
  fit: (ctx) => {
    const { rows, columns } = parseTable(ctx.text);
    const widths = Array.from({ length: columns }, (_, c) =>
      Math.max(60, ...rows.map((r, i) => measureText(r[c] ?? "", fontOf(ctx.style, { bold: i === 0 })) + 24)),
    );
    return { w: widths.reduce((a, b) => a + b, 0), h: rows.length * TABLE_ROW };
  },
  draw: (ctx) => {
    const { rows, columns } = parseTable(ctx.text);
    const { w, h, style } = ctx;
    const rowH = h / rows.length;
    // Column widths proportional to their widest cell.
    const natural = Array.from({ length: columns }, (_, c) =>
      Math.max(40, ...rows.map((r, i) => measureText(r[c] ?? "", fontOf(style, { bold: i === 0 })) + 24)),
    );
    const total = natural.reduce((a, b) => a + b, 0);
    const widths = natural.map((n) => (n / total) * w);
    const prims: Prim[] = [body(ctx, rectPath(0, 0, w, h, style.radius))];
    if (rows.length > 1 && style.fill !== "none") {
      prims.push(solid(rectPath(0, 0, w, rowH, 0), shade(style.fill, 0.06)));
    }
    for (let r = 1; r < rows.length; r++) prims.push(line(ctx, linePath(0, r * rowH, w, r * rowH), { strokeWidth: 1 }));
    let x = 0;
    for (let c = 0; c < columns; c++) {
      if (c > 0) prims.push(line(ctx, linePath(x, 0, x, h), { strokeWidth: 1 }));
      rows.forEach((row, r) => {
        const cell = row[c];
        if (!cell) return;
        prims.push(
          text(ctx, cell, { x, y: r * rowH, w: widths[c], h: rowH }, { padding: 10, font: { bold: r === 0 || style.bold }, wrap: false }),
        );
      });
      x += widths[c];
    }
    prims.push(line(ctx, rectPath(0, 0, w, h, style.radius)));
    return prims;
  },
};

/* --------------------------------------------------------- containers */

const FRAME_HEADER = 32;

function containerDraw(ctx: ShapeCtx, dashed: boolean): Prim[] {
  const { w, h, style } = ctx;
  return [body(ctx, rectPath(0, 0, w, h, style.radius), dashed ? { dash: "dashed" } : {})];
}

const frame: ShapeDef = {
  id: "basic/frame",
  name: "Frame",
  aliases: ["container", "section", "slide", "page"],
  keywords: ["group", "boundary", "area", "artboard"],
  description: "Titled container. Children move with it. Frames also become pages/slides when exporting.",
  size: { w: 480, h: 320 },
  minSize: { w: 120, h: 80 },
  container: { header: FRAME_HEADER, padding: 24 },
  style: { fill: "#fafafa", stroke: "#c9ccd1", strokeWidth: 1, radius: 10, align: "left", valign: "top", bold: true, fontSize: 13, textColor: "#5c6670" },
  text: "Frame",
  label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: FRAME_HEADER }, padding: 12, valign: "middle", wrap: false }),
  draw: (ctx) => containerDraw(ctx, false),
};

const group: ShapeDef = {
  id: "basic/group",
  name: "Group",
  aliases: ["boundary", "zone", "cluster", "subgraph"],
  keywords: ["container", "dashed", "area"],
  description: "Dashed container to visually group related nodes (subsystem, zone, cluster).",
  size: { w: 360, h: 240 },
  minSize: { w: 100, h: 60 },
  container: { header: FRAME_HEADER, padding: 20 },
  style: { fill: "none", stroke: "#8a929b", strokeWidth: 1.25, radius: 12, align: "left", valign: "top", fontSize: 13, textColor: "#5c6670", bold: true },
  text: "Group",
  label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: FRAME_HEADER }, padding: 12, valign: "middle", wrap: false }),
  draw: (ctx) => containerDraw(ctx, true),
};

/* ---------------------------------------------------------------- shapes */

const shapes: ShapeDef[] = [
  simpleShape({
    id: "basic/rect",
    name: "Rectangle",
    aliases: ["box", "square", "node"],
    description: "Plain rectangle. The default node.",
    size: { w: 140, h: 60 },
    text: "Rectangle",
    path: boxPath,
  }),
  simpleShape({
    id: "basic/rounded",
    name: "Rounded rectangle",
    aliases: ["rounded-rect", "roundrect", "card"],
    description: "Rectangle with rounded corners.",
    size: { w: 140, h: 60 },
    style: { radius: 10 },
    text: "Rounded",
    path: boxPath,
  }),
  simpleShape({
    id: "basic/pill",
    name: "Pill",
    aliases: ["capsule", "stadium", "tag", "chip"],
    description: "Fully rounded rectangle.",
    size: { w: 140, h: 48 },
    text: "Pill",
    path: (w, h) => rectPath(0, 0, w, h, h / 2),
  }),
  simpleShape({
    id: "basic/ellipse",
    name: "Ellipse",
    aliases: ["oval"],
    description: "Ellipse.",
    size: { w: 140, h: 80 },
    inset: { x: 0.12, y: 0.12 },
    text: "Ellipse",
    path: ovalPath,
  }),
  simpleShape({
    id: "basic/circle",
    name: "Circle",
    description: "Circle (keeps a 1:1 ratio).",
    size: { w: 80, h: 80 },
    keepAspect: true,
    inset: { x: 0.12, y: 0.12 },
    text: "",
    path: ovalPath,
  }),
  simpleShape({
    id: "basic/diamond",
    name: "Diamond",
    aliases: ["rhombus"],
    description: "Diamond / rhombus.",
    size: { w: 140, h: 90 },
    inset: { x: 0.2, y: 0.2 },
    text: "Diamond",
    path: (w, h) => polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  }),
  simpleShape({
    id: "basic/triangle",
    name: "Triangle",
    description: "Isosceles triangle pointing up.",
    size: { w: 110, h: 96 },
    inset: { x: 0.24, y: 0.1 },
    label: (ctx) => ({ box: { x: ctx.w * 0.2, y: ctx.h * 0.42, w: ctx.w * 0.6, h: ctx.h * 0.5 } }),
    path: (w, h) => polyPath([[w / 2, 0], [w, h], [0, h]]),
  }),
  simpleShape({
    id: "basic/pentagon",
    name: "Pentagon",
    size: { w: 100, h: 96 },
    inset: { x: 0.16, y: 0.16 },
    path: (w, h) => regularPolygon(5, w, h),
  }),
  simpleShape({
    id: "basic/hexagon",
    name: "Hexagon",
    description: "Flat-sided hexagon.",
    size: { w: 140, h: 80 },
    inset: { x: 0.14, y: 0.06 },
    text: "Hexagon",
    path: (w, h) => {
      const k = Math.min(w * 0.22, h * 0.5);
      return polyPath([[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]]);
    },
  }),
  simpleShape({
    id: "basic/octagon",
    name: "Octagon",
    aliases: ["stop"],
    size: { w: 96, h: 96 },
    inset: { x: 0.12, y: 0.12 },
    path: (w, h) => regularPolygon(8, w, h, 22.5),
  }),
  simpleShape({
    id: "basic/parallelogram",
    name: "Parallelogram",
    size: { w: 150, h: 60 },
    inset: { x: 0.12, y: 0 },
    text: "Parallelogram",
    path: (w, h) => {
      const k = Math.min(w * 0.18, h * 0.5);
      return polyPath([[k, 0], [w, 0], [w - k, h], [0, h]]);
    },
  }),
  simpleShape({
    id: "basic/trapezoid",
    name: "Trapezoid",
    size: { w: 150, h: 60 },
    inset: { x: 0.14, y: 0 },
    text: "Trapezoid",
    path: (w, h) => {
      const k = Math.min(w * 0.16, h * 0.5);
      return polyPath([[k, 0], [w - k, 0], [w, h], [0, h]]);
    },
  }),
  simpleShape({
    id: "basic/star",
    name: "Star",
    keywords: ["favorite", "highlight"],
    size: { w: 96, h: 92 },
    inset: { x: 0.28, y: 0.3 },
    path: (w, h) => star(5, w, h),
  }),
  simpleShape({
    id: "basic/cross",
    name: "Cross",
    aliases: ["plus"],
    size: { w: 80, h: 80 },
    inset: { x: 0.1, y: 0.33 },
    path: (w, h) => {
      const a = w / 3;
      const b = h / 3;
      return polyPath([[a, 0], [2 * a, 0], [2 * a, b], [w, b], [w, 2 * b], [2 * a, 2 * b], [2 * a, h], [a, h], [a, 2 * b], [0, 2 * b], [0, b], [a, b]]);
    },
  }),
  simpleShape({
    id: "basic/cloud",
    name: "Cloud",
    keywords: ["internet", "network", "saas"],
    description: "Cloud outline (internet, external network, SaaS).",
    size: { w: 160, h: 100 },
    inset: { x: 0.16, y: 0.24 },
    text: "Cloud",
    path: (w, h) => fitPath(CLOUD, 118, 82, 0, 0, w, h),
  }),
  {
    id: "basic/cylinder",
    name: "Cylinder",
    aliases: ["database", "db", "datastore", "storage"],
    keywords: ["sql", "data"],
    description: "Cylinder — the conventional database / storage symbol.",
    size: { w: 100, h: 110 },
    text: "Database",
    outline: (w, h) => cylinder(w, h).bodyPath,
    label: (ctx) => {
      const { cap } = cylinder(ctx.w, ctx.h);
      return { box: { x: 0, y: cap * 1.6, w: ctx.w, h: ctx.h - cap * 2 } };
    },
    draw: (ctx) => {
      const { bodyPath, rim } = cylinder(ctx.w, ctx.h);
      return [body(ctx, bodyPath), line(ctx, rim)];
    },
  },
  {
    id: "basic/callout",
    name: "Callout",
    aliases: ["speech-bubble", "bubble"],
    keywords: ["annotation", "say", "tooltip"],
    description: "Speech bubble for annotations.",
    size: { w: 170, h: 90 },
    style: { radius: 10 },
    text: "Callout",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h - Math.min(18, ctx.h * 0.25) } }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const tail = Math.min(18, h * 0.25);
      const r = Math.min(style.radius, (h - tail) / 2, w / 2);
      const bubble = rectPath(0, 0, w, h - tail, r);
      // Splice the tail into the bottom edge of the rounded rectangle.
      const tailPath: Path = [
        ["M", w * 0.22, h - tail],
        ["L", w * 0.18, h],
        ["L", w * 0.36, h - tail],
      ];
      return [
        body(ctx, bubble),
        solid(polyPath([[w * 0.22, h - tail - style.strokeWidth], [w * 0.18, h], [w * 0.36, h - tail - style.strokeWidth]]), style.fill),
        line(ctx, tailPath),
      ];
    },
  },
  {
    id: "basic/note",
    name: "Sticky note",
    aliases: ["sticky", "post-it", "postit"],
    keywords: ["annotation", "idea", "brainstorm"],
    description: "Sticky note for ideas, annotations and brainstorming.",
    size: { w: 150, h: 150 },
    style: { fill: "#fff3a3", stroke: "none", shadow: true, fontFamily: "hand", fontSize: 18, align: "left", valign: "top", textColor: "#3d3200" },
    text: "Note",
    label: () => ({ padding: 14 }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const fold = Math.min(22, w * 0.2, h * 0.2);
      const page = polyPath([[0, 0], [w, 0], [w, h - fold], [w - fold, h], [0, h]]);
      const corner = polyPath([[w - fold, h], [w - fold, h - fold], [w, h - fold]]);
      return [body(ctx, page), solid(corner, style.fill === "none" ? "#00000022" : shade(style.fill, 0.14))];
    },
    outline: (w, h) => rectPath(0, 0, w, h),
  },
  {
    id: "basic/text",
    name: "Text",
    aliases: ["label", "heading", "title", "caption"],
    description: "Free text without a border.",
    size: { w: 160, h: 36 },
    minSize: { w: 20, h: 20 },
    style: { fill: "none", stroke: "none" },
    text: "Text",
    label: () => ({ padding: 4 }),
    fit: (ctx) => {
      const size = measureBlock(ctx.text || "Text", fontOf(ctx.style), 360);
      return { w: size.w + 12, h: size.h + 10 };
    },
    draw: (ctx) => (ctx.style.fill === "none" && ctx.style.stroke === "none" ? [] : [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))]),
  },
  simpleShape({
    id: "basic/arrow-right",
    name: "Arrow right",
    aliases: ["block-arrow"],
    size: { w: 140, h: 70 },
    inset: { x: 0.1, y: 0.26 },
    path: (w, h) => blockArrow(w, h, "right"),
  }),
  simpleShape({
    id: "basic/arrow-left",
    name: "Arrow left",
    size: { w: 140, h: 70 },
    inset: { x: 0.1, y: 0.26 },
    path: (w, h) => blockArrow(w, h, "left"),
  }),
  simpleShape({
    id: "basic/arrow-up",
    name: "Arrow up",
    size: { w: 70, h: 140 },
    inset: { x: 0.26, y: 0.1 },
    path: (w, h) => blockArrow(w, h, "up"),
  }),
  simpleShape({
    id: "basic/arrow-down",
    name: "Arrow down",
    size: { w: 70, h: 140 },
    inset: { x: 0.26, y: 0.1 },
    path: (w, h) => blockArrow(w, h, "down"),
  }),
  simpleShape({
    id: "basic/chevron",
    name: "Chevron",
    aliases: ["step-arrow", "process-step"],
    keywords: ["stage", "pipeline", "phase"],
    description: "Chevron step for linear processes and pipelines.",
    size: { w: 160, h: 60 },
    inset: { x: 0.16, y: 0 },
    text: "Step",
    path: (w, h) => {
      const k = Math.min(h / 2, w * 0.25);
      return polyPath([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h], [k, h / 2]]);
    },
  }),
  {
    id: "basic/cube",
    name: "Cube",
    aliases: ["box-3d"],
    size: { w: 120, h: 100 },
    text: "Cube",
    label: (ctx) => {
      const d = Math.min(ctx.w, ctx.h) * 0.18;
      return { box: { x: 0, y: d, w: ctx.w - d, h: ctx.h - d } };
    },
    outline: (w, h) => {
      const d = Math.min(w, h) * 0.18;
      return polyPath([[d, 0], [w, 0], [w, h - d], [w - d, h], [0, h], [0, d]]);
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const d = Math.min(w, h) * 0.18;
      const sideFill = style.fill === "none" ? "none" : shade(style.fill, 0.08);
      return [
        body(ctx, polyPath([[0, d], [d, 0], [w, 0], [w - d, d]]), { fill: style.fill === "none" ? "none" : tint(style.fill, 0.4) }),
        body(ctx, polyPath([[w - d, d], [w, 0], [w, h - d], [w - d, h]]), { fill: sideFill }),
        body(ctx, rectPath(0, d, w - d, h - d)),
      ];
    },
  },
  {
    id: "basic/divider",
    name: "Divider",
    aliases: ["separator", "rule"],
    description: "Horizontal rule to separate areas.",
    size: { w: 240, h: 10 },
    minSize: { w: 20, h: 4 },
    style: { stroke: mix("#1c1f23", "#ffffff", 0.5) },
    label: () => null,
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => [line(ctx, linePath(0, ctx.h / 2, ctx.w, ctx.h / 2), { dash: ctx.style.dash })],
  },
  table,
  frame,
  group,
];

export const basicLibrary: ShapeLibrary = {
  id: "basic",
  name: "Basic shapes",
  description: "General-purpose shapes, text, sticky notes, tables and containers usable in any diagram.",
  shapes,
};
