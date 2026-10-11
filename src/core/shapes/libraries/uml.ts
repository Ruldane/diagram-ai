import { compartmentBox, compartmentFit, stackHeight, stackText, stackWidth, type CompartmentOptions, type StackItem } from "../compartments";
import {
  body,
  boxPath,
  ellipsePath,
  fontOf,
  line,
  linePath,
  linesHeight,
  measureBlock,
  measureText,
  ovalPath,
  param,
  polyPath,
  rectPath,
  shade,
  simpleShape,
  solid,
  text,
  tint,
  type LabelSpec,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

type Style = ShapeCtx["style"];
type Size = ShapeDef["size"];
type FitCtx = Omit<ShapeCtx, "w" | "h">;

/** Colour of solid marks (initial state, fork bar): the stroke, or the text colour when unstroked. */
const inkOf = (style: Style) => (style.stroke === "none" ? style.textColor : style.stroke);

/** Stroke for small decorations, never heavier than a hairline. */
const thin = (style: Style) => ({ strokeWidth: Math.min(style.strokeWidth, 1.25), dash: "solid" as const });

/** Label under the symbol, outside the node box. */
const labelBelow = (ctx: ShapeCtx): LabelSpec => ({ box: { x: -50, y: ctx.h + 4, w: ctx.w + 100, h: 40 }, valign: "top", padding: 0 });

/** Content size for shapes that define `fit` but still use the automatic label. */
function labelFit(ctx: FitCtx, min: Size): Size {
  const content = measureBlock(ctx.text, fontOf(ctx.style), 220);
  return { w: Math.max(min.w, content.w + 20), h: Math.max(min.h, content.h + 20) };
}

/* ------------------------------------------------------------ stereotypes */

const STEREOTYPE = /^\s*(?:«\s*(.+?)\s*»|<<\s*(.+?)\s*>>)\s*$/;

/** Splits a leading `«stereotype»` / `<<stereotype>>` line off `value`, falling back to `data.stereotype`. */
function splitStereotype(ctx: Pick<ShapeCtx, "data">, value: string): { stereotype?: string; rest: string } {
  const [first = "", ...rest] = value.split("\n");
  const match = STEREOTYPE.exec(first);
  if (match) return { stereotype: `«${match[1] ?? match[2]}»`, rest: rest.join("\n") };
  const named = param(ctx, "stereotype", "");
  return { stereotype: named ? `«${named}»` : undefined, rest: value };
}

/** Stereotype line (small) above the name, for boxes that centre their title. */
function titleItems(ctx: Pick<ShapeCtx, "text" | "data" | "style">): StackItem[] {
  const { stereotype, rest } = splitStereotype(ctx, ctx.text);
  return [
    { text: stereotype ?? "", font: { size: ctx.style.fontSize * 0.85, bold: false, italic: false } },
    { text: rest, gap: 1 },
  ];
}

function titledFit(ctx: FitCtx, min: Size): Size {
  const items = titleItems(ctx);
  // 48 = text padding plus room for the corner glyph.
  const w = Math.max(min.w, stackWidth(ctx, items, 220) + 48);
  return { w, h: Math.max(min.h, stackHeight(ctx, items, w - 20) + 20) };
}

/* ------------------------------------------------------------ classifiers */

/** Compartment options and sections of a classifier, with the stereotype line lifted out of the header. */
function classifier(ctx: FitCtx, options: CompartmentOptions): { sections: string[]; options: CompartmentOptions } {
  const { stereotype, rest } = splitStereotype(ctx, ctx.sections[0] ?? "");
  return {
    sections: [rest, ...ctx.sections.slice(1)],
    options: {
      bodyFont: { family: "mono", size: ctx.style.fontSize * 0.86 },
      ...options,
      stereotype,
      italicHeader: param(ctx, "abstract", false),
    },
  };
}

/** Class-like box: name header, then one compartment per `---` section. */
function classifierShape(def: Omit<ShapeDef, "draw" | "fit" | "label">, options: CompartmentOptions): ShapeDef {
  return {
    minSize: { w: 80, h: 40 },
    ...def,
    label: () => null,
    fit: (ctx) => {
      const c = classifier(ctx, options);
      return compartmentFit({ style: ctx.style, sections: c.sections }, c.options, { w: def.size.w, h: 0 });
    },
    draw: (ctx) => {
      const c = classifier(ctx, options);
      return compartmentBox({ ...ctx, sections: c.sections }, c.options);
    },
  };
}

/* ----------------------------------------------------------------- glyphs */

/** Stick figure filling the given box. */
function stickFigure(ctx: ShapeCtx, x: number, y: number, w: number, h: number): Prim[] {
  const cx = x + w / 2;
  const r = Math.min(w * 0.26, h * 0.16);
  const neck = y + r * 2;
  const hip = y + h * 0.64;
  const arms = neck + (hip - neck) * 0.3;
  const limbs: Path = [
    ["M", cx, neck],
    ["L", cx, hip],
    ["M", x, arms],
    ["L", x + w, arms],
    ["M", x + w * 0.1, y + h],
    ["L", cx, hip],
    ["L", x + w * 0.9, y + h],
  ];
  return [line(ctx, limbs, { round: true }), body(ctx, ellipsePath(cx, y + r, r, r), { dash: "solid" })];
}

/** Square slot in the top-right corner for a decoration glyph. */
function corner(ctx: ShapeCtx, max = 18): { x: number; y: number; s: number } {
  const s = Math.min(max, ctx.w * 0.2, ctx.h * 0.4);
  const margin = Math.min(8, s * 0.5);
  return { x: ctx.w - s - margin, y: margin, s };
}

/** UML component glyph: a box with two lugs on its left edge. */
function componentGlyph(ctx: ShapeCtx): Prim[] {
  const { x, y, s } = corner(ctx);
  const lug = (top: number) => body(ctx, rectPath(x, y + s * top, s * 0.5, s * 0.22), thin(ctx.style));
  return [body(ctx, rectPath(x + s * 0.25, y, s * 0.75, s), thin(ctx.style)), lug(0.16), lug(0.62)];
}

/** Small dog-eared page. */
function documentGlyph(ctx: ShapeCtx): Prim[] {
  const { x, y, s } = corner(ctx);
  const left = x + s * 0.22;
  const right = x + s;
  const fold = s * 0.3;
  return [
    body(ctx, polyPath([[left, y], [right - fold, y], [right, y + fold], [right, y + s], [left, y + s]]), thin(ctx.style)),
    line(ctx, [["M", right - fold, y], ["L", right - fold, y + fold], ["L", right, y + fold]], thin(ctx.style)),
  ];
}

const bullseye = (ctx: ShapeCtx): Prim[] => [
  body(ctx, ovalPath(ctx.w, ctx.h)),
  solid(ellipsePath(ctx.w / 2, ctx.h / 2, ctx.w * 0.3, ctx.h * 0.3), inkOf(ctx.style)),
];

/** Shared by the unlabeled circular pseudostates. */
const pseudostate = { keepAspect: true, label: () => null, outline: ovalPath } satisfies Partial<ShapeDef>;

/* --------------------------------------------------------------- structure */

const PACKAGE_TAB = 24;

/** Folder tab: a fixed share of the width, widened when the name needs it. */
function packageTab(w: number, h: number, name?: { text: string; style: Style }): { tw: number; th: number } {
  const base = Math.min(w * 0.4, 120);
  const wanted = name ? measureText(name.text.split("\n")[0], fontOf(name.style)) + 24 : 0;
  return { tw: Math.min(w * 0.9, Math.max(base, wanted)), th: Math.min(PACKAGE_TAB, h * 0.3) };
}

const NODE_DEPTH = 14;
const nodeDepth = (w: number, h: number) => Math.min(NODE_DEPTH, w * 0.12, h * 0.12);

const structure: ShapeDef[] = [
  classifierShape(
    {
      id: "uml/class",
      name: "Class",
      aliases: ["uml-class", "class-box"],
      keywords: ["classifier", "attributes", "operations", "methods", "oop"],
      description:
        "UML class: name, then `---`, attributes, `---`, operations. Start with a `«stereotype»` line to tag it; `data.abstract` italicises the name.",
      size: { w: 180, h: 120 },
      text: "ClassName\n---\n- id: string\n- name: string\n---\n+ save(): void",
      data: { abstract: false },
    },
    { minSections: 2 },
  ),
  classifierShape(
    {
      id: "uml/interface",
      name: "Interface",
      aliases: ["uml-interface", "interface-class"],
      keywords: ["contract", "protocol", "operations"],
      description: "UML interface: «interface» header, then `---` and its operations.",
      size: { w: 180, h: 100 },
      text: "Repository\n---\n+ find(id): Entity\n+ save(e: Entity)",
      data: { stereotype: "interface" },
    },
    { minSections: 1 },
  ),
  classifierShape(
    {
      id: "uml/enum",
      name: "Enumeration",
      aliases: ["enumeration", "uml-enum"],
      keywords: ["literals", "constants"],
      description: "UML enumeration: «enumeration» header, then `---` and one literal per line.",
      size: { w: 160, h: 140 },
      text: "OrderStatus\n---\nPENDING\nPAID\nSHIPPED\nCANCELLED",
      data: { stereotype: "enumeration" },
    },
    { minSections: 1 },
  ),
  classifierShape(
    {
      id: "uml/object",
      name: "Object",
      aliases: ["uml-object", "object-instance", "instance-specification"],
      keywords: ["instance", "slots", "values"],
      description: "UML object (instance): underlined `name: Type`, then `---` and slot values.",
      size: { w: 160, h: 90 },
      text: "order: Order\n---\nid = 42\nstatus = PAID",
    },
    { minSections: 1, underlineHeader: true },
  ),
  {
    id: "uml/package",
    name: "Package",
    aliases: ["uml-package", "package-folder"],
    keywords: ["namespace", "folder", "module", "group"],
    description: "UML package: folder-shaped container grouping classes or other packages.",
    size: { w: 320, h: 220 },
    minSize: { w: 100, h: 70 },
    container: { header: PACKAGE_TAB + 12, padding: 20 },
    style: { fill: "#fafafa", strokeWidth: 1.25, align: "left", bold: true, fontSize: 13 },
    text: "package",
    label: (ctx) => {
      const { tw, th } = packageTab(ctx.w, ctx.h, ctx);
      return { box: { x: 0, y: 0, w: tw, h: th }, valign: "middle", wrap: false };
    },
    // The outline cannot see the label, so it uses the base tab width.
    outline: (w, h) => {
      const { tw, th } = packageTab(w, h);
      return polyPath([[0, 0], [tw, 0], [tw, th], [w, th], [w, h], [0, h]]);
    },
    draw: (ctx) => {
      const { w, h } = ctx;
      const { tw, th } = packageTab(w, h, ctx);
      return [body(ctx, rectPath(0, 0, tw, th)), body(ctx, rectPath(0, th, w, h - th))];
    },
  },
  {
    id: "uml/component",
    name: "Component",
    aliases: ["uml-component", "software-component"],
    keywords: ["module", "service", "subsystem"],
    description: "UML component: a replaceable part of the system with the component glyph in its corner.",
    size: { w: 160, h: 70 },
    text: "Component",
    label: () => null,
    fit: (ctx) => titledFit(ctx, { w: 160, h: 70 }),
    draw: (ctx) => [
      body(ctx, boxPath(ctx.w, ctx.h, ctx.style)),
      ...componentGlyph(ctx),
      ...stackText(ctx, { x: 0, y: 0, w: ctx.w, h: ctx.h }, titleItems(ctx)),
    ],
  },
  {
    id: "uml/node",
    name: "Node",
    aliases: ["deployment-node", "uml-node", "device-node"],
    keywords: ["device", "server", "execution environment", "deployment", "3d"],
    description: "UML deployment node (device or execution environment): 3D box container holding artifacts.",
    size: { w: 260, h: 180 },
    minSize: { w: 80, h: 60 },
    container: { header: NODE_DEPTH + 34, padding: 16 },
    style: { fill: "#fafafa", bold: true, fontSize: 13 },
    text: "Node",
    label: (ctx) => {
      const d = nodeDepth(ctx.w, ctx.h);
      return { box: { x: 0, y: d, w: ctx.w - d, h: ctx.h - d }, valign: "top", padding: 8 };
    },
    outline: (w, h) => {
      const d = nodeDepth(w, h);
      return polyPath([[d, 0], [w, 0], [w, h - d], [w - d, h], [0, h], [0, d]]);
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const d = nodeDepth(w, h);
      return [
        body(ctx, polyPath([[0, d], [d, 0], [w, 0], [w - d, d]]), { fill: shade(style.fill, 0.04) }),
        body(ctx, polyPath([[w - d, d], [w, 0], [w, h - d], [w - d, h]]), { fill: shade(style.fill, 0.1) }),
        body(ctx, rectPath(0, d, w - d, h - d)),
      ];
    },
  },
  {
    id: "uml/artifact",
    name: "Artifact",
    aliases: ["uml-artifact", "deployment-artifact"],
    keywords: ["file", "jar", "binary", "deployable"],
    description: "UML artifact: a deployable file (jar, image, script) placed on a node.",
    size: { w: 160, h: 70 },
    text: "app.jar",
    data: { stereotype: "artifact" },
    label: () => null,
    fit: (ctx) => titledFit(ctx, { w: 160, h: 70 }),
    draw: (ctx) => [
      body(ctx, boxPath(ctx.w, ctx.h, ctx.style)),
      ...documentGlyph(ctx),
      ...stackText(ctx, { x: 0, y: 0, w: ctx.w, h: ctx.h }, titleItems(ctx)),
    ],
  },
  simpleShape({
    id: "uml/note",
    name: "Note",
    aliases: ["uml-note", "uml-comment", "comment-note"],
    keywords: ["annotation", "constraint", "remark"],
    description: "UML note with a folded corner. Attach it with a dashed connector.",
    size: { w: 160, h: 80 },
    style: { fill: "#fff9db", align: "left", valign: "top", fontSize: 13 },
    text: "Note",
    label: (ctx) => {
      const fold = Math.min(16, ctx.w * 0.25, ctx.h * 0.25);
      return { box: { x: 0, y: 0, w: ctx.w - fold * 0.5, h: ctx.h } };
    },
    path: (w, h) => {
      const fold = Math.min(16, w * 0.25, h * 0.25);
      return polyPath([[0, 0], [w - fold, 0], [w, fold], [w, h], [0, h]]);
    },
    extra: (ctx) => {
      const { w, h, style } = ctx;
      const fold = Math.min(16, w * 0.25, h * 0.25);
      return [body(ctx, polyPath([[w - fold, 0], [w - fold, fold], [w, fold]]), { fill: shade(style.fill, 0.1), dash: "solid" })];
    },
  }),
  {
    id: "uml/actor",
    name: "Actor",
    aliases: ["user", "person", "stick-figure", "uml-actor"],
    keywords: ["role", "human", "use case"],
    description: "UML actor: a person or external system interacting with the subject.",
    size: { w: 50, h: 80 },
    minSize: { w: 16, h: 24 },
    style: { fontSize: 13 },
    text: "Actor",
    label: labelBelow,
    draw: (ctx) => stickFigure(ctx, 0, 0, ctx.w, ctx.h),
  },
  simpleShape({
    id: "uml/use-case",
    name: "Use case",
    aliases: ["usecase", "uml-use-case"],
    keywords: ["goal", "scenario", "functionality"],
    description: "UML use case: a goal an actor achieves with the system.",
    size: { w: 150, h: 70 },
    inset: { x: 0.14, y: 0.14 },
    text: "Use case",
    path: ovalPath,
  }),
  {
    id: "uml/system-boundary",
    name: "System boundary",
    aliases: ["subject", "use-case-system", "system-box"],
    keywords: ["container", "scope", "use case"],
    description: "Use-case subject: container around the use cases a system provides, actors stay outside.",
    size: { w: 360, h: 420 },
    minSize: { w: 120, h: 100 },
    container: { header: 36, padding: 24 },
    style: { fill: "#fafafa", strokeWidth: 1.25, bold: true },
    text: "System",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: Math.min(36, ctx.h) }, wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))],
  },
];

