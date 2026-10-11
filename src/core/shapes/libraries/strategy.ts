import { stackHeight, stackText, stackWidth, type StackItem } from "../compartments";
import {
  body,
  boxPath,
  fontOf,
  line,
  linePath,
  linesHeight,
  linesOf,
  measureBlock,
  measureText,
  mix,
  ovalPath,
  PALETTE,
  PAPER,
  param,
  polyPath,
  rectPath,
  shade,
  simpleShape,
  solid,
  text,
  type LabelSpec,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

type Meta = Pick<ShapeDef, "id" | "name" | "aliases" | "keywords" | "description" | "text">;
type Box = { x: number; y: number; w: number; h: number };
type Tint = keyof typeof PALETTE;

const KAPPA = 0.5522847498;

/** Secondary text colour: the text colour faded towards the fill. */
const muted = (ctx: Pick<ShapeCtx, "style">): string => mix(ctx.style.textColor, ctx.style.fill === "none" ? PAPER : ctx.style.fill, 0.35);

const diamond = (w: number, h: number): Path => polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);

/** Rectangle with only its top corners rounded. */
function topBar(w: number, h: number, radius: number): Path {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const k = r * KAPPA;
  return [["M", 0, h], ["L", 0, r], ["C", 0, r - k, r - k, 0, r, 0], ["L", w - r, 0], ["C", w - r + k, 0, w, r - k, w, r], ["L", w, h], ["Z"]];
}

/** Rectangle with only its left corners rounded. */
function leftBar(w: number, h: number, radius: number): Path {
  const r = Math.max(0, Math.min(radius, w, h / 2));
  const k = r * KAPPA;
  return [["M", w, 0], ["L", r, 0], ["C", r - k, 0, 0, r - k, 0, r], ["L", 0, h - r], ["C", 0, h - r + k, r - k, h, r, h], ["L", w, h], ["Z"]];
}

/* -------------------------------------------------------------- matrices */

interface MatrixCell {
  title: string;
  body: string;
}

interface MatrixModel {
  cells: MatrixCell[];
  xAxis: string;
  yAxis: string;
}

/**
 * Plain text: lines 1–4 are the quadrant titles, lines 5–6 the X and Y axis titles.
 * With `---` sections: one section per quadrant (title, then content), a fifth for the axes.
 */
function matrixModel(ctx: Pick<ShapeCtx, "text" | "sections">): MatrixModel {
  if (ctx.sections.length > 1) {
    const cells = ctx.sections.slice(0, 4).map((section) => {
      const [title = "", ...rest] = linesOf(section);
      return { title, body: rest.join("\n") };
    });
    const [xAxis = "", yAxis = ""] = linesOf(ctx.sections[4]);
    return { cells, xAxis, yAxis };
  }
  const lines = linesOf(ctx.text);
  return { cells: lines.slice(0, 4).map((title) => ({ title, body: "" })), xAxis: lines[4] ?? "", yAxis: lines[5] ?? "" };
}

const axisFont = (ctx: Pick<ShapeCtx, "style">) => fontOf(ctx.style, { size: ctx.style.fontSize * 0.92, bold: false });

/** The 2×2 grid, leaving room for the axis titles at the left and below. */
function matrixGrid(ctx: Pick<ShapeCtx, "style">, model: MatrixModel, w: number, h: number): Box {
  const font = axisFont(ctx);
  const left = model.yAxis ? Math.min(w * 0.3, measureBlock(model.yAxis, font, 72).w + 16) : 0;
  const bottom = model.xAxis ? Math.min(h * 0.3, linesHeight(1, font.size) + 10) : 0;
  return { x: left, y: 0, w: w - left, h: h - bottom };
}

const cellItems = (ctx: Pick<ShapeCtx, "style">, cell: MatrixCell, color?: string): StackItem[] => [
  { text: cell.title, font: { bold: true }, color },
  { text: cell.body, font: { size: ctx.style.fontSize * 0.92, bold: false }, gap: 4 },
];

const MATRIX = { w: 420, h: 320 };
const CELL_PAD = 10;

