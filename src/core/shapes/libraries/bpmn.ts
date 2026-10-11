import {
  body,
  boxPath,
  ellipsePath,
  fontOf,
  hasIcon,
  icon,
  line,
  linePath,
  measureBlock,
  measureText,
  ovalPath,
  param,
  PAPER,
  polyPath,
  rectPath,
  shade,
  simpleShape,
  solid,
  translatePath,
  type LabelSpec,
  type Path,
  type PathPrim,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

type Meta = Pick<ShapeDef, "id" | "name" | "aliases" | "keywords" | "description" | "text">;

/** Label under the symbol, outside the node box. */
const below = (ctx: ShapeCtx): LabelSpec => ({ box: { x: -50, y: ctx.h + 4, w: ctx.w + 100, h: 40 }, valign: "top", padding: 0 });

const diamond = (w: number, h: number): Path => polyPath([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);

/* ---------------------------------------------------------------- events */

type EventType = "start" | "intermediate" | "end";

/** Marker centred in an event circle. Throwing (end) events use the filled variant. */
function eventMarker(ctx: ShapeCtx, name: string, filled: boolean): Prim[] {
  const { w, h, style } = ctx;
  const d = Math.min(w, h);
  const s = d * 0.52;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const ink = style.stroke;
  const paper = style.fill === "none" ? PAPER : style.fill;
  const thin = { strokeWidth: Math.min(style.strokeWidth, 1.25), round: true };
  const mark = (path: Path): PathPrim => line(ctx, path, { ...thin, fill: filled ? ink : "none" });
  switch (name) {
    case "message": {
      const top = cy - s * 0.34;
      return [
        mark(rectPath(x, top, s, s * 0.68)),
        line(ctx, polyPath([[x, top], [cx, top + s * 0.36], [x + s, top]], false), { ...thin, stroke: filled ? paper : ink }),
      ];
    }
    case "timer": {
      const r = s / 2;
      const ticks = [0, 1, 2, 3].map((i) => {
        const dx = Math.cos((i * Math.PI) / 2) * r;
        const dy = Math.sin((i * Math.PI) / 2) * r;
        return line(ctx, linePath(cx + dx * 0.76, cy + dy * 0.76, cx + dx, cy + dy), thin);
      });
      return [
        line(ctx, ellipsePath(cx, cy, r, r), thin),
        ...ticks,
        line(ctx, polyPath([[cx, cy - r * 0.58], [cx, cy], [cx + r * 0.42, cy]], false), thin),
      ];
    }
    case "error":
      return [
        mark(
          polyPath([
            [x + s * 0.05, y + s * 0.95],
            [x + s * 0.34, y + s * 0.08],
            [x + s * 0.6, y + s * 0.55],
            [x + s * 0.95, y + s * 0.05],
            [x + s * 0.66, y + s * 0.92],
            [x + s * 0.4, y + s * 0.45],
          ]),
        ),
      ];
    case "signal":
      return [mark(polyPath([[cx, y + s * 0.04], [x + s, y + s * 0.88], [x, y + s * 0.88]]))];
    case "terminate":
      return [solid(ellipsePath(cx, cy, d * 0.29, d * 0.29), ink)];
    case "link": {
      const shaft = s * 0.2;
      const neck = x + s * 0.55;
      return [
        mark(
          polyPath([
            [x, cy - shaft],
            [neck, cy - shaft],
            [neck, cy - s * 0.42],
            [x + s, cy],
            [neck, cy + s * 0.42],
            [neck, cy + shaft],
            [x, cy + shaft],
          ]),
        ),
      ];
    }
    case "conditional": {
      const pw = s * 0.78;
      const px = cx - pw / 2;
      return [
        line(ctx, rectPath(px, y, pw, s), thin),
        ...[0.22, 0.41, 0.6, 0.79].map((k) => line(ctx, linePath(px + pw * 0.2, y + s * k, px + pw * 0.8, y + s * k), thin)),
      ];
    }
    default:
      // Any other icon name from the icon set.
      return hasIcon(name) ? icon(ctx, name, x, y, s) : [];
  }
}

function event(type: EventType, meta: Meta, marker = ""): ShapeDef {
  return {
    ...meta,
    size: { w: 40, h: 40 },
    minSize: { w: 24, h: 24 },
    keepAspect: true,
    style: { strokeWidth: type === "end" ? 3 : 1.5, fontSize: 12 },
    data: { icon: marker },
    label: below,
    outline: ovalPath,
    draw: (ctx) => {
      const { w, h } = ctx;
      const prims: Prim[] = [body(ctx, ovalPath(w, h))];
      if (type === "intermediate") {
        const gap = Math.min(3.5, w * 0.09, h * 0.09);
        prims.push(line(ctx, ellipsePath(w / 2, h / 2, w / 2 - gap, h / 2 - gap)));
      }
      prims.push(...eventMarker(ctx, param(ctx, "icon", ""), type === "end"));
      return prims;
    },
  };
}

const EVENT_MARKERS = '`data.icon`: "message", "timer", "error", "signal", "terminate", "link", "conditional" or any icon name.';

/* ------------------------------------------------------------ activities */

const TASK_ICONS: Record<string, string> = {
  user: "user",
  service: "settings",
  script: "scroll-text",
  manual: "hand",
  send: "send",
  receive: "mail",
  "business-rule": "table",
};

function taskMarker(ctx: ShapeCtx): Prim[] {
  const name = TASK_ICONS[param(ctx, "kind", "")];
  if (!name) return [];
  const size = Math.min(16, ctx.w * 0.3, ctx.h * 0.3);
  const offset = Math.min(8, size * 0.5);
  return icon(ctx, name, offset, offset, size);
}

function task(meta: Meta, kind = ""): ShapeDef {
  return {
    ...meta,
    size: { w: 120, h: 70 },
    style: { radius: 10 },
    data: { kind },
    // Taller when a type icon is shown, so wrapped text stays clear of it.
    fit: (ctx) => {
      const content = measureBlock(ctx.text, fontOf(ctx.style), 200);
      const margin = TASK_ICONS[param(ctx, "kind", "")] ? 25 : 10;
      return { w: Math.max(120, content.w + 24), h: Math.max(70, content.h + margin * 2) };
    },
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style)), ...taskMarker(ctx)],
  };
}