/* --------------------------------------------------------------- behaviour */

const STATE_SIZE: Size = { w: 140, h: 60 };
const STATE_BOX: CompartmentOptions = { headerFill: "none" };

const LANE_HEADER = 32;
const LANE_SIDE = 40;
const horizontalLane = (ctx: Pick<ShapeCtx, "data">) => param<string>(ctx, "orientation", "vertical") === "horizontal";

/** Title strip of a horizontal lane: wide enough that no word of the name has to be broken. */
function laneSide(ctx: Pick<ShapeCtx, "w" | "text" | "style">): number {
  const font = fontOf(ctx.style);
  const widest = Math.max(0, ...ctx.text.split(/\s+/).map((word) => measureText(word, font)));
  return Math.min(ctx.w * 0.4, Math.max(LANE_SIDE, widest + 12));
}

/** Pentagon notch / point depth of the signal actions. */
const signalTip = (w: number, h: number) => Math.min(h / 2, w * 0.2);

const behaviour: ShapeDef[] = [
  {
    id: "uml/state",
    name: "State",
    aliases: ["uml-state", "state-node", "simple-state"],
    keywords: ["state machine", "statechart", "entry", "exit", "do"],
    description: "State of a state machine. Add `---` then lines like `entry / start()` for internal activities.",
    size: STATE_SIZE,
    style: { radius: 12 },
    text: "State",
    label: (ctx) => (ctx.sections.length > 1 ? null : {}),
    fit: (ctx) => (ctx.sections.length > 1 ? compartmentFit(ctx, STATE_BOX, STATE_SIZE) : labelFit(ctx, STATE_SIZE)),
    draw: (ctx) => (ctx.sections.length > 1 ? compartmentBox(ctx, STATE_BOX) : [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))]),
  },
  {
    ...pseudostate,
    id: "uml/initial-state",
    name: "Initial state",
    aliases: ["initial", "start-state", "initial-node", "initial-pseudostate"],
    description: "Filled dot marking where a state machine or activity starts.",
    size: { w: 24, h: 24 },
    draw: (ctx) => [solid(ovalPath(ctx.w, ctx.h), inkOf(ctx.style))],
  },
  {
    ...pseudostate,
    id: "uml/final-state",
    name: "Final state",
    aliases: ["final", "end-state", "final-pseudostate"],
    description: "Bullseye marking where a state machine ends.",
    size: { w: 28, h: 28 },
    draw: bullseye,
  },
  simpleShape({
    id: "uml/choice",
    name: "Choice",
    aliases: ["choice-pseudostate", "uml-choice", "decision-node", "merge-node"],
    keywords: ["branch", "guard", "decision", "merge"],
    description: "Small diamond for a guarded branch or merge. Put the guards on the outgoing edges.",
    size: { w: 36, h: 36 },
    label: labelBelow,
    path: (w, h) => polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  }),
  {
    id: "uml/fork-join",
    name: "Fork / join",
    aliases: ["fork", "join", "fork-node", "join-node", "sync-bar"],
    keywords: ["parallel", "concurrent", "synchronisation"],
    description: "Thick bar splitting one flow into parallel flows or joining them back. Resize it tall for a vertical bar.",
    size: { w: 120, h: 8 },
    minSize: { w: 4, h: 4 },
    label: () => null,
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => [solid(rectPath(0, 0, ctx.w, ctx.h, Math.min(2, ctx.w / 4, ctx.h / 4)), inkOf(ctx.style))],
  },
  {
    ...pseudostate,
    id: "uml/history",
    name: "History",
    aliases: ["history-state", "history-pseudostate", "shallow-history", "deep-history"],
    description: "History pseudostate: re-enter the last active substate. `data.deep` shows H* (deep history).",
    size: { w: 32, h: 32 },
    data: { deep: false },
    draw: (ctx) => [
      body(ctx, ovalPath(ctx.w, ctx.h)),
      text(ctx, param(ctx, "deep", false) ? "H*" : "H", { x: 0, y: 0, w: ctx.w, h: ctx.h }, {
        font: { bold: true, size: Math.min(ctx.style.fontSize, ctx.h * 0.5) },
        align: "center",
        valign: "middle",
        wrap: false,
      }),
    ],
  },
  simpleShape({
    id: "uml/action",
    name: "Action",
    aliases: ["activity-action", "uml-action", "action-node"],
    keywords: ["activity", "step", "behaviour"],
    description: "Activity diagram action: one step of behaviour.",
    size: { w: 140, h: 60 },
    style: { radius: 14 },
    text: "Action",
    path: boxPath,
  }),
  simpleShape({
    id: "uml/object-node",
    name: "Object node",
    aliases: ["activity-object", "uml-object-node", "data-object-node"],
    keywords: ["activity", "data", "object flow", "pin"],
    description: "Activity diagram object node: data passed between actions. Add `[state]` on a second line.",
    size: { w: 130, h: 50 },
    text: "Order",
    path: boxPath,
  }),
  {
    ...pseudostate,
    id: "uml/activity-final",
    name: "Activity final",
    aliases: ["activity-end", "final-node", "activity-final-node"],
    description: "Bullseye ending the whole activity.",
    size: { w: 28, h: 28 },
    draw: bullseye,
  },
  {
    ...pseudostate,
    id: "uml/flow-final",
    name: "Flow final",
    aliases: ["flow-end", "flow-final-node"],
    description: "Circled X ending a single flow while the rest of the activity continues.",
    size: { w: 28, h: 28 },
    draw: (ctx) => {
      const { w, h } = ctx;
      const k = 0.1464;
      return [
        body(ctx, ovalPath(w, h)),
        line(ctx, [["M", w * k, h * k], ["L", w * (1 - k), h * (1 - k)], ["M", w * (1 - k), h * k], ["L", w * k, h * (1 - k)]]),
      ];
    },
  },
  simpleShape({
    id: "uml/send-signal",
    name: "Send signal",
    aliases: ["send-signal-action", "signal-send", "send-event"],
    keywords: ["activity", "event", "message", "emit"],
    description: "Activity action that sends a signal (convex pentagon pointing right).",
    size: { w: 150, h: 60 },
    text: "Send signal",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w - signalTip(ctx.w, ctx.h) * 0.6, h: ctx.h } }),
    path: (w, h) => {
      const k = signalTip(w, h);
      return polyPath([[0, 0], [w - k, 0], [w, h / 2], [w - k, h], [0, h]]);
    },
  }),
  simpleShape({
    id: "uml/receive-signal",
    name: "Receive signal",
    aliases: ["accept-event", "accept-event-action", "receive-signal-action", "signal-receive"],
    keywords: ["activity", "event", "message", "wait"],
    description: "Activity action that waits for a signal or event (pentagon notched on the left).",
    size: { w: 150, h: 60 },
    text: "Receive signal",
    label: (ctx) => {
      const k = signalTip(ctx.w, ctx.h) * 0.6;
      return { box: { x: k, y: 0, w: ctx.w - k, h: ctx.h } };
    },
    path: (w, h) => polyPath([[0, 0], [w, 0], [w, h], [0, h], [signalTip(w, h), h / 2]]),
  }),
  {
    id: "uml/swimlane",
    name: "Swimlane",
    aliases: ["activity-partition", "partition", "uml-swimlane"],
    keywords: ["lane", "responsibility", "role", "activity"],
    description:
      "Activity partition: container for the actions one role performs. `data.orientation` is `vertical` (title on top) or `horizontal` (title on the left).",
    size: { w: 220, h: 420 },
    minSize: { w: 80, h: 80 },
    container: { header: LANE_HEADER, padding: 16 },
    style: { strokeWidth: 1.25, bold: true, fontSize: 13 },
    text: "Lane",
    data: { orientation: "vertical" },
    label: (ctx) =>
      horizontalLane(ctx)
        ? { box: { x: 0, y: 0, w: laneSide(ctx), h: ctx.h }, padding: 4 }
        : { box: { x: 0, y: 0, w: ctx.w, h: Math.min(LANE_HEADER, ctx.h) }, wrap: false },
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const strip = horizontalLane(ctx) ? rectPath(0, 0, laneSide(ctx), h) : rectPath(0, 0, w, Math.min(LANE_HEADER, h));
      return [body(ctx, rectPath(0, 0, w, h)), body(ctx, strip, { fill: shade(style.fill, 0.05) })];
    },
  },
];

