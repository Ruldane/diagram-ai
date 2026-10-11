import {
  body,
  boxPath,
  ellipsePath,
  fontOf,
  line,
  linePath,
  measureText,
  ovalPath,
  param,
  polyPath,
  rectPath,
  simpleShape,
  solid,
  text,
  type LabelSpec,
  type Path,
  type PathPrim,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

const KAPPA = 0.5522847498;

/** Schematic look: white bodies, thin ink strokes, small labels. */
const SYMBOL = { fill: "#ffffff", strokeWidth: 1.5, fontSize: 12 } as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const boxOutline = (w: number, h: number): Path => rectPath(0, 0, w, h);
const count = (ctx: ShapeCtx, key: string, fallback: number, max: number): number =>
  clamp(Math.round(param(ctx, key, fallback)), 1, max);

/** Reference designator / value placed under the symbol, outside the node box. */
const below = (ctx: ShapeCtx): LabelSpec => ({ box: { x: -60, y: ctx.h + 5, w: ctx.w + 120, h: 34 }, valign: "top", padding: 0 });

/** Thin `+` or `−` drawn as strokes, so it does not depend on font glyphs. */
function sign(ctx: ShapeCtx, kind: string, cx: number, cy: number, s: number): PathPrim[] {
  const strokeWidth = Math.min(ctx.style.strokeWidth, 1.25);
  const prims = [line(ctx, linePath(cx - s, cy, cx + s, cy), { strokeWidth })];
  if (kind === "+") prims.push(line(ctx, linePath(cx, cy - s, cx, cy + s), { strokeWidth }));
  return prims;
}

/** Evenly spaced pin positions along a side of length `h`. */
const pinYs = (n: number, h: number): number[] => Array.from({ length: n }, (_, i) => (h * (i + 0.5)) / n);

/* ------------------------------------------------------------- logic gates */

type GateKind = "and" | "or" | "xor" | "buffer";

/** Concave back of an OR gate: a parabola bulging `c / 2` to the right at mid height. */
const backArc = (x: number, h: number, c: number): Path => [
  ["M", x, h],
  ["C", x + (c * 2) / 3, (h * 2) / 3, x + (c * 2) / 3, h / 3, x, 0],
];

function gateBody(kind: GateKind, x0: number, x1: number, h: number, bulge: number): Path {
  const bw = x1 - x0;
  if (kind === "buffer") return polyPath([[x0, 0], [x1, h / 2], [x0, h]]);
  if (kind === "and") {
    const r = Math.min(h / 2, bw);
    const xm = x1 - r;
    const ky = (h / 2) * KAPPA;
    return [
      ["M", x0, 0],
      ["L", xm, 0],
      ["C", xm + r * KAPPA, 0, x1, h / 2 - ky, x1, h / 2],
      ["C", x1, h / 2 + ky, xm + r * KAPPA, h, xm, h],
      ["L", x0, h],
      ["Z"],
    ];
  }
  return [
    ["M", x0, 0],
    ["C", x0 + bw * 0.45, 0, x0 + bw * 0.8, h * 0.18, x1, h / 2],
    ["C", x0 + bw * 0.8, h * 0.82, x0 + bw * 0.45, h, x0, h],
    backArc(x0, h, bulge)[1],
    ["Z"],
  ];
}

function gateGeometry(kind: GateKind, inverted: boolean, w: number, h: number) {
  const stub = Math.min(w * 0.18, 18);
  const bubble = inverted ? Math.min(h * 0.09, w * 0.06, 5) : 0;
  const x1 = w - stub - bubble * 2;
  const gap = kind === "xor" ? Math.min((x1 - stub) * 0.14, 8) : 0;
  const x0 = stub + gap;
  const bulge = kind === "or" || kind === "xor" ? (x1 - x0) * 0.32 : 0;
  return { stub, bubble, x0, x1, gap, bulge };
}

/** `[short id, name, body, inverted output, aliases, description]` */
type GateRow = [id: string, name: string, kind: GateKind, inverted: boolean, aliases: string[], description: string];

const GATES: GateRow[] = [
  ["and-gate", "AND gate", "and", false, ["and", "logic-and", "conjunction"], "Output is 1 only when every input is 1."],
  ["or-gate", "OR gate", "or", false, ["logic-or", "disjunction"], "Output is 1 when at least one input is 1."],
  ["not-gate", "NOT gate", "buffer", true, ["not", "inverter", "logic-not", "negation"], "Inverter: output is the opposite of the input."],
  ["nand-gate", "NAND gate", "and", true, ["nand", "not-and"], "AND followed by an inversion."],
  ["nor-gate", "NOR gate", "or", true, ["nor", "not-or"], "OR followed by an inversion."],
  ["xor-gate", "XOR gate", "xor", false, ["xor", "exclusive-or"], "Output is 1 when an odd number of inputs are 1."],
  ["xnor-gate", "XNOR gate", "xor", true, ["xnor", "exclusive-nor", "equivalence-gate"], "Output is 1 when both inputs are equal."],
  ["buffer", "Buffer", "buffer", false, ["buffer-gate", "driver", "logic-buffer"], "Passes the input through unchanged (signal driver)."],
];

function gate([id, name, kind, inverted, aliases, description]: GateRow): ShapeDef {
  const single = kind === "buffer";
  const curved = kind === "or" || kind === "xor";
  return {
    id: `engineering/${id}`,
    name,
    aliases,
    keywords: ["logic", "digital", "boolean", "gate"],
    description: single ? description : `${description} data.inputs sets the number of inputs.`,
    size: single ? { w: 84, h: 48 } : { w: 100, h: 56 },
    minSize: { w: 24, h: 16 },
    style: SYMBOL,
    text: "",
    data: single ? undefined : { inputs: 2 },
    outline: boxOutline,
    label: (ctx) => {
      const g = gateGeometry(kind, inverted, ctx.w, ctx.h);
      const bw = g.x1 - g.x0;
      return { box: { x: g.x0 + (curved ? bw * 0.1 : 0), y: 0, w: bw * (single ? 0.6 : 0.8), h: ctx.h }, padding: 2 };
    },
    draw: (ctx) => {
      const { w, h } = ctx;
      const g = gateGeometry(kind, inverted, w, h);
      const prims: Prim[] = pinYs(single ? 1 : count(ctx, "inputs", 2, 8), h).map((y) => {
        const u = y / h;
        return line(ctx, linePath(0, y, g.x0 + 2 * g.bulge * u * (1 - u), y));
      });
      prims.push(line(ctx, linePath(g.x1 + g.bubble * 2, h / 2, w, h / 2)));
      prims.push(body(ctx, gateBody(kind, g.x0, g.x1, h, g.bulge)));
      if (kind === "xor") prims.push(line(ctx, backArc(g.stub, h, g.bulge)));
      if (inverted) prims.push(body(ctx, ellipsePath(g.x1 + g.bubble, h / 2, g.bubble, g.bubble)));
      return prims;
    },
  };
}

/* ------------------------------------------------------ digital components */

/** Left-hand pins per flip-flop kind; `>` is the clock input. */
const FLIP_FLOP_PINS: Record<string, string[]> = {
  D: ["D", ">"],
  T: ["T", ">"],
  JK: ["J", ">", "K"],
  SR: ["S", ">", "R"],
};

const pinStub = (w: number): number => Math.min(w * 0.14, 14);

const flipFlop: ShapeDef = {
  id: "engineering/flip-flop",
  name: "Flip-flop",
  aliases: ["d-flip-flop", "dff", "latch", "register-bit", "jk-flip-flop", "sr-latch", "t-flip-flop"],
  keywords: ["logic", "digital", "memory", "sequential", "clock"],
  description: "Edge-triggered flip-flop with Q and inverted Q outputs. data.kind = D | T | JK | SR.",
  size: { w: 120, h: 90 },
  minSize: { w: 40, h: 40 },
  style: SYMBOL,
  text: "",
  data: { kind: "D" },
  outline: boxOutline,
  label: (ctx) => ({ box: { x: ctx.w * 0.3, y: 0, w: ctx.w * 0.4, h: ctx.h }, padding: 0 }),
  draw: (ctx) => {
    const { w, h, style } = ctx;
    const stub = pinStub(w);
    const x0 = stub;
    const x1 = w - stub;
    const left = FLIP_FLOP_PINS[param(ctx, "kind", "D").toUpperCase()] ?? FLIP_FLOP_PINS.D;
    const font = fontOf(style, { size: Math.min(style.fontSize, h / 5, (x1 - x0) / 5), bold: false });
    const pad = font.size * 0.45;
    const rowH = font.size * 1.3;
    const prims: Prim[] = [body(ctx, rectPath(x0, 0, x1 - x0, h, style.radius))];

    pinYs(left.length, h).forEach((y, i) => {
      prims.push(line(ctx, linePath(0, y, x0, y)));
      const wedge = left[i] === ">" ? Math.min(font.size * 0.6, h / 8) : 0;
      if (wedge) prims.push(line(ctx, polyPath([[x0, y - wedge], [x0 + wedge, y], [x0, y + wedge]], false)));
      prims.push(
        text(ctx, wedge ? "CLK" : left[i], { x: x0 + wedge + pad, y: y - rowH / 2, w: (x1 - x0) / 2, h: rowH }, { font, align: "left", valign: "middle", wrap: false }),
      );
    });

    [h * 0.25, h * 0.75].forEach((y, i) => {
      prims.push(line(ctx, linePath(x1, y, w, y)));
      prims.push(text(ctx, "Q", { x: (x0 + x1) / 2, y: y - rowH / 2, w: (x1 - x0) / 2 - pad, h: rowH }, { font, align: "right", valign: "middle", wrap: false }));
      if (i === 1) {
        // Overline for the inverted output; a combining overline is not in the bundled font.
        const qw = measureText("Q", font);
        const top = y - font.size * 0.58;
        prims.push(line(ctx, linePath(x1 - pad - qw, top, x1 - pad, top), { strokeWidth: Math.max(1, font.size / 12) }));
      }
    });
    return prims;
  },
};

const mux: ShapeDef = {
  id: "engineering/mux",
  name: "Multiplexer",
  aliases: ["multiplexer", "selector", "data-selector", "demux", "demultiplexer"],
  keywords: ["logic", "digital", "select"],
  description: "Multiplexer: the select line (bottom) picks which input reaches the output. data.inputs sets the input count.",
  size: { w: 84, h: 110 },
  minSize: { w: 30, h: 40 },
  style: SYMBOL,
  text: "MUX",
  data: { inputs: 2 },
  outline: boxOutline,
  label: (ctx) => {
    const stub = pinStub(ctx.w);
    return { box: { x: stub, y: 0, w: ctx.w - stub * 2, h: ctx.h - stub }, padding: 2 };
  },
  draw: (ctx) => {
    const { w, h } = ctx;
    const stub = pinStub(w);
    const x0 = stub;
    const x1 = w - stub;
    const bottom = h - stub;
    const slope = Math.min(bottom * 0.2, (x1 - x0) * 0.6);
    return [
      ...pinYs(count(ctx, "inputs", 2, 8), bottom).map((y) => line(ctx, linePath(0, y, x0, y))),
      line(ctx, linePath(x1, bottom / 2, w, bottom / 2)),
      line(ctx, linePath(w / 2, bottom - slope / 2, w / 2, h)),
      body(ctx, polyPath([[x0, 0], [x1, slope], [x1, bottom - slope], [x0, bottom]])),
    ];
  },
};

const icChip: ShapeDef = {
  id: "engineering/ic-chip",
  name: "IC chip",
  aliases: ["ic", "integrated-circuit", "microchip", "microcontroller", "mcu", "dip-package", "component-block"],
  keywords: ["digital", "electronics", "package", "pins"],
  description: "Integrated circuit with pins on both sides. data.pins sets the number of pins per side.",
  size: { w: 130, h: 110 },
  minSize: { w: 40, h: 40 },
  style: { ...SYMBOL, radius: 3 },
  text: "IC",
  data: { pins: 4 },
  outline: boxOutline,
  label: (ctx) => {
    const stub = pinStub(ctx.w);
    return { box: { x: stub, y: 0, w: ctx.w - stub * 2, h: ctx.h }, padding: 6 };
  },
  draw: (ctx) => {
    const { w, h, style } = ctx;
    const stub = pinStub(w);
    const notch = Math.min(6, (w - stub * 2) * 0.08, h * 0.08);
    const k = notch * KAPPA;
    return [
      ...pinYs(count(ctx, "pins", 4, 32), h).flatMap((y) => [line(ctx, linePath(0, y, stub, y)), line(ctx, linePath(w - stub, y, w, y))]),
      body(ctx, rectPath(stub, 0, w - stub * 2, h, style.radius)),
      line(ctx, [
        ["M", w / 2 - notch, 0],
        ["C", w / 2 - notch, k, w / 2 - k, notch, w / 2, notch],
        ["C", w / 2 + k, notch, w / 2 + notch, k, w / 2 + notch, 0],
      ]),
    ];
  },
};

/* -------------------------------------------------------------- electrical */

type PartDef = Pick<ShapeDef, "name" | "size" | "draw"> & Partial<ShapeDef> & { id: string };

/** Two-terminal schematic symbol: horizontal, leads at the left and right centre, label underneath. */
function part(def: PartDef): ShapeDef {
  return {
    keywords: ["electrical", "circuit", "schematic", "electronics"],
    minSize: { w: 24, h: 12 },
    text: "",
    label: below,
    outline: boxOutline,
    ...def,
    id: `engineering/${def.id}`,
    style: { ...SYMBOL, ...def.style },
  };
}

/** Leads from both box edges to a centred symbol spanning `x0..x1`. */
const leads = (ctx: ShapeCtx, x0: number, x1: number): PathPrim[] => [
  line(ctx, linePath(0, ctx.h / 2, x0, ctx.h / 2)),
  line(ctx, linePath(x1, ctx.h / 2, ctx.w, ctx.h / 2)),
];

/** Circle centred in the box with leads either side (sources, lamp). */
function roundPart(ctx: ShapeCtx): { cx: number; cy: number; r: number; prims: Prim[] } {
  const cx = ctx.w / 2;
  const cy = ctx.h / 2;
  const r = Math.min(ctx.h / 2, ctx.w * 0.32);
  return { cx, cy, r, prims: [...leads(ctx, cx - r, cx + r), body(ctx, ellipsePath(cx, cy, r, r))] };
}

/** Diode triangle + cathode bar with half-height `th`, centred on the box. */
function diode(ctx: ShapeCtx, th: number): { xa: number; xb: number; prims: Prim[] } {
  const { w, h } = ctx;
  const tw = Math.min(th * 1.7, w * 0.5);
  const xa = (w - tw) / 2;
  const xb = xa + tw;
  return {
    xa,
    xb,
    prims: [
      ...leads(ctx, xa, xb),
      body(ctx, polyPath([[xa, h / 2 - th], [xb, h / 2], [xa, h / 2 + th]])),
      line(ctx, linePath(xb, h / 2 - th, xb, h / 2 + th)),
    ],
  };
}

/** Small filled arrowhead at `(x, y)` pointing along the unit vector `(ux, uy)`. */
function arrowHead(ctx: ShapeCtx, x: number, y: number, ux: number, uy: number, size: number): PathPrim {
  const bx = x - ux * size;
  const by = y - uy * size;
  const half = size * 0.45;
  return solid(polyPath([[x, y], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]]), ctx.style.stroke);
}