const collapsedSize = (w: number, h: number): number => Math.min(14, w * 0.3, h * 0.3);

/** The [+] marker of a collapsed sub-process, bottom-centre. */
function collapsedMarker(ctx: ShapeCtx): Prim[] {
  const { w, h, style } = ctx;
  const s = collapsedSize(w, h);
  const x = (w - s) / 2;
  const y = h - s - Math.min(5, s * 0.4);
  const thin = { strokeWidth: Math.min(style.strokeWidth, 1.25) };
  return [
    line(ctx, rectPath(x, y, s, s), thin),
    line(ctx, linePath(x + s * 0.22, y + s / 2, x + s * 0.78, y + s / 2), thin),
    line(ctx, linePath(x + s / 2, y + s * 0.22, x + s / 2, y + s * 0.78), thin),
  ];
}

const SUBPROCESS_HEADER = 30;

/* -------------------------------------------------------------- gateways */

type GatewayMarker = (ctx: ShapeCtx, cx: number, cy: number, d: number) => Prim[];

function gateway(meta: Meta, marker?: GatewayMarker): ShapeDef {
  return {
    ...meta,
    size: { w: 50, h: 50 },
    minSize: { w: 24, h: 24 },
    keepAspect: true,
    style: { fontSize: 12 },
    label: below,
    outline: diamond,
    draw: (ctx) => [body(ctx, diamond(ctx.w, ctx.h)), ...(marker?.(ctx, ctx.w / 2, ctx.h / 2, Math.min(ctx.w, ctx.h)) ?? [])],
  };
}

const thick = (d: number): number => Math.max(1.5, d * 0.07);

const cross = (ctx: ShapeCtx, cx: number, cy: number, arm: number, strokeWidth: number): Prim[] => [
  line(ctx, linePath(cx - arm, cy, cx + arm, cy), { strokeWidth }),
  line(ctx, linePath(cx, cy - arm, cx, cy + arm), { strokeWidth }),
];

const saltire = (ctx: ShapeCtx, cx: number, cy: number, arm: number, strokeWidth: number): Prim[] => [
  line(ctx, linePath(cx - arm, cy - arm, cx + arm, cy + arm), { strokeWidth }),
  line(ctx, linePath(cx + arm, cy - arm, cx - arm, cy + arm), { strokeWidth }),
];

function pentagon(cx: number, cy: number, r: number): Path {
  const points: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const angle = ((i * 72 - 90) * Math.PI) / 180;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return polyPath(points);
}