/* ---------------------------------------------------------------- sequence */

const LIFELINE_HEADER = 40;
const ACTOR_HEADER = 64;

/** Header height of a lifeline: `data.header`, clamped to the node. */
const lifelineHeader = (ctx: Pick<ShapeCtx, "data" | "h">, fallback: number) => Math.max(0, Math.min(param(ctx, "header", fallback), ctx.h));

/** Dashed stem from the bottom centre of the header to the bottom of the node. */
const lifelineStem = (ctx: ShapeCtx, top: number) => line(ctx, linePath(ctx.w / 2, top, ctx.w / 2, ctx.h), { dash: "dashed" });

/** Height reserved for the name under the figure of an actor lifeline. */
const actorNameHeight = (ctx: ShapeCtx, header: number) => Math.min(header * 0.4, linesHeight(1, ctx.style.fontSize) + 4);

const sequence: ShapeDef[] = [
  {
    id: "uml/lifeline",
    name: "Lifeline",
    aliases: ["participant", "sequence-lifeline", "sequence-participant", "object-lifeline"],
    keywords: ["sequence", "interaction", "object"],
    description: "Sequence diagram participant: header box with a dashed lifeline below. Messages attach anywhere along it.",
    size: { w: 140, h: 320 },
    minSize: { w: 40, h: 60 },
    text: "Participant",
    data: { header: LIFELINE_HEADER },
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: lifelineHeader(ctx, LIFELINE_HEADER) } }),
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const top = lifelineHeader(ctx, LIFELINE_HEADER);
      return [body(ctx, rectPath(0, 0, ctx.w, top, ctx.style.radius)), lifelineStem(ctx, top)];
    },
  },
  {
    id: "uml/actor-lifeline",
    name: "Actor lifeline",
    aliases: ["actor-participant", "sequence-actor", "user-lifeline"],
    keywords: ["sequence", "interaction", "person", "user"],
    description: "Sequence diagram participant drawn as a stick figure (a person or external system) with a dashed lifeline below.",
    size: { w: 140, h: 320 },
    minSize: { w: 40, h: 80 },
    text: "User",
    data: { header: ACTOR_HEADER },
    label: (ctx) => {
      const top = lifelineHeader(ctx, ACTOR_HEADER);
      const nameH = actorNameHeight(ctx, top);
      return { box: { x: 0, y: top - nameH, w: ctx.w, h: nameH }, padding: 0, wrap: false };
    },
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const top = lifelineHeader(ctx, ACTOR_HEADER);
      const figH = top - actorNameHeight(ctx, top);
      const figW = Math.min(ctx.w, figH * 0.6);
      return [...stickFigure(ctx, (ctx.w - figW) / 2, 0, figW, figH), lifelineStem(ctx, top)];
    },
  },
  simpleShape({
    id: "uml/activation",
    name: "Activation",
    aliases: ["activation-bar", "execution", "execution-specification", "focus-of-control"],
    keywords: ["sequence", "lifeline", "call"],
    description: "Narrow bar on a lifeline showing the period during which the participant is executing.",
    size: { w: 12, h: 60 },
    minSize: { w: 6, h: 10 },
    label: () => null,
    path: boxPath,
  }),
  {
    id: "uml/fragment",
    name: "Fragment",
    aliases: ["combined-fragment", "interaction-fragment", "alt", "opt", "par", "loop-fragment"],
    keywords: ["sequence", "alt", "loop", "opt", "guard", "operand"],
    description:
      "Sequence diagram combined fragment drawn over the messages it covers. First line is the operator (alt, loop, opt, par), the next the guard; add `---` and a guard per extra operand.",
    size: { w: 320, h: 160 },
    minSize: { w: 60, h: 40 },
    style: { fill: "none", fontSize: 13 },
    text: "alt\n[condition]",
    label: () => null,
    outline: (w, h) => rectPath(0, 0, w, h),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const [first = "", ...operands] = ctx.sections;
      const [operator = "", ...guard] = first.split("\n");
      const lineH = linesHeight(1, style.fontSize);
      const th = Math.min(lineH + 8, h * 0.5);
      const tw = Math.min(w * 0.7, Math.max(40, measureText(operator, fontOf(style, { bold: true })) + 24));
      const cut = Math.min(8, th * 0.4);
      const tagFill = style.fill === "none" ? tint(inkOf(style), 0.92) : shade(style.fill, 0.06);
      const guardText = (value: string, x: number, y: number) =>
        text(ctx, value, { x, y, w: Math.max(0, w - x - 8), h: lineH }, { align: "left", valign: "top", wrap: false });

      const prims: Prim[] = [
        body(ctx, rectPath(0, 0, w, h)),
        body(ctx, polyPath([[0, 0], [tw, 0], [tw, th - cut], [tw - cut, th], [0, th]]), { fill: tagFill, dash: "solid" }),
        text(ctx, operator, { x: 0, y: 0, w: tw - cut / 2, h: th }, { font: { bold: true }, align: "center", valign: "middle", wrap: false }),
      ];
      if (guard.length) prims.push(guardText(guard.join("\n"), tw + 8, (th - lineH) / 2));
      // Extra `---` sections are further operands, split evenly by dashed separators.
      operands.forEach((operand, index) => {
        const y = (h * (index + 1)) / (operands.length + 1);
        prims.push(line(ctx, linePath(0, y, w, y), { ...thin(style), dash: "dashed" }));
        if (operand.trim()) prims.push(guardText(operand, 10, y + 6));
      });
      return prims;
    },
  },
  {
    id: "uml/destroy",
    name: "Destroy",
    aliases: ["destruction", "destruction-occurrence", "lifeline-end", "x-mark"],
    keywords: ["sequence", "delete", "terminate"],
    description: "X at the end of a lifeline marking where the participant is destroyed.",
    size: { w: 24, h: 24 },
    minSize: { w: 10, h: 10 },
    keepAspect: true,
    label: () => null,
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const cross: Path = [["M", 0, 0], ["L", w, h], ["M", w, 0], ["L", 0, h]];
      return [line(ctx, cross, { stroke: inkOf(style), strokeWidth: Math.max(style.strokeWidth, 2), round: true })];
    },
  },
];