function matrix(meta: Meta, tints?: Tint[]): ShapeDef {
  return {
    ...meta,
    size: MATRIX,
    minSize: { w: 160, h: 120 },
    style: { fontSize: 13, stroke: "#5c6670" },
    label: () => null,
    fit: (ctx) => {
      const model = matrixModel(ctx);
      const grid = matrixGrid(ctx, model, MATRIX.w, MATRIX.h);
      const tallest = Math.max(0, ...model.cells.map((cell) => stackHeight(ctx, cellItems(ctx, cell), grid.w / 2 - CELL_PAD * 2)));
      return { w: MATRIX.w, h: Math.max(MATRIX.h, (tallest + CELL_PAD * 2) * 2 + MATRIX.h - grid.h) };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const model = matrixModel(ctx);
      const grid = matrixGrid(ctx, model, w, h);
      const cw = grid.w / 2;
      const ch = grid.h / 2;
      // Tinted cells are square, so the frame only keeps its radius without them.
      const frame = rectPath(grid.x, grid.y, grid.w, grid.h, tints ? 0 : style.radius);
      const prims: Prim[] = [body(ctx, frame)];
      for (let i = 0; i < 4; i++) {
        const cell: Box = { x: grid.x + (i % 2) * cw, y: grid.y + Math.floor(i / 2) * ch, w: cw, h: ch };
        const swatch = tints ? PALETTE[tints[i]] : undefined;
        if (swatch && style.fill !== "none") prims.push(solid(rectPath(cell.x, cell.y, cell.w, cell.h), swatch.fill));
        if (model.cells[i]) {
          prims.push(...stackText(ctx, cell, cellItems(ctx, model.cells[i], swatch?.text), { align: "left", valign: "top", padding: CELL_PAD }));
        }
      }
      const thin = { strokeWidth: Math.min(style.strokeWidth, 1.25) };
      prims.push(line(ctx, linePath(grid.x + cw, grid.y, grid.x + cw, grid.y + grid.h), thin), line(ctx, linePath(grid.x, grid.y + ch, grid.x + grid.w, grid.y + ch), thin));
      if (tints) prims.push(line(ctx, frame, { dash: style.dash }));
      const axis = { font: { size: axisFont(ctx).size, bold: false }, color: muted(ctx), align: "center", valign: "middle" } as const;
      if (model.xAxis) prims.push(text(ctx, model.xAxis, { x: grid.x, y: grid.h, w: grid.w, h: h - grid.h }, { ...axis, wrap: false }));
      if (model.yAxis) prims.push(text(ctx, model.yAxis, { x: 0, y: 0, w: grid.x, h: grid.h }, { ...axis, padding: 4 }));
      return prims;
    },
  };
}

/* ----------------------------------------------------------- funnel etc. */

const VENN_OPACITY = 0.55;

const funnelSlope = (w: number, h: number): number => Math.min(h * 0.45, w * 0.25);
const pyramidSlope = (w: number, h: number): number => Math.min(h * 0.6, w * 0.3);

/* -------------------------------------------------------------- timeline */

function arrowHead(tipX: number, y: number, size: number): Path {
  return polyPath([[tipX, y], [tipX - size, y - size * 0.55], [tipX - size, y + size * 0.55]]);
}

/* -------------------------------------------------------------- fishbone */

const spineHead = (w: number): number => Math.min(150, w * 0.4);

/* ----------------------------------------------------------------- brace */

/** Curly brace from (x, 0) to (x, h) whose tip points at `tipX`. */
function bracePath(x: number, tipX: number, h: number): Path {
  const m = (x + tipX) / 2;
  const r = Math.min(Math.abs(tipX - x) * 0.7, h / 4);
  return [
    ["M", x, 0],
    ["C", m, 0, m, 0, m, r],
    ["L", m, h / 2 - r],
    ["C", m, h / 2, m, h / 2, tipX, h / 2],
    ["C", m, h / 2, m, h / 2, m, h / 2 + r],
    ["L", m, h - r],
    ["C", m, h, m, h, x, h],
  ];
}

const braceWidth = (w: number): number => Math.min(18, w * 0.3);

/* ---------------------------------------------------------------- legend */

