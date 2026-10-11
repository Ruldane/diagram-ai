import {
  body,
  fontOf,
  line,
  linePath,
  measureText,
  ovalPath,
  param,
  rectPath,
  shade,
  solid,
  text,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

/** Short identifier from `node.data` (`"1.0"`, `"D1"`); numbers are accepted too. */
function tag(ctx: Pick<ShapeCtx, "data">, key: string): string {
  const value = ctx.data[key];
  return typeof value === "number" ? String(value) : param(ctx, key, "").trim();
}

const smallFont = (ctx: Pick<ShapeCtx, "style">) => ({ size: ctx.style.fontSize * 0.85, bold: false });

/** Height of the numbered band at the top of a process bubble. */
const PROCESS_BAND = 0.28;

/** Offset of the back plate that gives an external entity its double edge. */
const plateOffset = (w: number, h: number) => Math.min(5, w * 0.08, h * 0.08);

/** Width of the ID box of a data store, sized to its label. */
function storeIdWidth(ctx: ShapeCtx): number {
  const id = tag(ctx, "id");
  if (!id) return 0;
  return Math.min(ctx.w * 0.4, Math.max(32, measureText(id, fontOf(ctx.style, { bold: true })) + 16));
}

const shapes: ShapeDef[] = [
  {
    id: "dfd/process",
    name: "Process",
    aliases: ["dfd-process", "process-bubble", "transform", "dfd-function"],
    keywords: ["bubble", "function", "yourdon", "gane-sarson"],
    description: "DFD process that transforms incoming data flows into outgoing ones. `data.number` (e.g. \"1.0\") adds a numbered band.",
    size: { w: 110, h: 110 },
    inset: { x: 0.12, y: 0.12 },
    text: "Process",
    data: { number: "" },
    label: (ctx) =>
      tag(ctx, "number") ? { box: { x: ctx.w * 0.1, y: ctx.h * PROCESS_BAND, w: ctx.w * 0.8, h: ctx.h * (0.9 - PROCESS_BAND) } } : {},
    outline: ovalPath,
    draw: (ctx) => {
      const { w, h } = ctx;
      const number = tag(ctx, "number");
      const prims: Prim[] = [body(ctx, ovalPath(w, h))];
      if (!number) return prims;
      // Chord of the ellipse at the bottom of the band.
      const y = h * PROCESS_BAND;
      const half = (w / 2) * Math.sqrt(1 - (1 - 2 * PROCESS_BAND) ** 2);
      prims.push(
        line(ctx, linePath(w / 2 - half, y, w / 2 + half, y), { strokeWidth: Math.min(ctx.style.strokeWidth, 1.25) }),
        text(ctx, number, { x: 0, y: h * 0.06, w, h: y - h * 0.06 }, { font: smallFont(ctx), align: "center", valign: "middle", wrap: false }),
      );
      return prims;
    },
  },
  {
    id: "dfd/external-entity",
    name: "External entity",
    aliases: ["terminator", "source", "sink", "external", "dfd-entity", "dfd-terminator"],
    keywords: ["actor", "outside system", "origin", "destination"],
    description: "DFD external entity (terminator): a person, organisation or system outside the model that sends or receives data.",
    size: { w: 140, h: 70 },
    text: "External entity",
    label: (ctx) => {
      const o = plateOffset(ctx.w, ctx.h);
      return { box: { x: 0, y: 0, w: ctx.w - o, h: ctx.h - o } };
    },
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const o = plateOffset(w, h);
      const front = body(ctx, rectPath(0, 0, w - o, h - o, style.radius));
      // Unfilled, the back plate would show through: draw only the edge that sticks out.
      if (style.fill === "none") return [line(ctx, [["M", w - o, o], ["L", w, o], ["L", w, h], ["L", o, h], ["L", o, h - o]]), front];
      return [body(ctx, rectPath(o, o, w - o, h - o, style.radius), { fill: shade(style.fill, 0.14) }), front];
    },
  },
  {
    id: "dfd/data-store",
    name: "Data store",
    aliases: ["dfd-store", "dfd-data-store", "file-store", "data-file"],
    keywords: ["database", "file", "repository", "open rectangle"],
    description: "DFD data store: data at rest (table, file, queue). `data.id` (e.g. \"D1\") adds an ID box on the left.",
    size: { w: 160, h: 50 },
    text: "Data store",
    data: { id: "" },
    label: (ctx) => {
      const idW = storeIdWidth(ctx);
      return { box: { x: idW, y: 0, w: ctx.w - idW, h: ctx.h } };
    },
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const idW = storeIdWidth(ctx);
      const fill = solid(rectPath(0, 0, w, h), style.fill);
      if (!idW) return [fill, line(ctx, [["M", 0, 0], ["L", w, 0], ["M", 0, h], ["L", w, h]], { dash: style.dash })];
      // Gane-Sarson: closed on the left with a box holding the store ID.
      const edges: Path = [["M", w, 0], ["L", 0, 0], ["L", 0, h], ["L", w, h], ["M", idW, 0], ["L", idW, h]];
      return [
        fill,
        solid(rectPath(0, 0, idW, h), shade(style.fill, 0.06)),
        line(ctx, edges, { dash: style.dash }),
        text(ctx, tag(ctx, "id"), { x: 0, y: 0, w: idW, h }, { font: { bold: true }, align: "center", valign: "middle", wrap: false }),
      ];
    },
  },
];

export const dfdLibrary: ShapeLibrary = {
  id: "dfd",
  name: "Data flow",
  description: "Data flow diagrams: processes, external entities and data stores. Label the connectors with the data they carry.",
  shapes,
};
