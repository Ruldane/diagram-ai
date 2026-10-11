import { stackHeight, stackText, stackWidth, type StackItem } from "../compartments";
import {
  body,
  boxPath,
  ellipsePath,
  line,
  linePath,
  mix,
  parseSvgPath,
  rectPath,
  shade,
  solid,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

type Meta = Pick<ShapeDef, "id" | "name" | "aliases" | "keywords" | "description" | "text">;
type Size = ShapeDef["size"];
type Box = { x: number; y: number; w: number; h: number };
type Style = NonNullable<ShapeDef["style"]>;

const KAPPA = 0.5522847498;

/* --------------------------------------------------------------- colours */

const tone = (fill: string, stroke: string, textColor = "#ffffff"): Style => ({ fill, stroke, textColor, fontSize: 15 });

const PERSON = tone("#08427b", "#073b6f");
const SYSTEM = tone("#1168bd", "#0e5aa7");
const CONTAINER = tone("#438dd5", "#3a7bba");
const COMPONENT = tone("#85bbf0", "#6fa3d8", "#10243e");
// The c4model.com grey (#999999) gives white text only ~2.9:1 contrast; this one passes WCAG AA.
const EXTERNAL = tone("#767676", "#666666");

/** Colour for inner decorations, readable on both the dark and light fills. */
const detail = (ctx: ShapeCtx): string => (ctx.style.fill === "none" ? ctx.style.stroke : mix(ctx.style.fill, ctx.style.textColor, 0.45));

/* ------------------------------------------------------------------ text */

const WRAP = 200;
const PAD = 14;

const bracketed = (value: string): string => {
  const v = value.trim();
  return !v || /^\[.*\]$/.test(v) ? v : `[${v}]`;
};

/** Line 1 = name, line 2 = type / technology (bracketed), the rest = description. */
function c4Items(ctx: Pick<ShapeCtx, "sections" | "style">, kind: string): StackItem[] {
  const [name = "", type, ...rest] = ctx.sections.join("\n").split("\n");
  const size = ctx.style.fontSize;
  return [
    { text: name, font: { bold: true } },
    { text: bracketed(type ?? kind), font: { size: size * 0.75, bold: false }, gap: 2 },
    { text: rest.join("\n").trim(), font: { size: size * 0.85, bold: false }, gap: 8 },
  ];
}

interface ElementDef extends Meta {
  /** Type line shown when the label has a single line. */
  kind: string;
  size: Size;
  style: Style;
  /** Width the description wraps at when auto-sizing. */
  wrap?: number;
  outline?: ShapeDef["outline"];
  /** Area the text is centred in. */
  textBox?: (w: number, h: number) => Box;
  shape: (ctx: ShapeCtx) => Prim[];
}

const wholeBox = (w: number, h: number): Box => ({ x: 0, y: 0, w, h });

function element(def: ElementDef): ShapeDef {
  const { kind, wrap = WRAP, textBox = wholeBox, shape, ...rest } = def;
  return {
    ...rest,
    minSize: { w: 80, h: 60 },
    label: () => null,
    fit: (ctx) => {
      const items = c4Items(ctx, kind);
      const textW = Math.min(wrap, stackWidth(ctx, items, wrap));
      let { w, h } = def.size;
      // Decorations (head, caps, bars) scale with the node, so settle the size in a few passes.
      for (let pass = 0; pass < 4; pass++) {
        const box = textBox(w, h);
        w = Math.max(def.size.w, textW + PAD * 2 + (w - box.w));
        h = Math.max(def.size.h, stackHeight(ctx, items, textBox(w, h).w - PAD * 2) + 24 + (h - box.h));
      }
      return { w, h };
    },
    draw: (ctx) => [...shape(ctx), ...stackText(ctx, textBox(ctx.w, ctx.h), c4Items(ctx, kind), { padding: PAD })],
  };
}

/* -------------------------------------------------------------- geometry */

const headRadius = (w: number, h: number): number => Math.min(w * 0.2, h * 0.24);

/** Rounded body with a circular head overlapping its top edge, as one silhouette. */
function personPath(w: number, h: number, radius: number): Path {
  const r = headRadius(w, h);
  const top = r * 1.5;
  const dx = Math.sqrt(r * r - (top - r) ** 2);
  const x1 = w / 2 - dx;
  const x2 = w / 2 + dx;
  const c = Math.max(0, Math.min(radius, (h - top) / 2, x1));
  const k = c * KAPPA;
  return [
    ["M", c, top],
    ["L", x1, top],
    ...parseSvgPath(`M${x1} ${top}A${r} ${r} 0 1 1 ${x2} ${top}`).slice(1),
    ["L", w - c, top],
    ["C", w - c + k, top, w, top + c - k, w, top + c],
    ["L", w, h - c],
    ["C", w, h - c + k, w - c + k, h, w - c, h],
    ["L", c, h],
    ["C", c - k, h, 0, h - c + k, 0, h - c],
    ["L", 0, top + c],
    ["C", 0, top + c - k, c - k, top, c, top],
    ["Z"],
  ];
}

function person(meta: Meta, style: Style): ShapeDef {
  return element({
    ...meta,
    kind: "Person",
    size: { w: 180, h: 170 },
    style: { ...style, radius: 26 },
    outline: (w, h, s) => personPath(w, h, s.radius),
    textBox: (w, h) => {
      const top = headRadius(w, h) * 2 - 4;
      return { x: 0, y: top, w, h: h - top };
    },
    shape: (ctx) => [body(ctx, personPath(ctx.w, ctx.h, ctx.style.radius))],
  });
}

function box(meta: Meta, kind: string, style: Style, size: Size = { w: 200, h: 120 }): ShapeDef {
  return element({ ...meta, kind, size, style: { ...style, radius: 6 }, shape: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))] });
}

