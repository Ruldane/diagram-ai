import {
  body,
  boxPath,
  line,
  linePath,
  ovalPath,
  polyPath,
  rectPath,
  simpleShape,
  translatePath,
  type Path,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

const documentPath = (w: number, h: number): Path => {
  const wave = Math.min(h * 0.16, 14);
  return [
    ["M", 0, 0],
    ["L", w, 0],
    ["L", w, h - wave],
    ["C", w * 0.75, h - wave * 2.6, w * 0.6, h + wave * 0.9, w * 0.3, h - wave * 0.2],
    ["C", w * 0.18, h - wave * 0.6, w * 0.08, h - wave * 0.9, 0, h - wave],
    ["Z"],
  ];
};

const delayPath = (w: number, h: number): Path => {
  const r = Math.min(h / 2, w * 0.5);
  const k = r * 0.5522847498;
  return [
    ["M", 0, 0],
    ["L", w - r, 0],
    ["C", w - r + k, 0, w, h / 2 - k, w, h / 2],
    ["C", w, h / 2 + k, w - r + k, h, w - r, h],
    ["L", 0, h],
    ["Z"],
  ];
};

const displayPath = (w: number, h: number): Path => {
  const r = Math.min(h / 2, w * 0.3);
  const k = r * 0.5522847498;
  const tip = Math.min(w * 0.16, h * 0.5);
  return [
    ["M", tip, 0],
    ["L", w - r, 0],
    ["C", w - r + k, 0, w, h / 2 - k, w, h / 2],
    ["C", w, h / 2 + k, w - r + k, h, w - r, h],
    ["L", tip, h],
    ["L", 0, h / 2],
    ["Z"],
  ];
};

const storedDataPath = (w: number, h: number): Path => {
  const c = Math.min(w * 0.14, h * 0.5);
  return [
    ["M", c, 0],
    ["L", w, 0],
    ["C", w - c * 1.3, h * 0.25, w - c * 1.3, h * 0.75, w, h],
    ["L", c, h],
    ["C", -c * 0.3, h * 0.75, -c * 0.3, h * 0.25, c, 0],
    ["Z"],
  ];
};

const shapes: ShapeDef[] = [
  simpleShape({
    id: "flowchart/process",
    name: "Process",
    aliases: ["step", "action", "task", "activity"],
    description: "A step or action in the flow. The default flowchart node.",
    size: { w: 150, h: 64 },
    style: { radius: 6 },
    text: "Process",
    path: boxPath,
  }),
  simpleShape({
    id: "flowchart/decision",
    name: "Decision",
    aliases: ["if", "condition", "branch", "gateway", "choice"],
    description: "A yes/no or multi-way branch. Label outgoing edges with the outcome.",
    size: { w: 150, h: 100 },
    inset: { x: 0.2, y: 0.2 },
    text: "Decision?",
    path: (w, h) => polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  }),
  simpleShape({
    id: "flowchart/terminator",
    name: "Start / End",
    aliases: ["start", "end", "terminal", "begin", "stop"],
    description: "Entry or exit point of the flow.",
    size: { w: 140, h: 52 },
    text: "Start",
    path: (w, h) => rectPath(0, 0, w, h, h / 2),
  }),
  simpleShape({
    id: "flowchart/data",
    name: "Data (input / output)",
    aliases: ["io", "input", "output", "input-output"],
    description: "Data entering or leaving the process.",
    size: { w: 160, h: 64 },
    inset: { x: 0.12, y: 0 },
    text: "Input / Output",
    path: (w, h) => {
      const k = Math.min(w * 0.16, h * 0.5);
      return polyPath([[k, 0], [w, 0], [w - k, h], [0, h]]);
    },
  }),
  simpleShape({
    id: "flowchart/document",
    name: "Document",
    aliases: ["report", "file"],
    description: "A document or report produced or consumed by a step.",
    size: { w: 150, h: 80 },
    text: "Document",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h * 0.82 } }),
    path: documentPath,
  }),
  {
    id: "flowchart/multi-document",
    name: "Multiple documents",
    aliases: ["documents"],
    description: "Several documents.",
    size: { w: 150, h: 90 },
    text: "Documents",
    label: (ctx) => ({ box: { x: 0, y: 10, w: ctx.w - 10, h: (ctx.h - 10) * 0.8 } }),
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h } = ctx;
      const o = 5;
      const sheet = (dx: number, dy: number) => body(ctx, translatePath(documentPath(w - o * 2, h - o * 2), dx, dy));
      return [sheet(o * 2, 0), sheet(o, o), sheet(0, o * 2)];
    },
  },
  {
    id: "flowchart/predefined-process",
    name: "Predefined process",
    aliases: ["subroutine", "subprocess", "function-call"],
    description: "A named process defined elsewhere (subroutine).",
    size: { w: 160, h: 64 },
    text: "Subprocess",
    label: (ctx) => ({ box: { x: 12, y: 0, w: ctx.w - 24, h: ctx.h } }),
    draw: (ctx) => {
      const bar = Math.min(12, ctx.w * 0.1);
      return [
        body(ctx, boxPath(ctx.w, ctx.h, ctx.style)),
        line(ctx, linePath(bar, 0, bar, ctx.h)),
        line(ctx, linePath(ctx.w - bar, 0, ctx.w - bar, ctx.h)),
      ];
    },
  },
  simpleShape({
    id: "flowchart/manual-input",
    name: "Manual input",
    aliases: ["keyboard-input"],
    description: "Data entered by a person.",
    size: { w: 150, h: 70 },
    text: "Manual input",
    label: (ctx) => ({ box: { x: 0, y: ctx.h * 0.2, w: ctx.w, h: ctx.h * 0.8 } }),
    path: (w, h) => polyPath([[0, h * 0.3], [w, 0], [w, h], [0, h]]),
  }),
  simpleShape({
    id: "flowchart/manual-operation",
    name: "Manual operation",
    description: "A step performed by a person.",
    size: { w: 150, h: 64 },
    inset: { x: 0.14, y: 0 },
    text: "Manual step",
    path: (w, h) => {
      const k = Math.min(w * 0.16, h * 0.5);
      return polyPath([[0, 0], [w, 0], [w - k, h], [k, h]]);
    },
  }),
  simpleShape({
    id: "flowchart/preparation",
    name: "Preparation",
    aliases: ["setup", "loop-limit", "init"],
    description: "Set-up or initialisation step.",
    size: { w: 160, h: 64 },
    inset: { x: 0.14, y: 0 },
    text: "Preparation",
    path: (w, h) => {
      const k = Math.min(w * 0.16, h * 0.5);
      return polyPath([[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]]);
    },
  }),
  simpleShape({
    id: "flowchart/delay",
    name: "Delay",
    aliases: ["wait"],
    description: "A waiting period.",
    size: { w: 130, h: 64 },
    text: "Delay",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w * 0.86, h: ctx.h } }),
    path: delayPath,
  }),
  simpleShape({
    id: "flowchart/display",
    name: "Display",
    aliases: ["screen-output"],
    description: "Information shown to a user.",
    size: { w: 150, h: 64 },
    inset: { x: 0.14, y: 0 },
    text: "Display",
    path: displayPath,
  }),
  simpleShape({
    id: "flowchart/stored-data",
    name: "Stored data",
    aliases: ["data-storage"],
    description: "Data held in storage.",
    size: { w: 150, h: 64 },
    inset: { x: 0.12, y: 0 },
    text: "Stored data",
    path: storedDataPath,
  }),
  {
    id: "flowchart/internal-storage",
    name: "Internal storage",
    aliases: ["memory"],
    description: "Data held in memory.",
    size: { w: 120, h: 90 },
    text: "Memory",
    label: (ctx) => ({ box: { x: 14, y: 14, w: ctx.w - 14, h: ctx.h - 14 } }),
    draw: (ctx) => [
      body(ctx, boxPath(ctx.w, ctx.h, ctx.style)),
      line(ctx, linePath(14, 0, 14, ctx.h)),
      line(ctx, linePath(0, 14, ctx.w, 14)),
    ],
  },
  simpleShape({
    id: "flowchart/connector",
    name: "Connector",
    aliases: ["on-page-connector", "junction", "jump"],
    description: "Jump to another point on the same page; label it with a letter.",
    size: { w: 44, h: 44 },
    keepAspect: true,
    text: "A",
    path: ovalPath,
  }),
  simpleShape({
    id: "flowchart/off-page",
    name: "Off-page connector",
    aliases: ["off-page-connector"],
    description: "Continuation on another page.",
    size: { w: 70, h: 70 },
    text: "1",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h * 0.72 } }),
    path: (w, h) => polyPath([[0, 0], [w, 0], [w, h * 0.6], [w / 2, h], [0, h * 0.6]]),
  }),
  simpleShape({
    id: "flowchart/merge",
    name: "Merge",
    description: "Several flows merging into one.",
    size: { w: 90, h: 76 },
    label: (ctx) => ({ box: { x: ctx.w * 0.2, y: 0, w: ctx.w * 0.6, h: ctx.h * 0.6 } }),
    path: (w, h) => polyPath([[0, 0], [w, 0], [w / 2, h]]),
  }),
  simpleShape({
    id: "flowchart/extract",
    name: "Extract",
    description: "One flow splitting into several.",
    size: { w: 90, h: 76 },
    label: (ctx) => ({ box: { x: ctx.w * 0.2, y: ctx.h * 0.4, w: ctx.w * 0.6, h: ctx.h * 0.6 } }),
    path: (w, h) => polyPath([[w / 2, 0], [w, h], [0, h]]),
  }),
  {
    id: "flowchart/or",
    name: "Or",
    aliases: ["or-junction"],
    description: "Logical OR junction.",
    size: { w: 48, h: 48 },
    keepAspect: true,
    label: () => null,
    outline: ovalPath,
    draw: (ctx) => [
      body(ctx, ovalPath(ctx.w, ctx.h)),
      line(ctx, linePath(ctx.w / 2, 0, ctx.w / 2, ctx.h)),
      line(ctx, linePath(0, ctx.h / 2, ctx.w, ctx.h / 2)),
    ],
  },
  {
    id: "flowchart/summing-junction",
    name: "Summing junction",
    aliases: ["and-junction", "sum"],
    description: "Logical AND / summing junction.",
    size: { w: 48, h: 48 },
    keepAspect: true,
    label: () => null,
    outline: ovalPath,
    draw: (ctx) => {
      const k = 0.1464;
      const { w, h } = ctx;
      return [
        body(ctx, ovalPath(w, h)),
        line(ctx, linePath(w * k, h * k, w * (1 - k), h * (1 - k))),
        line(ctx, linePath(w * (1 - k), h * k, w * k, h * (1 - k))),
      ];
    },
  },
  simpleShape({
    id: "flowchart/collate",
    name: "Collate",
    description: "Organise data into a standard format.",
    size: { w: 70, h: 80 },
    label: () => null,
    path: (w, h) => polyPath([[0, 0], [w, 0], [0, h], [w, h]]),
  }),
  simpleShape({
    id: "flowchart/sort",
    name: "Sort",
    description: "Sort data into an order.",
    size: { w: 80, h: 90 },
    label: () => null,
    path: (w, h) => polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
    extra: (ctx) => [line(ctx, linePath(0, ctx.h / 2, ctx.w, ctx.h / 2))],
  }),
  simpleShape({
    id: "flowchart/card",
    name: "Card",
    aliases: ["punched-card"],
    description: "Card / record.",
    size: { w: 140, h: 70 },
    text: "Card",
    path: (w, h) => {
      const k = Math.min(16, w * 0.2, h * 0.4);
      return polyPath([[k, 0], [w, 0], [w, h], [0, h], [0, k]]);
    },
  }),
  simpleShape({
    id: "flowchart/loop-limit",
    name: "Loop limit",
    aliases: ["loop"],
    description: "Start or end of a loop.",
    size: { w: 140, h: 60 },
    text: "Loop",
    path: (w, h) => {
      const k = Math.min(16, w * 0.2, h * 0.5);
      return polyPath([[k, 0], [w - k, 0], [w, k], [w, h], [0, h], [0, k]]);
    },
  }),
];

export const flowchartLibrary: ShapeLibrary = {
  id: "flowchart",
  name: "Flowchart",
  description: "Standard flowchart symbols (ISO 5807): process, decision, start/end, data, document and friends.",
  shapes,
};