const LEGEND_PAD = 12;
const SWATCH = 12;
const SERIES = ["#2f6fed", "#2f9e44", "#e8792a", "#7b4fe0", "#e03131", "#0f9d8c", "#d99a00", "#d6478f"];
const HEX_ENTRY = /^(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\s+(.+)$/i;

const expandHex = (hex: string): string =>
  (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase();

/** Each line is `#rrggbb Label` or just `Label`; a first `---` section is the title. */
function legendModel(ctx: Pick<ShapeCtx, "sections">): { title: string; rows: { color: string; label: string }[] } {
  const titled = ctx.sections.length > 1;
  const rows = linesOf(ctx.sections.slice(titled ? 1 : 0).join("\n")).map((row, i) => {
    const match = HEX_ENTRY.exec(row.trim());
    return match ? { color: expandHex(match[1]), label: match[2] } : { color: SERIES[i % SERIES.length], label: row.trim() };
  });
  return { title: titled ? linesOf(ctx.sections[0]).join(" ") : "", rows };
}

const legendRow = (ctx: Pick<ShapeCtx, "style">): number => linesHeight(1, ctx.style.fontSize) + 5;

/* ------------------------------------------------------------------ cards */

const DELTA_UP = /^[+▲↑]/;
const DELTA_DOWN = /^[-−–▼↓]/;

/** Line 1 = the number, line 2 = what it measures, line 3 = the change. */
function kpiItems(ctx: Pick<ShapeCtx, "sections" | "style">): StackItem[] {
  const [value = "", label = "", ...rest] = ctx.sections.join("\n").split("\n");
  const delta = rest.join("\n").trim();
  const size = ctx.style.fontSize;
  const trend = DELTA_UP.test(delta) ? "#2f9e44" : DELTA_DOWN.test(delta) ? "#e03131" : muted(ctx);
  return [
    { text: value, font: { size: size * 2, bold: true } },
    { text: label, font: { size: size * 0.93, bold: false }, color: muted(ctx), gap: 0 },
    { text: delta, font: { size: size * 0.86, bold: true }, color: trend, gap: 6 },
  ];
}

/** Line 1 = title, the rest = description. */
function cardItems(ctx: Pick<ShapeCtx, "sections" | "style">): StackItem[] {
  const [title = "", ...rest] = ctx.sections.join("\n").split("\n");
  return [
    { text: title, font: { bold: true } },
    { text: rest.join("\n").trim(), font: { size: ctx.style.fontSize * 0.9, bold: false }, color: muted(ctx), gap: 4 },
  ];
}

const KANBAN_HEADER = 40;
const accentWidth = (w: number, radius: number): number => Math.max(5, Math.min(radius, w * 0.2));

const outside = (ctx: ShapeCtx, above: boolean): LabelSpec =>
  above
    ? { box: { x: -70, y: -44, w: ctx.w + 140, h: 40 }, valign: "bottom", padding: 0 }
    : { box: { x: -70, y: ctx.h + 4, w: ctx.w + 140, h: 40 }, valign: "top", padding: 0 };

/* ---------------------------------------------------------------- shapes */

const shapes: ShapeDef[] = [
  matrix({
    id: "strategy/quadrant",
    name: "2×2 matrix",
    aliases: ["quadrant-chart", "2x2", "2x2-matrix", "priority-matrix", "eisenhower-matrix", "impact-effort-matrix", "four-quadrants"],
    keywords: ["prioritise", "bcg", "magic quadrant", "framework"],
    description:
      "2×2 matrix frame. Lines 1–4 title the quadrants (top-left, top-right, bottom-left, bottom-right), lines 5–6 the X and Y axes. Place notes on top.",
    text: "Quick wins\nBig bets\nFill-ins\nTime sinks\nEffort\nImpact",
  }),
  matrix(
    {
      id: "strategy/swot",
      name: "SWOT matrix",
      aliases: ["swot-analysis", "swot-matrix", "strengths-weaknesses-opportunities-threats"],
      keywords: ["strategy", "analysis", "framework", "2x2"],
      description: "SWOT analysis grid with four tinted quadrants. Separate quadrants with `---` to add bullet lines under each title.",
      text: "Strengths\nWeaknesses\nOpportunities\nThreats",
    },
    ["green", "red", "blue", "yellow"],
  ),
  {
    id: "strategy/venn-set",
    name: "Venn set",
    aliases: ["venn", "venn-circle", "venn-diagram", "overlapping-circle"],
    keywords: ["overlap", "intersection", "translucent", "set"],
    description: "Translucent circle for Venn diagrams. Overlap two or three and give each its own fill colour.",
    size: { w: 180, h: 180 },
    inset: { x: 0.16, y: 0.16 },
    style: { fill: "#6ea3ff", stroke: "#2f6fed", textColor: "#0b2559", bold: true },
    text: "Set A",
    outline: ovalPath,
    // Only the fill is translucent, so overlaps blend while the outline and label stay crisp.
    draw: (ctx) => [solid(ovalPath(ctx.w, ctx.h), ctx.style.fill, { opacity: VENN_OPACITY }), line(ctx, ovalPath(ctx.w, ctx.h), { dash: ctx.style.dash })],
  },
  simpleShape({
    id: "strategy/funnel-stage",
    name: "Funnel stage",
    aliases: ["funnel", "sales-funnel-stage", "conversion-stage", "funnel-step"],
    keywords: ["marketing", "pipeline", "conversion", "inverted trapezoid"],
    description: "One stage of a funnel. Stack them, each narrower than the one above.",
    size: { w: 240, h: 56 },
    inset: { x: 0.14, y: 0 },
    style: { fill: "#e5efff", stroke: "#2f6fed", textColor: "#123a8f" },
    text: "Leads",
    path: (w, h) => {
      const k = funnelSlope(w, h);
      return polyPath([[0, 0], [w, 0], [w - k, h], [k, h]]);
    },
  }),
  {
    id: "strategy/pyramid-level",
    name: "Pyramid level",
    aliases: ["pyramid", "pyramid-tier", "hierarchy-level", "maslow-level"],
    keywords: ["hierarchy", "layers", "trapezoid", "triangle"],
    description: "One level of a pyramid. Stack them, each wider than the one above; set `data.top: true` for the pointed tip.",
    size: { w: 240, h: 56 },
    inset: { x: 0.16, y: 0 },
    style: { fill: "#fff4cc", stroke: "#d99a00", textColor: "#6b4f00" },
    text: "Level",
    data: { top: false },
    outline: (w, h) => {
      const k = pyramidSlope(w, h);
      return polyPath([[k, 0], [w - k, 0], [w, h], [0, h]]);
    },
    label: (ctx) => (param(ctx, "top", false) ? { box: { x: ctx.w * 0.25, y: ctx.h * 0.4, w: ctx.w * 0.5, h: ctx.h * 0.6 }, padding: 2 } : {}),
    draw: (ctx) => {
      const { w, h } = ctx;
      const k = pyramidSlope(w, h);
      return [body(ctx, param(ctx, "top", false) ? polyPath([[w / 2, 0], [w, h], [0, h]]) : polyPath([[k, 0], [w - k, 0], [w, h], [0, h]]))];
    },
  },
  {
    id: "strategy/timeline-milestone",
    name: "Timeline milestone",
    aliases: ["timeline-marker", "timeline-event", "timeline-point", "roadmap-milestone"],
    keywords: ["roadmap", "date", "dot", "marker"],
    description: "Dot on a timeline with its label below, or above with `data.labelAbove: true`.",
    size: { w: 18, h: 18 },
    minSize: { w: 10, h: 10 },
    keepAspect: true,
    style: { fill: "#ffffff", stroke: "#2f6fed", strokeWidth: 3, fontSize: 12 },
    text: "Launch",
    data: { labelAbove: false },
    label: (ctx) => outside(ctx, param(ctx, "labelAbove", false)),
    outline: ovalPath,
    draw: (ctx) => [body(ctx, ovalPath(ctx.w, ctx.h))],
  },
  {
    id: "strategy/timeline-axis",
    name: "Timeline axis",
    aliases: ["timeline", "time-axis", "roadmap-axis", "timeline-line"],
    keywords: ["roadmap", "arrow", "ticks", "chronology"],
    description: "Horizontal time line with an arrow head and `data.ticks` evenly spaced tick marks. Place milestones on it.",
    size: { w: 480, h: 24 },
    minSize: { w: 40, h: 10 },
    style: { stroke: "#5c6670", strokeWidth: 2 },
    data: { ticks: 6 },
    label: () => null,
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const y = h / 2;
      const head = Math.min(11, w * 0.2);
      const tick = Math.min(h / 2, 6);
      const count = Math.max(0, Math.min(200, Math.round(param(ctx, "ticks", 6))));
      const span = w - head * 2.5;
      const prims: Prim[] = [line(ctx, linePath(0, y, w - head, y), { dash: style.dash }), solid(arrowHead(w, y, head), style.stroke)];
      for (let i = 0; i < count; i++) {
        const x = count === 1 ? 0 : (i / (count - 1)) * span;
        prims.push(line(ctx, linePath(x, y - tick, x, y + tick), { strokeWidth: Math.min(style.strokeWidth, 1.5) }));
      }
      return prims;
    },
  },
  {
    id: "strategy/gantt-bar",
    name: "Gantt bar",
    aliases: ["gantt-task", "gantt", "schedule-bar", "task-bar"],
    keywords: ["schedule", "plan", "duration", "progress"],
    description: "Task bar for Gantt charts and roadmaps; its width is the duration. `data.progress` (0–1) fills the completed part.",
    size: { w: 200, h: 28 },
    minSize: { w: 24, h: 14 },
    style: { fill: "#d6e4ff", stroke: "#2f6fed", strokeWidth: 1, radius: 6, align: "left", fontSize: 12, textColor: "#0f2f73", bold: true },
    text: "Task",
    data: { progress: 0.4 },
    label: () => ({ padding: 8, wrap: false }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const done = Math.max(0, Math.min(1, param(ctx, "progress", 0.4))) * w;
      const fill = style.fill === "none" ? mix(style.stroke, PAPER, 0.6) : mix(style.fill, style.stroke, 0.4);
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      if (done > 0) prims.push(solid(done >= w ? boxPath(w, h, style) : leftBar(done, h, style.radius), fill), line(ctx, boxPath(w, h, style), { dash: style.dash }));
      return prims;
    },
  },
  {
    id: "strategy/gantt-milestone",
    name: "Gantt milestone",
    aliases: ["gantt-diamond", "schedule-milestone", "deadline-marker"],
    keywords: ["deadline", "diamond", "date", "deliverable"],
    description: "Diamond marking a milestone or deadline on a Gantt chart, label on the right.",
    size: { w: 20, h: 20 },
    minSize: { w: 10, h: 10 },
    keepAspect: true,
    style: { fill: "#1c1f23", align: "left", fontSize: 12 },
    text: "Milestone",
    label: (ctx) => ({ box: { x: ctx.w + 6, y: -10, w: 180, h: ctx.h + 20 }, padding: 0 }),
    outline: diamond,
    draw: (ctx) => [body(ctx, diamond(ctx.w, ctx.h))],
  },
  {
    id: "strategy/kanban-column",
    name: "Kanban column",
    aliases: ["kanban-lane", "board-column", "kanban-list", "task-column"],
    keywords: ["board", "to do", "doing", "done", "container"],
    description: "Column of a kanban board (To do, Doing, Done…). Put kanban cards inside.",
    size: { w: 240, h: 420 },
    minSize: { w: 120, h: 100 },
    container: { header: KANBAN_HEADER, padding: 12 },
    style: { fill: "#f1f3f5", stroke: "#c9ccd1", strokeWidth: 1, radius: 10, align: "left", bold: true, textColor: "#343a40" },
    text: "To do",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: Math.min(KANBAN_HEADER, ctx.h) }, padding: 14, valign: "middle", wrap: false }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const header = Math.min(KANBAN_HEADER, h);
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      if (style.fill !== "none") prims.push(solid(topBar(w, header, style.radius), shade(style.fill, 0.06)), line(ctx, boxPath(w, h, style), { dash: style.dash }));
      prims.push(line(ctx, linePath(0, header, w, header)));
      return prims;
    },
  },
  {
    id: "strategy/kanban-card",
    name: "Kanban card",
    aliases: ["task-card", "board-card", "ticket-card", "story-card", "backlog-item"],
    keywords: ["ticket", "issue", "user story", "todo"],
    description: "Card with a coloured accent bar (the stroke colour). Text: title, then description lines.",
    size: { w: 210, h: 72 },
    minSize: { w: 80, h: 36 },
    style: { fill: "#ffffff", stroke: "#2f6fed", strokeWidth: 1, radius: 8, align: "left", fontSize: 13 },
    text: "Design the onboarding flow\nWireframes and copy for the first three screens",
    label: () => null,
    fit: (ctx) => {
      const items = cardItems(ctx);
      const textW = Math.min(180, stackWidth(ctx, items, 180));
      return { w: Math.max(210, textW + 30), h: Math.max(56, stackHeight(ctx, items, textW + 2) + 22) };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const bar = accentWidth(w, style.radius);
      const border = style.fill === "none" ? style.stroke : mix(style.stroke, style.fill, 0.55);
      return [
        body(ctx, boxPath(w, h, style), { stroke: border }),
        solid(leftBar(bar, h, style.radius), style.stroke),
        ...stackText(ctx, { x: bar, y: 0, w: w - bar, h }, cardItems(ctx), { align: "left", padding: 10 }),
      ];
    },
  },
  simpleShape({
    id: "strategy/step-circle",
    name: "Step number",
    aliases: ["numbered-circle", "step-number", "callout-number", "number-badge", "process-step-number"],
    keywords: ["sequence", "order", "bullet", "stage"],
    description: "Numbered circle to mark the order of steps. The text is the number.",
    size: { w: 40, h: 40 },
    minSize: { w: 20, h: 20 },
    keepAspect: true,
    style: { fill: "#2f6fed", stroke: "#2459c4", textColor: "#ffffff", bold: true, fontSize: 16 },
    text: "1",
    label: () => ({ padding: 0, wrap: false }),
    path: ovalPath,
  }),
  {
    id: "strategy/fishbone-spine",
    name: "Fishbone spine",
    aliases: ["fishbone", "ishikawa", "ishikawa-spine", "cause-effect-spine", "fishbone-head"],
    keywords: ["root cause", "cause and effect", "effect", "problem"],
    description: "Backbone of a fishbone (Ishikawa) diagram: an arrow into the head box that holds the effect or problem.",
    size: { w: 520, h: 64 },
    minSize: { w: 120, h: 30 },
    style: { strokeWidth: 2, radius: 6, bold: true },
    text: "Effect",
    label: (ctx) => ({ box: { x: ctx.w - spineHead(ctx.w), y: 0, w: spineHead(ctx.w), h: ctx.h }, padding: 8 }),
    // Thin strip along the spine so cause lines attach to the line itself.
    outline: (w, h) => {
      const head = spineHead(w);
      const t = Math.min(3, h / 2);
      return polyPath([[0, h / 2 - t], [w - head, h / 2 - t], [w - head, 0], [w, 0], [w, h], [w - head, h], [w - head, h / 2 + t], [0, h / 2 + t]]);
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const head = spineHead(w);
      const arrow = Math.min(12, h * 0.4, w * 0.1);
      return [
        line(ctx, linePath(0, h / 2, w - head - arrow, h / 2), { dash: style.dash }),
        solid(arrowHead(w - head, h / 2, arrow), style.stroke),
        body(ctx, rectPath(w - head, 0, head, h, style.radius)),
      ];
    },
  },
  {
    id: "strategy/fishbone-cause",
    name: "Fishbone cause",
    aliases: ["fishbone-bone", "ishikawa-cause", "cause-category", "fishbone-branch"],
    keywords: ["root cause", "category", "bone", "6m"],
    description: 'A category bone of a fishbone diagram: a label box with a slanted line to the spine. `data.side`: "top" or "bottom" of the spine.',
    size: { w: 150, h: 110 },
    minSize: { w: 50, h: 40 },
    style: { strokeWidth: 1.5, radius: 6, fontSize: 13 },
    text: "Cause",
    data: { side: "top" },
    label: (ctx) => {
      const bh = Math.min(34, ctx.h * 0.45);
      return { box: { x: 0, y: param<string>(ctx, "side", "top") === "bottom" ? ctx.h - bh : 0, w: ctx.w * 0.76, h: bh }, padding: 6 };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const bh = Math.min(34, h * 0.45);
      const bw = w * 0.76;
      const below = param<string>(ctx, "side", "top") === "bottom";
      return [
        line(ctx, below ? linePath(bw / 2, h - bh, w, 0) : linePath(bw / 2, bh, w, h), { dash: style.dash }),
        body(ctx, rectPath(0, below ? h - bh : 0, bw, bh, style.radius)),
      ];
    },
  },
  {
    id: "strategy/brace",
    name: "Brace",
    aliases: ["curly-brace", "curly-bracket", "brace-label", "grouping-brace"],
    keywords: ["group", "summarise", "annotation", "bracket"],
    description: 'Curly brace spanning the node height with a label beside it. `data.side`: "right" (a } with the label on its right) or "left".',
    size: { w: 150, h: 120 },
    minSize: { w: 30, h: 30 },
    style: { fill: "none", fontSize: 13 },
    text: "Summary",
    data: { side: "right" },
    label: (ctx) => {
      const gap = braceWidth(ctx.w) + 6;
      return param<string>(ctx, "side", "right") === "left"
        ? { box: { x: 0, y: 0, w: ctx.w - gap, h: ctx.h }, align: "right", padding: 0 }
        : { box: { x: gap, y: 0, w: ctx.w - gap, h: ctx.h }, align: "left", padding: 0 };
    },
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h } = ctx;
      const b = braceWidth(w);
      return [line(ctx, param<string>(ctx, "side", "right") === "left" ? bracePath(w, w - b, h) : bracePath(0, b, h), { round: true })];
    },
  },
  {
    id: "strategy/legend",
    name: "Legend",
    aliases: ["color-legend", "colour-legend", "color-key", "diagram-legend", "map-key"],
    keywords: ["key", "swatch", "colours", "explanation"],
    description: "Colour key. One entry per line as `#rrggbb Label` (or just `Label`); put a title above a `---` line.",
    size: { w: 160, h: 110 },
    minSize: { w: 80, h: 40 },
    style: { stroke: "#c9ccd1", strokeWidth: 1, radius: 8, fontSize: 13 },
    text: "Legend\n---\n#2f6fed Service\n#2f9e44 Database\n#e8792a Queue",
    label: () => null,
    fit: (ctx) => {
      const { title, rows } = legendModel(ctx);
      const labels = Math.max(0, ...rows.map((row) => measureText(row.label, fontOf(ctx.style, { bold: false }))));
      const heading = title ? measureText(title, fontOf(ctx.style, { bold: true })) : 0;
      return {
        w: Math.max(120, heading + LEGEND_PAD * 2, labels + SWATCH + 8 + LEGEND_PAD * 2),
        h: LEGEND_PAD * 2 + (title ? legendRow(ctx) + 2 : 0) + rows.length * legendRow(ctx),
      };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const { title, rows } = legendModel(ctx);
      const rowH = legendRow(ctx);
      const pad = Math.min(LEGEND_PAD, w * 0.1);
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      let y = Math.min(LEGEND_PAD, h * 0.1);
      if (title) {
        prims.push(text(ctx, title, { x: pad, y, w: w - pad * 2, h: rowH }, { font: { bold: true }, align: "left", valign: "middle", wrap: false }));
        y += rowH + 2;
      }
      for (const row of rows) {
        prims.push(
          solid(rectPath(pad, y + (rowH - SWATCH) / 2, SWATCH, SWATCH, 3), row.color),
          text(ctx, row.label, { x: pad + SWATCH + 8, y, w: w - pad * 2 - SWATCH - 8, h: rowH }, { align: "left", valign: "middle", wrap: false }),
        );
        y += rowH;
      }
      return prims;
    },
  },
  {
    id: "strategy/kpi-card",
    name: "KPI card",
    aliases: ["kpi", "metric-card", "stat-card", "big-number", "scorecard"],
    keywords: ["metric", "number", "dashboard", "okr", "result"],
    description: "Headline metric. Text: the number, then what it measures, then the change (a leading + or - colours it green or red).",
    size: { w: 180, h: 110 },
    minSize: { w: 90, h: 60 },
    style: { stroke: "#c9ccd1", strokeWidth: 1, radius: 12, align: "left" },
    text: "42.5k\nMonthly active users\n+12.4% vs last month",
    label: () => null,
    fit: (ctx) => {
      const items = kpiItems(ctx);
      const textW = Math.min(240, stackWidth(ctx, items, 240));
      return { w: Math.max(180, textW + 34), h: Math.max(110, stackHeight(ctx, items, textW + 2) + 30) };
    },
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style)), ...stackText(ctx, { x: 0, y: 0, w: ctx.w, h: ctx.h }, kpiItems(ctx), { padding: 16 })],
  },
];

export const strategyLibrary: ShapeLibrary = {
  id: "strategy",
  name: "Strategy & planning",
  description: "Business frameworks and planning: 2×2 and SWOT matrices, Venn sets, funnels, pyramids, timelines, Gantt bars, kanban, fishbone, legends and KPI cards.",
  shapes,
};