function cylinder(w: number, h: number): { bodyPath: Path; rim: Path; cap: number } {
  const cap = Math.min(h * 0.14, w * 0.2, 16);
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

/** Cylinder lying on its side, open end on the right. */
function pipe(w: number, h: number): { bodyPath: Path; rim: Path; cap: number } {
  const cap = Math.min(w * 0.12, h * 0.2, 16);
  const bodyPath: Path = [
    ["M", cap, 0],
    ["L", w - cap, 0],
    ["C", w + cap * 0.33, 0, w + cap * 0.33, h, w - cap, h],
    ["L", cap, h],
    ["C", cap * -0.33, h, cap * -0.33, 0, cap, 0],
    ["Z"],
  ];
  const rim: Path = [
    ["M", w - cap, 0],
    ["C", w - cap * 2.33, 0, w - cap * 2.33, h, w - cap, h],
  ];
  return { bodyPath, rim, cap };
}

/** Rectangle with only its top corners rounded. */
function topBar(w: number, h: number, radius: number): Path {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const k = r * KAPPA;
  return [["M", 0, h], ["L", 0, r], ["C", 0, r - k, r - k, 0, r, 0], ["L", w - r, 0], ["C", w - r + k, 0, w, r - k, w, r], ["L", w, h], ["Z"]];
}

const chromeHeight = (h: number): number => Math.min(22, h * 0.25);
const bezel = (h: number): number => Math.min(18, h * 0.12);

/* ------------------------------------------------------------ boundaries */

const BOUNDARY_HEADER = 48;

function boundary(meta: Meta, kind: string): ShapeDef {
  return {
    ...meta,
    size: { w: 480, h: 320 },
    minSize: { w: 160, h: 100 },
    container: { header: BOUNDARY_HEADER, padding: 24 },
    style: { fill: "none", stroke: "#8a8f98", dash: "dashed", radius: 6, align: "left", textColor: "#5c6670", fontSize: 15 },
    label: () => null,
    draw: (ctx) => [
      body(ctx, boxPath(ctx.w, ctx.h, ctx.style)),
      ...stackText(ctx, { x: 0, y: 0, w: ctx.w, h: Math.min(BOUNDARY_HEADER, ctx.h) }, c4Items(ctx, kind).slice(0, 2), { padding: PAD }),
    ],
  };
}

/* ---------------------------------------------------------------- shapes */

const shapes: ShapeDef[] = [
  person(
    {
      id: "c4/person",
      name: "Person",
      aliases: ["c4-person", "c4-user", "c4-actor"],
      keywords: ["user", "actor", "role", "persona"],
      description: "A human user of the system. Text: name, then [Person], then a description.",
      text: "Customer\n[Person]\nA person who uses the system.",
    },
    PERSON,
  ),
  person(
    {
      id: "c4/external-person",
      name: "External person",
      aliases: ["c4-external-person", "c4-external-user", "person-ext"],
      keywords: ["user", "actor", "outside", "grey"],
      description: "A person outside the organisation or scope (grey).",
      text: "Supplier\n[Person]\nSomeone outside the organisation.",
    },
    EXTERNAL,
  ),
  box(
    {
      id: "c4/software-system",
      name: "Software system",
      aliases: ["c4-system", "c4-software-system"],
      keywords: ["context", "application", "product"],
      description: "The system being described, or another internal system (context diagrams).",
      text: "Software System\n[Software System]\nWhat the system does and who it is for.",
    },
    "Software System",
    SYSTEM,
  ),
  box(
    {
      id: "c4/external-system",
      name: "External system",
      aliases: ["c4-external-system", "system-ext", "third-party-system"],
      keywords: ["dependency", "outside", "grey", "saas"],
      description: "A system you depend on but do not own (grey).",
      text: "External System\n[Software System]\nA system we rely on but do not own.",
    },
    "Software System",
    EXTERNAL,
  ),
  box(
    {
      id: "c4/container",
      name: "Container",
      aliases: ["c4-container", "c4-application", "c4-service"],
      keywords: ["application", "service", "api", "deployable"],
      description: "A deployable unit: application, service or API. Line 2 is [Container: technology].",
      text: "API Application\n[Container: Node.js]\nProvides the product's features over a JSON/HTTPS API.",
    },
    "Container",
    CONTAINER,
  ),
  element({
    id: "c4/database",
    name: "Database container",
    aliases: ["c4-database", "c4-db", "container-db", "c4-datastore"],
    keywords: ["storage", "sql", "cylinder"],
    description: "A container that stores data, drawn as a cylinder.",
    text: "Database\n[Container: PostgreSQL]\nStores orders, accounts and audit logs.",
    kind: "Container: Database",
    size: { w: 200, h: 140 },
    style: CONTAINER,
    outline: (w, h) => cylinder(w, h).bodyPath,
    textBox: (w, h) => {
      const { cap } = cylinder(w, h);
      return { x: 0, y: cap * 2, w, h: h - cap * 2.5 };
    },
    shape: (ctx) => {
      const { bodyPath, rim } = cylinder(ctx.w, ctx.h);
      return [body(ctx, bodyPath), line(ctx, rim, { stroke: detail(ctx) })];
    },
  }),
  element({
    id: "c4/queue",
    name: "Queue container",
    aliases: ["c4-queue", "container-queue", "c4-topic", "c4-message-bus"],
    keywords: ["messaging", "broker", "stream", "pipe"],
    description: "A message queue, topic or stream, drawn as a horizontal pipe.",
    text: "Message Queue\n[Container: RabbitMQ]\nBuffers events between services.",
    kind: "Container: Queue",
    size: { w: 230, h: 110 },
    style: CONTAINER,
    outline: (w, h) => pipe(w, h).bodyPath,
    textBox: (w, h) => {
      const { cap } = pipe(w, h);
      return { x: cap * 0.4, y: 0, w: w - cap * 2.4, h };
    },
    shape: (ctx) => {
      const { bodyPath, rim } = pipe(ctx.w, ctx.h);
      return [body(ctx, bodyPath), line(ctx, rim, { stroke: detail(ctx) })];
    },
  }),
  element({
    id: "c4/web-app",
    name: "Web application container",
    aliases: ["c4-web-app", "c4-browser", "container-web", "c4-spa"],
    keywords: ["browser", "frontend", "website", "single-page app"],
    description: "A container that runs in the browser, drawn with a browser bar.",
    text: "Web Application\n[Container: React]\nDelivers the user interface in the browser.",
    kind: "Container: Web Browser",
    size: { w: 200, h: 140 },
    style: { ...CONTAINER, radius: 8 },
    textBox: (w, h) => ({ x: 0, y: chromeHeight(h), w, h: h - chromeHeight(h) }),
    shape: (ctx) => {
      const { w, h, style } = ctx;
      const bar = chromeHeight(h);
      const dot = bar * 0.14;
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      if (style.fill !== "none") prims.push(solid(topBar(w, bar, style.radius), shade(style.fill, 0.22)), line(ctx, boxPath(w, h, style), { dash: style.dash }));
      else prims.push(line(ctx, linePath(0, bar, w, bar)));
      for (let i = 0; i < 3; i++) prims.push(solid(ellipsePath(bar * 0.6 + i * bar * 0.5, bar / 2, dot, dot), detail(ctx)));
      const address = bar * 2.3;
      if (w - address - bar * 0.5 > 12) prims.push(solid(rectPath(address, bar * 0.25, w - address - bar * 0.5, bar * 0.5, bar * 0.25), detail(ctx), { opacity: 0.55 }));
      return prims;
    },
  }),
  element({
    id: "c4/mobile-app",
    name: "Mobile app container",
    aliases: ["c4-mobile-app", "c4-mobile", "container-mobile"],
    keywords: ["phone", "ios", "android", "native app"],
    description: "A container that runs on a phone or tablet, drawn as a device.",
    text: "Mobile App\n[Container: Swift]\nGives customers access on the go.",
    kind: "Container: Mobile App",
    size: { w: 150, h: 210 },
    wrap: 122,
    style: { ...CONTAINER, radius: 20 },
    textBox: (w, h) => ({ x: 0, y: bezel(h), w, h: h - bezel(h) * 2 }),
    shape: (ctx) => {
      const { w, h, style } = ctx;
      const edge = bezel(h);
      const mark = { stroke: detail(ctx), strokeWidth: Math.min(3, edge * 0.2), round: true };
      return [
        body(ctx, boxPath(w, h, style)),
        line(ctx, linePath(w * 0.4, edge * 0.6, w * 0.6, edge * 0.6), mark),
        line(ctx, linePath(w * 0.34, h - edge * 0.55, w * 0.66, h - edge * 0.55), mark),
      ];
    },
  }),
  box(
    {
      id: "c4/component",
      name: "Component",
      aliases: ["c4-component", "c4-module"],
      keywords: ["module", "class", "controller", "building block"],
      description: "A building block inside a container. Line 2 is [Component: technology].",
      text: "Order Controller\n[Component: REST Controller]\nHandles order requests.",
    },
    "Component",
    COMPONENT,
    { w: 200, h: 110 },
  ),
  boundary(
    {
      id: "c4/system-boundary",
      name: "System boundary",
      aliases: ["c4-system-boundary", "c4-boundary", "software-system-boundary"],
      keywords: ["scope", "dashed", "container diagram"],
      description: "Dashed container marking the edge of a software system; put its containers inside.",
      text: "Internet Banking System\n[Software System]",
    },
    "Software System",
  ),
  boundary(
    {
      id: "c4/container-boundary",
      name: "Container boundary",
      aliases: ["c4-container-boundary", "component-diagram-boundary"],
      keywords: ["scope", "dashed", "component diagram"],
      description: "Dashed container marking the edge of a container; put its components inside.",
      text: "API Application\n[Container]",
    },
    "Container",
  ),
  boundary(
    {
      id: "c4/enterprise-boundary",
      name: "Enterprise boundary",
      aliases: ["c4-enterprise-boundary", "organisation-boundary"],
      keywords: ["scope", "dashed", "company", "landscape"],
      description: "Dashed container marking the edge of an organisation; put its people and systems inside.",
      text: "Big Bank plc\n[Enterprise]",
    },
    "Enterprise",
  ),
];

export const c4Library: ShapeLibrary = {
  id: "c4",
  name: "C4 model",
  description: "C4 architecture diagrams: people, software systems, containers, components and boundaries.",
  shapes,
};