/* -------------------------------------------------------------- robustness */

const robustness: ShapeDef[] = [
  {
    id: "uml/boundary",
    name: "Boundary",
    aliases: ["boundary-object", "boundary-class", "ecb-boundary"],
    keywords: ["robustness", "analysis", "ui", "interface", "screen"],
    description: "Robustness diagram boundary object: the interface between an actor and the system (screen, API).",
    size: { w: 60, h: 48 },
    minSize: { w: 24, h: 20 },
    style: { fontSize: 13 },
    text: "Boundary",
    label: labelBelow,
    draw: (ctx) => {
      const { w, h } = ctx;
      const r = Math.min(h / 2, w * 0.4);
      const bar: Path = [["M", 0, h / 2 - r * 0.7], ["L", 0, h / 2 + r * 0.7], ["M", 0, h / 2], ["L", w - 2 * r, h / 2]];
      return [line(ctx, bar), body(ctx, ellipsePath(w - r, h / 2, r, r))];
    },
  },
  {
    id: "uml/control",
    name: "Control",
    aliases: ["control-object", "control-class", "controller-object", "ecb-control"],
    keywords: ["robustness", "analysis", "logic", "use case controller"],
    description: "Robustness diagram control object: the logic coordinating boundaries and entities.",
    size: { w: 48, h: 54 },
    minSize: { w: 20, h: 22 },
    style: { fontSize: 13 },
    text: "Control",
    label: labelBelow,
    draw: (ctx) => {
      const { w, h } = ctx;
      const a = Math.min(w, h) * 0.14;
      const r = Math.min(w / 2, (h - a) / 2);
      const top = h - 2 * r;
      // Open arrowhead sitting on the top of the circle.
      const arrow: Path = [["M", w / 2 + a * 1.1, top - a], ["L", w / 2 - a * 0.1, top], ["L", w / 2 + a * 1.1, top + a]];
      return [body(ctx, ellipsePath(w / 2, h - r, r, r)), line(ctx, arrow, { round: true, dash: "solid" })];
    },
  },
  {
    id: "uml/entity",
    name: "Entity object",
    aliases: ["entity-object", "entity-class", "ecb-entity"],
    keywords: ["robustness", "analysis", "domain", "data"],
    description: "Robustness diagram entity object: long-lived domain data. For database tables use `er/entity`.",
    size: { w: 48, h: 48 },
    minSize: { w: 20, h: 20 },
    style: { fontSize: 13 },
    text: "Entity",
    label: labelBelow,
    draw: (ctx) => {
      const { w, h } = ctx;
      const r = Math.min(w, h) / 2;
      return [body(ctx, ellipsePath(w / 2, h - r, r, r)), line(ctx, linePath(w / 2 - r, h, w / 2 + r, h))];
    },
  },
];

export const umlLibrary: ShapeLibrary = {
  id: "uml",
  name: "UML",
  description:
    "UML structure and behaviour: classes, packages, components, use cases, states, activities, sequence lifelines and robustness icons.",
  shapes: [...structure, ...behaviour, ...sequence, ...robustness],
};