const dot = (def: Pick<ShapeDef, "name" | "aliases" | "description" | "keywords"> & { id: string }): ShapeDef => ({
  ...def,
  id: `engineering/${def.id}`,
  size: { w: 12, h: 12 },
  minSize: { w: 6, h: 6 },
  keepAspect: true,
  text: "",
  label: () => null,
  outline: ovalPath,
  draw: (ctx) => [solid(ovalPath(ctx.w, ctx.h), ctx.style.stroke)],
});

const electrical: ShapeDef[] = [
  part({
    id: "resistor",
    name: "Resistor",
    aliases: ["resistance", "r", "pull-up", "load-resistor"],
    description: "Resistor (ANSI zigzag). Label it with the designator and value, e.g. R1 10k.",
    size: { w: 90, h: 24 },
    text: "R1 10k",
    draw: (ctx) => {
      const { w, h } = ctx;
      const x0 = w * 0.2;
      const bw = w * 0.6;
      const a = Math.min(h / 2, bw * 0.2);
      const zig: [number, number][] = [1, 3, 5, 7, 9, 11].map((n, i) => [x0 + (bw * n) / 12, h / 2 + (i % 2 ? a : -a)]);
      return [line(ctx, polyPath([[0, h / 2], [x0, h / 2], ...zig, [x0 + bw, h / 2], [w, h / 2]], false))];
    },
  }),
  part({
    id: "capacitor",
    name: "Capacitor",
    aliases: ["cap", "condenser", "decoupling-capacitor"],
    description: "Capacitor: two parallel plates.",
    size: { w: 70, h: 36 },
    text: "C1 100nF",
    draw: (ctx) => {
      const { w, h } = ctx;
      const gap = Math.min(w * 0.07, 5);
      const strokeWidth = ctx.style.strokeWidth * 1.4;
      return [
        ...leads(ctx, w / 2 - gap, w / 2 + gap),
        line(ctx, linePath(w / 2 - gap, 0, w / 2 - gap, h), { strokeWidth }),
        line(ctx, linePath(w / 2 + gap, 0, w / 2 + gap, h), { strokeWidth }),
      ];
    },
  }),
  part({
    id: "inductor",
    name: "Inductor",
    aliases: ["coil", "choke", "winding", "solenoid"],
    description: "Inductor / coil: a row of humps.",
    size: { w: 90, h: 28 },
    text: "L1 10mH",
    draw: (ctx) => {
      const { w, h } = ctx;
      const x0 = w * 0.18;
      const rx = (w * 0.64) / 8;
      const ry = Math.min(h / 2, rx * 1.5);
      const cy = h / 2;
      const humps: Path = [0, 1, 2, 3].flatMap((i): Path => {
        const x = x0 + i * rx * 2;
        return [
          ["C", x, cy - ry * KAPPA, x + rx - rx * KAPPA, cy - ry, x + rx, cy - ry],
          ["C", x + rx + rx * KAPPA, cy - ry, x + rx * 2, cy - ry * KAPPA, x + rx * 2, cy],
        ];
      });
      return [line(ctx, [["M", 0, cy], ["L", x0, cy], ...humps, ["L", w, cy]])];
    },
  }),
  part({
    id: "diode",
    name: "Diode",
    aliases: ["rectifier", "rectifier-diode", "d"],
    description: "Diode: current flows from the triangle (anode) towards the bar (cathode).",
    size: { w: 70, h: 30 },
    text: "D1",
    draw: (ctx) => diode(ctx, ctx.h / 2).prims,
  }),
  part({
    id: "led",
    name: "LED",
    aliases: ["light-emitting-diode", "indicator-led", "status-led"],
    description: "Light-emitting diode: a diode with two arrows for emitted light.",
    size: { w: 70, h: 52 },
    text: "LED1",
    draw: (ctx) => {
      const { h } = ctx;
      const th = h * 0.27;
      const { xa, xb, prims } = diode(ctx, th);
      // Arrows leave the upper edge of the triangle along its outward normal.
      const tw = xb - xa;
      const edge = Math.hypot(tw, th) || 1;
      const [ex, ey] = [tw / edge, th / edge];
      const [nx, ny] = [ey, -ex];
      const length = Math.min(h * 0.26, 14);
      const strokeWidth = Math.min(ctx.style.strokeWidth, 1.25);
      for (const along of [-0.22, 0.1]) {
        const sx = xa + tw * (0.5 + along) + nx * 3;
        const sy = h / 2 - th * (0.5 - along) + ny * 3;
        const tx = sx + nx * length;
        const ty = sy + ny * length;
        prims.push(line(ctx, linePath(sx, sy, tx, ty), { strokeWidth }), arrowHead(ctx, tx, ty, nx, ny, Math.min(5, length * 0.45)));
      }
      return prims;
    },
  }),
  part({
    id: "battery",
    name: "Battery",
    aliases: ["cell", "dc-battery", "battery-cell", "power-cell"],
    description: "Battery: long plates are positive, short plates negative.",
    size: { w: 70, h: 36 },
    text: "9V",
    draw: (ctx) => {
      const { w, h } = ctx;
      const g = Math.min(w * 0.05, 4);
      const plate = (x: number, long: boolean): PathPrim => {
        const half = long ? h / 2 : h * 0.25;
        return line(ctx, linePath(x, h / 2 - half, x, h / 2 + half), { strokeWidth: ctx.style.strokeWidth * (long ? 1 : 2.2) });
      };
      return [...leads(ctx, w / 2 - g * 3, w / 2 + g * 3), plate(w / 2 - g * 3, true), plate(w / 2 - g, false), plate(w / 2 + g, true), plate(w / 2 + g * 3, false)];
    },
  }),
  part({
    id: "dc-source",
    name: "DC source",
    aliases: ["dc-voltage-source", "voltage-source", "dc-supply", "power-supply", "vdc"],
    description: "DC voltage source: circle with + and − terminals.",
    size: { w: 80, h: 44 },
    text: "5V",
    draw: (ctx) => {
      const { cx, cy, r, prims } = roundPart(ctx);
      return [...prims, ...sign(ctx, "+", cx - r * 0.45, cy, r * 0.22), ...sign(ctx, "-", cx + r * 0.45, cy, r * 0.22)];
    },
  }),
  part({
    id: "ac-source",
    name: "AC source",
    aliases: ["ac-voltage-source", "ac-supply", "mains", "signal-generator", "oscillator", "vac"],
    description: "AC voltage source: circle with a sine wave.",
    size: { w: 80, h: 44 },
    text: "AC",
    draw: (ctx) => {
      const { cx, cy, r, prims } = roundPart(ctx);
      const s = r * 0.58;
      const a = r * 0.62;
      const wave: Path = [
        ["M", cx - s, cy],
        ["C", cx - s * 0.64, cy - a, cx - s * 0.36, cy - a, cx, cy],
        ["C", cx + s * 0.36, cy + a, cx + s * 0.64, cy + a, cx + s, cy],
      ];
      return [...prims, line(ctx, wave, { strokeWidth: Math.min(ctx.style.strokeWidth, 1.25) })];
    },
  }),
  part({
    id: "ground",
    name: "Ground",
    aliases: ["gnd", "earth-ground", "chassis-ground", "0v", "vss"],
    description: "Ground reference. The terminal is at the top centre.",
    size: { w: 36, h: 32 },
    draw: (ctx) => {
      const { w, h } = ctx;
      const half = Math.min(w / 2, h * 0.6);
      return [
        line(ctx, linePath(w / 2, 0, w / 2, h * 0.45)),
        ...[
          [1, 0.45],
          [0.62, 0.7],
          [0.26, 0.95],
        ].map(([k, y]) => line(ctx, linePath(w / 2 - half * k, h * y, w / 2 + half * k, h * y))),
      ];
    },
  }),
  part({
    id: "switch",
    name: "Switch",
    aliases: ["spst", "electrical-switch", "push-button", "contact", "relay-contact", "sw"],
    description: "Single-pole switch, drawn open. Set data.closed to true to close it.",
    size: { w: 80, h: 32 },
    text: "SW1",
    data: { closed: false },
    draw: (ctx) => {
      const { w, h } = ctx;
      const xa = w * 0.27;
      const xb = w * 0.73;
      const r = Math.min(2.5, h * 0.12, w * 0.05);
      const rise = Math.min(h / 2 - r, (xb - xa) * 0.42);
      const tip: [number, number] = param(ctx, "closed", false) ? [xb - r, h / 2] : [xb - r * 2, h / 2 - rise];
      return [
        ...leads(ctx, xa - r, xb + r),
        line(ctx, linePath(xa + r * 0.7, h / 2 - r * 0.7, tip[0], tip[1])),
        body(ctx, ellipsePath(xa, h / 2, r, r)),
        body(ctx, ellipsePath(xb, h / 2, r, r)),
      ];
    },
  }),
  part({
    id: "transistor-npn",
    name: "Transistor (NPN)",
    aliases: ["npn", "transistor", "bjt", "npn-transistor"],
    description: "NPN bipolar transistor: base at the left, collector at the top, emitter (arrow) at the bottom.",
    size: { w: 64, h: 80 },
    keepAspect: true,
    text: "Q1",
    label: (ctx) => ({ box: { x: ctx.w + 4, y: 0, w: 120, h: ctx.h }, align: "left", padding: 0 }),
    draw: (ctx) => {
      const { w, h } = ctx;
      const r = Math.min(w * 0.42, h * 0.36);
      const cx = w - r - Math.min(2, w * 0.03);
      const cy = h / 2;
      const bar = cx - r * 0.4;
      const leg = cx + r * 0.42;
      const [dx, dy] = [leg - bar, r * 0.5];
      const d = Math.hypot(dx, dy) || 1;
      return [
        body(ctx, ellipsePath(cx, cy, r, r)),
        line(ctx, linePath(0, cy, bar, cy)),
        line(ctx, linePath(bar, cy - r * 0.6, bar, cy + r * 0.6), { strokeWidth: ctx.style.strokeWidth * 2 }),
        line(ctx, polyPath([[bar, cy - r * 0.22], [leg, cy - r * 0.72], [leg, 0]], false)),
        line(ctx, polyPath([[bar, cy + r * 0.22], [leg, cy + r * 0.72], [leg, h]], false)),
        arrowHead(ctx, leg, cy + r * 0.72, dx / d, dy / d, Math.min(8, r * 0.36)),
      ];
    },
  }),
  part({
    id: "op-amp",
    name: "Op-amp",
    aliases: ["operational-amplifier", "opamp", "amplifier", "comparator", "differential-amplifier"],
    description: "Operational amplifier: inverting (−) and non-inverting (+) inputs at the left, output at the right.",
    size: { w: 100, h: 80 },
    label: (ctx) => {
      const stub = pinStub(ctx.w);
      const bw = ctx.w - stub * 2;
      return { box: { x: stub + bw * 0.2, y: ctx.h * 0.25, w: bw * 0.5, h: ctx.h * 0.5 }, padding: 0 };
    },
    draw: (ctx) => {
      const { w, h } = ctx;
      const stub = pinStub(w);
      const s = Math.min(h * 0.055, 4.5);
      return [
        line(ctx, linePath(0, h * 0.25, stub, h * 0.25)),
        line(ctx, linePath(0, h * 0.75, stub, h * 0.75)),
        line(ctx, linePath(w - stub, h / 2, w, h / 2)),
        body(ctx, polyPath([[stub, 0], [w - stub, h / 2], [stub, h]])),
        ...sign(ctx, "-", stub + s * 2.6, h * 0.25, s),
        ...sign(ctx, "+", stub + s * 2.6, h * 0.75, s),
      ];
    },
  }),
  part({
    id: "fuse",
    name: "Fuse",
    aliases: ["circuit-breaker", "breaker", "protection"],
    description: "Fuse (IEC): a box with the conductor running through it.",
    size: { w: 80, h: 22 },
    text: "F1",
    draw: (ctx) => [
      body(ctx, rectPath(ctx.w * 0.2, 0, ctx.w * 0.6, ctx.h)),
      line(ctx, linePath(0, ctx.h / 2, ctx.w, ctx.h / 2)),
    ],
  }),
  part({
    id: "lamp",
    name: "Lamp",
    aliases: ["bulb", "light-bulb", "indicator-lamp", "light"],
    description: "Lamp / indicator: circle with a cross.",
    size: { w: 70, h: 40 },
    text: "H1",
    draw: (ctx) => {
      const { cx, cy, r, prims } = roundPart(ctx);
      const k = r * Math.SQRT1_2;
      return [...prims, line(ctx, linePath(cx - k, cy - k, cx + k, cy + k)), line(ctx, linePath(cx - k, cy + k, cx + k, cy - k))];
    },
  }),
  dot({
    id: "junction",
    name: "Junction",
    aliases: ["wire-junction", "connection-dot", "node-dot", "solder-dot"],
    keywords: ["electrical", "circuit", "schematic"],
    description: "Filled dot marking where wires are electrically connected.",
  }),
];