/* ------------------------------------------------------------------ data */

function dataObjectPath(w: number, h: number): Path {
  const fold = Math.min(w * 0.32, h * 0.32, 14);
  return polyPath([[0, 0], [w - fold, 0], [w, fold], [w, h], [0, h]]);
}

function dataStore(w: number, h: number): { bodyPath: Path; rim: Path; cap: number } {
  const cap = Math.min(h * 0.14, w * 0.2, 12);
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

/* --------------------------------------------------------- pools & lanes */

const STRIP_MAX = 64;

/**
 * The name strip is `data.header` wide and grows (up to STRIP_MAX) so the
 * longest word of the name fits on one line; text cannot be rotated.
 */
function nameStrip(ctx: ShapeCtx): { width: number; fontSize: number } {
  const font = fontOf(ctx.style);
  const widest = Math.max(0, ...ctx.text.split(/\s+/).map((word) => measureText(word, font)));
  const wanted = Math.max(param(ctx, "header", 36), Math.min(widest + 10, STRIP_MAX));
  const width = Math.max(8, Math.min(wanted, ctx.w * 0.5));
  const room = width - 8;
  return { width, fontSize: widest > room ? Math.max(font.size * 0.8, (font.size * (room - 1)) / widest) : font.size };
}

function pool(meta: Meta, size: { w: number; h: number }, stripShade: number): ShapeDef {
  return {
    ...meta,
    size,
    minSize: { w: 120, h: 60 },
    // Padding keeps laid-out children clear of the name strip on the left.
    container: { header: 0, padding: STRIP_MAX + 4 },
    style: { fontSize: 11, bold: true },
    data: { header: 36 },
    label: (ctx) => {
      const strip = nameStrip(ctx);
      return { box: { x: 0, y: 0, w: strip.width, h: ctx.h }, padding: 4, font: { size: strip.fontSize } };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const strip = nameStrip(ctx).width;
      const prims: Prim[] = [body(ctx, rectPath(0, 0, w, h))];
      if (style.fill !== "none") {
        prims.push(solid(rectPath(0, 0, strip, h), shade(style.fill, stripShade)), line(ctx, rectPath(0, 0, w, h), { dash: style.dash }));
      }
      prims.push(line(ctx, linePath(strip, 0, strip, h)));
      return prims;
    },
  };
}

/* ---------------------------------------------------------------- shapes */

const shapes: ShapeDef[] = [
  event("start", {
    id: "bpmn/start-event",
    name: "Start event",
    aliases: ["bpmn-start", "none-start-event", "process-start"],
    keywords: ["begin", "trigger", "circle"],
    description: `Where a process starts (thin circle). ${EVENT_MARKERS}`,
    text: "Start",
  }),
  event("intermediate", {
    id: "bpmn/intermediate-event",
    name: "Intermediate event",
    aliases: ["bpmn-intermediate", "catch-event", "throw-event"],
    keywords: ["wait", "double circle"],
    description: `Something that happens between start and end (double circle). ${EVENT_MARKERS}`,
    text: "Event",
  }),
  event("end", {
    id: "bpmn/end-event",
    name: "End event",
    aliases: ["bpmn-end", "none-end-event", "process-end"],
    keywords: ["finish", "stop", "thick circle"],
    description: `Where a path of the process ends (thick circle). ${EVENT_MARKERS}`,
    text: "End",
  }),
  event(
    "start",
    {
      id: "bpmn/message-start-event",
      name: "Message start event",
      aliases: ["message-start", "start-message"],
      keywords: ["envelope", "receive"],
      description: "Process started by an incoming message.",
      text: "Message received",
    },
    "message",
  ),
  event(
    "start",
    {
      id: "bpmn/timer-start-event",
      name: "Timer start event",
      aliases: ["timer-start", "scheduled-start"],
      keywords: ["clock", "schedule", "cron"],
      description: "Process started at a time or on a schedule.",
      text: "Every Monday",
    },
    "timer",
  ),
  event(
    "intermediate",
    {
      id: "bpmn/timer-intermediate-event",
      name: "Timer intermediate event",
      aliases: ["timer-event", "bpmn-timer", "wait-timer"],
      keywords: ["clock", "delay", "timeout"],
      description: "Wait for a duration or a point in time before continuing.",
      text: "Wait 2 days",
    },
    "timer",
  ),
  event(
    "end",
    {
      id: "bpmn/message-end-event",
      name: "Message end event",
      aliases: ["message-end", "end-message"],
      keywords: ["envelope", "send"],
      description: "Process path that ends by sending a message.",
      text: "Message sent",
    },
    "message",
  ),
  event(
    "end",
    {
      id: "bpmn/error-end-event",
      name: "Error end event",
      aliases: ["error-end", "end-error"],
      keywords: ["exception", "failure"],
      description: "Process path that ends by raising an error.",
      text: "Error",
    },
    "error",
  ),
  event(
    "end",
    {
      id: "bpmn/terminate-end-event",
      name: "Terminate end event",
      aliases: ["terminate-end", "terminate-event"],
      keywords: ["abort", "kill"],
      description: "Ends the whole process immediately, including parallel paths.",
      text: "Terminate",
    },
    "terminate",
  ),

  task({
    id: "bpmn/task",
    name: "Task",
    aliases: ["bpmn-task", "bpmn-activity"],
    keywords: ["activity", "step", "work"],
    description: 'A unit of work. `data.kind`: "user", "service", "script", "manual", "send", "receive" or "business-rule".',
    text: "Task",
  }),
  task(
    {
      id: "bpmn/user-task",
      name: "User task",
      aliases: ["human-task"],
      keywords: ["person", "form", "approval"],
      description: "Work a person performs with the help of software.",
      text: "Review request",
    },
    "user",
  ),
  task(
    {
      id: "bpmn/service-task",
      name: "Service task",
      aliases: ["automated-task", "system-task"],
      keywords: ["api", "automation", "gear"],
      description: "Work done automatically by a system or service call.",
      text: "Call API",
    },
    "service",
  ),
  task(
    {
      id: "bpmn/script-task",
      name: "Script task",
      keywords: ["code", "engine"],
      description: "A script run by the process engine.",
      text: "Run script",
    },
    "script",
  ),
  task(
    {
      id: "bpmn/manual-task",
      name: "Manual task",
      keywords: ["hand", "offline", "physical"],
      description: "Work done by a person without any system support.",
      text: "Pack order",
    },
    "manual",
  ),
  task(
    {
      id: "bpmn/send-task",
      name: "Send task",
      keywords: ["message", "notify", "email"],
      description: "Sends a message to another participant.",
      text: "Send invoice",
    },
    "send",
  ),
  task(
    {
      id: "bpmn/receive-task",
      name: "Receive task",
      keywords: ["message", "wait", "inbox"],
      description: "Waits for a message from another participant.",
      text: "Receive payment",
    },
    "receive",
  ),
  task(
    {
      id: "bpmn/business-rule-task",
      name: "Business rule task",
      aliases: ["rule-task", "decision-task", "dmn-task"],
      keywords: ["dmn", "rules", "decision table"],
      description: "Evaluates business rules (for example a DMN decision table).",
      text: "Check eligibility",
    },
    "business-rule",
  ),
  {
    id: "bpmn/subprocess",
    name: "Sub-process (collapsed)",
    aliases: ["bpmn-subprocess", "sub-process", "collapsed-subprocess"],
    keywords: ["nested", "plus", "activity"],
    description: "An activity whose details are modelled in another diagram, marked with [+].",
    size: { w: 130, h: 80 },
    style: { radius: 10 },
    text: "Sub-process",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h - collapsedSize(ctx.w, ctx.h) - 4 } }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style)), ...collapsedMarker(ctx)],
  },
  {
    id: "bpmn/expanded-subprocess",
    name: "Sub-process (expanded)",
    aliases: ["expanded-sub-process", "embedded-subprocess", "bpmn-subprocess-container"],
    keywords: ["nested", "container", "activity"],
    description: "Container showing the steps of a sub-process inline. Put its tasks and events inside.",
    size: { w: 400, h: 220 },
    minSize: { w: 120, h: 80 },
    container: { header: SUBPROCESS_HEADER, padding: 20 },
    style: { radius: 10, align: "left", fontSize: 13, bold: true },
    text: "Sub-process",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: SUBPROCESS_HEADER }, padding: 12, valign: "middle", wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))],
  },
  simpleShape({
    id: "bpmn/call-activity",
    name: "Call activity",
    aliases: ["bpmn-call-activity", "reusable-subprocess", "global-task-call"],
    keywords: ["reuse", "thick border"],
    description: "Calls a reusable process or global task defined elsewhere (thick border).",
    size: { w: 120, h: 70 },
    style: { radius: 10, strokeWidth: 4 },
    text: "Call activity",
    path: boxPath,
  }),
  {
    id: "bpmn/transaction",
    name: "Transaction",
    aliases: ["bpmn-transaction", "transaction-subprocess"],
    keywords: ["atomic", "compensation", "double border"],
    description: "Activities that succeed or fail as one unit (double border).",
    size: { w: 130, h: 80 },
    style: { radius: 10 },
    text: "Transaction",
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const gap = Math.min(4, w * 0.1, h * 0.1);
      return [
        body(ctx, boxPath(w, h, style)),
        line(ctx, rectPath(gap, gap, w - gap * 2, h - gap * 2, Math.max(0, style.radius - gap)), { strokeWidth: Math.min(style.strokeWidth, 1.25) }),
      ];
    },
  },

  gateway({
    id: "bpmn/gateway",
    name: "Gateway",
    aliases: ["bpmn-gateway", "empty-gateway"],
    keywords: ["diamond", "branch", "split", "merge"],
    description: "Unmarked gateway; behaves as an exclusive (XOR) split or merge.",
    text: "",
  }),
  gateway(
    {
      id: "bpmn/gateway-exclusive",
      name: "Exclusive gateway (XOR)",
      aliases: ["exclusive-gateway", "xor-gateway"],
      keywords: ["diamond", "either", "choice", "x"],
      description: "Exactly one outgoing path is taken, based on conditions.",
      text: "Approved?",
    },
    (ctx, cx, cy, d) => saltire(ctx, cx, cy, d * 0.14, thick(d)),
  ),
  gateway(
    {
      id: "bpmn/gateway-parallel",
      name: "Parallel gateway (AND)",
      aliases: ["parallel-gateway", "and-gateway", "fork-join-gateway"],
      keywords: ["diamond", "concurrent", "fork", "join", "plus"],
      description: "All outgoing paths run at once; as a join it waits for all of them.",
      text: "",
    },
    (ctx, cx, cy, d) => cross(ctx, cx, cy, d * 0.23, thick(d)),
  ),
  gateway(
    {
      id: "bpmn/gateway-inclusive",
      name: "Inclusive gateway (OR)",
      aliases: ["inclusive-gateway", "or-gateway"],
      keywords: ["diamond", "one or more", "circle"],
      description: "One or more outgoing paths are taken, based on conditions.",
      text: "",
    },
    (ctx, cx, cy, d) => [line(ctx, ellipsePath(cx, cy, d * 0.2, d * 0.2), { strokeWidth: thick(d) * 0.85 })],
  ),
  gateway(
    {
      id: "bpmn/gateway-event",
      name: "Event-based gateway",
      aliases: ["event-gateway", "event-based-gateway"],
      keywords: ["diamond", "race", "wait", "pentagon"],
      description: "The path is chosen by whichever following event happens first.",
      text: "",
    },
    (ctx, cx, cy, d) => {
      const thin = { strokeWidth: Math.min(ctx.style.strokeWidth, 1.25) };
      return [
        line(ctx, ellipsePath(cx, cy, d * 0.26, d * 0.26), thin),
        line(ctx, ellipsePath(cx, cy, d * 0.21, d * 0.21), thin),
        line(ctx, pentagon(cx, cy + d * 0.01, d * 0.13), thin),
      ];
    },
  ),
  gateway(
    {
      id: "bpmn/gateway-complex",
      name: "Complex gateway",
      aliases: ["complex-gateway"],
      keywords: ["diamond", "asterisk", "custom"],
      description: "Branching or merging with rules too complex for the other gateways.",
      text: "",
    },
    (ctx, cx, cy, d) => [...cross(ctx, cx, cy, d * 0.23, thick(d) * 0.8), ...saltire(ctx, cx, cy, d * 0.15, thick(d) * 0.8)],
  ),

  {
    id: "bpmn/data-object",
    name: "Data object",
    aliases: ["bpmn-data", "data-object-reference", "bpmn-document"],
    keywords: ["file", "page", "information"],
    description: "Information read or produced by an activity (page with a folded corner).",
    size: { w: 40, h: 50 },
    minSize: { w: 24, h: 24 },
    style: { fontSize: 12 },
    text: "Order",
    label: below,
    outline: dataObjectPath,
    draw: (ctx) => {
      const { w, h } = ctx;
      const fold = Math.min(w * 0.32, h * 0.32, 14);
      return [body(ctx, dataObjectPath(w, h)), line(ctx, polyPath([[w - fold, 0], [w - fold, fold], [w, fold]], false))];
    },
  },
  {
    id: "bpmn/data-store",
    name: "Data store",
    aliases: ["bpmn-data-store", "data-store-reference", "bpmn-database"],
    keywords: ["cylinder", "persistent", "storage"],
    description: "Data that outlives the process, such as a database or filing system.",
    size: { w: 56, h: 52 },
    minSize: { w: 24, h: 24 },
    style: { fontSize: 12 },
    text: "CRM",
    label: below,
    outline: (w, h) => dataStore(w, h).bodyPath,
    draw: (ctx) => {
      const { bodyPath, rim, cap } = dataStore(ctx.w, ctx.h);
      const step = cap * 0.55;
      return [body(ctx, bodyPath), line(ctx, rim), line(ctx, translatePath(rim, 0, step)), line(ctx, translatePath(rim, 0, step * 2))];
    },
  },

  pool(
    {
      id: "bpmn/pool",
      name: "Pool",
      aliases: ["bpmn-pool", "participant", "swimlane-pool"],
      keywords: ["swimlane", "organisation", "container"],
      description: "Container for one participant's process; the name sits in the strip on the left (`data.header` = strip width). Put lanes or tasks inside.",
      text: "Pool",
    },
    { w: 600, h: 220 },
    0.08,
  ),
  pool(
    {
      id: "bpmn/lane",
      name: "Lane",
      aliases: ["bpmn-lane", "swimlane", "swim-lane"],
      keywords: ["role", "department", "container"],
      description: "Sub-division of a pool for one role or department. Stack lanes inside a pool; give sibling lanes the same `data.header` to align their strips.",
      text: "Lane",
    },
    { w: 540, h: 140 },
    0.03,
  ),

  {
    id: "bpmn/annotation",
    name: "Text annotation",
    aliases: ["bpmn-annotation", "text-annotation", "bpmn-comment"],
    keywords: ["comment", "remark", "bracket"],
    description: "Explanatory comment attached to an element with a dotted association.",
    size: { w: 150, h: 50 },
    minSize: { w: 40, h: 24 },
    style: { fill: "none", align: "left", fontSize: 13 },
    text: "Text annotation",
    label: (ctx) => ({ box: { x: 4, y: 0, w: ctx.w - 4, h: ctx.h }, padding: 8 }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const hook = Math.min(10, w * 0.2);
      return [
        ...(style.fill === "none" ? [] : [solid(rectPath(0, 0, w, h), style.fill)]),
        line(ctx, polyPath([[hook, 0], [0, 0], [0, h], [hook, h]], false), { dash: style.dash }),
      ];
    },
  },
  {
    id: "bpmn/group",
    name: "Group",
    aliases: ["bpmn-group", "bpmn-category"],
    keywords: ["dashed", "category", "container"],
    description: "Dashed outline that visually groups elements without changing the flow.",
    size: { w: 360, h: 220 },
    minSize: { w: 100, h: 60 },
    container: { header: SUBPROCESS_HEADER, padding: 20 },
    style: { fill: "none", stroke: "#5c6670", dash: "dashed", radius: 12, align: "left", fontSize: 13, textColor: "#5c6670", bold: true },
    text: "Group",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: SUBPROCESS_HEADER }, padding: 12, valign: "middle", wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))],
  },
  simpleShape({
    id: "bpmn/conversation",
    name: "Conversation",
    aliases: ["bpmn-conversation", "conversation-node"],
    keywords: ["hexagon", "message exchange", "collaboration"],
    description: "A set of related message exchanges between participants (hexagon).",
    size: { w: 56, h: 48 },
    minSize: { w: 24, h: 24 },
    style: { fontSize: 12 },
    text: "Conversation",
    label: below,
    path: (w, h) => {
      const k = Math.min(w * 0.25, h * 0.5);
      return polyPath([[k, 0], [w - k, 0], [w, h / 2], [w - k, h], [k, h], [0, h / 2]]);
    },
  }),
];

export const bpmnLibrary: ShapeLibrary = {
  id: "bpmn",
  name: "BPMN",
  description: "BPMN 2.0 process modelling: events, tasks, sub-processes, gateways, data, pools, lanes and annotations.",
  shapes,
};