/* ---------------------------------------------------------- control blocks */

const control: ShapeDef[] = [
  simpleShape({
    id: "engineering/block",
    name: "Block",
    aliases: ["transfer-function", "control-block", "plant", "controller", "system-block", "pid", "tf-block"],
    keywords: ["control", "block-diagram", "signal"],
    description: "Block-diagram element; write its transfer function or name inside.",
    size: { w: 110, h: 60 },
    style: SYMBOL,
    text: "G(s)",
    path: boxPath,
  }),
  {
    id: "engineering/summing-point",
    name: "Summing point",
    aliases: ["summer", "summing-node", "adder", "comparator-node", "error-junction", "sum-block"],
    keywords: ["control", "block-diagram", "feedback", "sum"],
    description: "Adds or subtracts signals. data.signs gives the sign of the left, bottom and top inputs, e.g. \"+-\".",
    size: { w: 44, h: 44 },
    minSize: { w: 20, h: 20 },
    keepAspect: true,
    style: SYMBOL,
    text: "",
    data: { signs: "+-" },
    outline: ovalPath,
    draw: (ctx) => {
      const { w, h } = ctx;
      const signs = param(ctx, "signs", "+-");
      const s = Math.min(w, h) * 0.085;
      const at: [number, number][] = [[w * 0.22, h / 2], [w / 2, h * 0.78], [w / 2, h * 0.22]];
      return [body(ctx, ovalPath(w, h)), ...at.flatMap(([x, y], i) => (signs[i] === "+" || signs[i] === "-" ? sign(ctx, signs[i], x, y, s) : []))];
    },
  },
  simpleShape({
    id: "engineering/gain",
    name: "Gain",
    aliases: ["gain-block", "amplifier-block", "scale-factor", "k-block"],
    keywords: ["control", "block-diagram", "amplify"],
    description: "Multiplies the signal by a constant (triangle pointing along the signal flow).",
    size: { w: 72, h: 64 },
    style: SYMBOL,
    text: "K",
    label: (ctx) => ({ box: { x: 0, y: ctx.h * 0.2, w: ctx.w * 0.62, h: ctx.h * 0.6 }, padding: 4 }),
    path: (w, h) => polyPath([[0, 0], [w, h / 2], [0, h]]),
  }),
  simpleShape({
    id: "engineering/integrator",
    name: "Integrator",
    aliases: ["integral", "integrator-block", "1-over-s", "accumulator"],
    keywords: ["control", "block-diagram", "laplace"],
    description: "Integrates the signal over time (1/s in the Laplace domain).",
    size: { w: 72, h: 52 },
    style: SYMBOL,
    text: "1/s",
    path: boxPath,
  }),
  dot({
    id: "takeoff-point",
    name: "Takeoff point",
    aliases: ["pickoff-point", "branch-point", "tap", "signal-split", "take-off-point"],
    keywords: ["control", "block-diagram", "branch"],
    description: "Filled dot where a signal branches off to several blocks.",
  }),
];

export const engineeringLibrary: ShapeLibrary = {
  id: "engineering",
  name: "Engineering",
  description:
    "Logic gates (ANSI), flip-flops and ICs, basic electrical schematic symbols (terminals at the left and right centre, label underneath) and control block-diagram elements.",
  shapes: [...GATES.map(gate), flipFlop, mux, icChip, ...electrical, ...control],
};
