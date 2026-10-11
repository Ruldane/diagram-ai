import { stackText } from "../compartments";
import {
  body,
  boxPath,
  ellipsePath,
  fontOf,
  icon,
  line,
  linePath,
  linesOf,
  measureBlock,
  measureText,
  ovalPath,
  param,
  polyPath,
  rectPath,
  solid,
  text,
  tint,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

const KAPPA = 0.5522847498;

const STROKE = "#5c6670";
const TEXT = "#343a40";
const PLACEHOLDER = "#868e96";
const SURFACE = "#f1f3f5";

/** Greyscale low-fidelity look shared by every component. */
const BASE = { fill: "#ffffff", stroke: STROKE, strokeWidth: 1.25, fontSize: 13, textColor: TEXT } as const;

/** Prefixes the id and applies the wireframe base style. */
const wf = (def: ShapeDef): ShapeDef => ({ ...def, id: `wireframe/${def.id}`, style: { ...BASE, ...def.style } });

/* Greys are derived from the node's own colours, so restyling a component restyles all of it. */
const surface = (ctx: ShapeCtx): string => (ctx.style.fill === "none" ? "none" : tint(ctx.style.stroke, 0.87));
const rule = (ctx: ShapeCtx): string => tint(ctx.style.stroke, 0.66);
const ghost = (ctx: ShapeCtx): string => tint(ctx.style.stroke, 0.6);
const dim = (ctx: ShapeCtx): string => tint(ctx.style.textColor, 0.38);
const paper = (ctx: ShapeCtx): string => (ctx.style.fill === "none" ? "#ffffff" : ctx.style.fill);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const ratio = (ctx: ShapeCtx, key: string, fallback: number): number => clamp(param(ctx, key, fallback), 0, 1);
/** Items of a `|`-separated label (new lines also separate). */
const parts = (ctx: Pick<ShapeCtx, "text">): string[] =>
  ctx.text
    .split(/[|\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
const index = (ctx: ShapeCtx, key: string, length: number): number => clamp(Math.round(param(ctx, key, 0)), 0, Math.max(0, length - 1));

const chevron = (ctx: ShapeCtx, cx: number, cy: number, s: number, direction: "left" | "right" | "down"): Prim => {
  const points: [number, number][] =
    direction === "down"
      ? [[cx - s, cy - s / 2], [cx, cy + s / 2], [cx + s, cy - s / 2]]
      : [-1, 0, 1].map((k): [number, number] => [cx + (direction === "right" ? 1 : -1) * (k === 0 ? s / 2 : -s / 2), cy + k * s]);
  return line(ctx, polyPath(points, false), { round: true });
};

/** Single-line text drawn by the shape itself. */
const cell = (ctx: ShapeCtx, content: string, x: number, y: number, w: number, h: number, options: Parameters<typeof text>[3] = {}): Prim =>
  text(ctx, content, { x, y, w, h }, { align: "left", valign: "middle", wrap: false, ...options });

/** Caption on a small patch of the node fill, centred on `(cx, cy)`. */
function caption(ctx: ShapeCtx, cx: number, cy: number): Prim[] {
  if (!ctx.text.trim()) return [];
  const font = fontOf(ctx.style);
  const size = measureBlock(ctx.text, font, Math.max(40, ctx.w - 28));
  const box = { x: cx - size.w / 2 - 8, y: cy - size.h / 2 - 3, w: size.w + 16, h: size.h + 6 };
  return [{ ...text(ctx, ctx.text, box, { align: "center", valign: "middle", padding: 0 }), background: ctx.style.fill === "none" ? undefined : ctx.style.fill }];
}

/** Box whose top `bar` pixels are tinted (browser chrome, table header). */
function barred(ctx: ShapeCtx, bar: number): Prim[] {
  const { w, h, style } = ctx;
  const outline = rectPath(0, 0, w, h, style.radius);
  return [
    body(ctx, outline),
    solid(rectPath(0, 0, w, bar, style.radius), surface(ctx)),
    solid(rectPath(0, bar / 2, w, bar / 2), surface(ctx)),
    line(ctx, linePath(0, bar, w, bar), { strokeWidth: 1 }),
    line(ctx, outline, { dash: style.dash }),
  ];
}

/* ----------------------------------------------------- windows and devices */

const BROWSER_BAR = 36;
const DEVICE_HEADER = 44;
const MODAL_BAR = 40;

interface DevicePreset {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  size: { w: number; h: number };
  radius: number;
  /** Width of the speaker slot as a fraction of the device width (0 = round camera). */
  speaker: number;
}

function device(preset: DevicePreset): ShapeDef {
  return wf({
    id: preset.id,
    name: preset.name,
    aliases: preset.aliases,
    keywords: ["device", "mobile", "screen", "mockup"],
    description: preset.description,
    size: preset.size,
    minSize: { w: 100, h: 140 },
    container: { header: DEVICE_HEADER, padding: 18 },
    style: { radius: preset.radius, strokeWidth: 2, bold: true },
    text: "Screen title",
    label: (ctx) => ({ box: { x: 0, y: 16, w: ctx.w, h: DEVICE_HEADER - 16 }, padding: 16, wrap: false }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const slot = Math.min(5, h * 0.03);
      const speaker = Math.max(slot, Math.min(w * preset.speaker, 56));
      const home = Math.min(w * 0.34, 90);
      return [
        body(ctx, rectPath(0, 0, w, h, Math.min(style.radius, w * 0.16, h * 0.16))),
        solid(rectPath((w - speaker) / 2, 8, speaker, slot, slot / 2), ghost(ctx)),
        solid(rectPath((w - home) / 2, h - 10, home, 4, 2), ghost(ctx)),
      ];
    },
  });
}

const frames: ShapeDef[] = [
  wf({
    id: "browser-window",
    name: "Browser window",
    aliases: ["browser-frame", "web-page", "webpage", "window", "site", "desktop-screen", "web-screen"],
    keywords: ["frame", "chrome", "page", "screen"],
    description: "Browser frame that contains a web page mock-up. The text is shown in the address bar.",
    size: { w: 520, h: 340 },
    minSize: { w: 160, h: 100 },
    container: { header: BROWSER_BAR, padding: 16 },
    style: { radius: 8, fontSize: 12, textColor: PLACEHOLDER, align: "left" },
    text: "https://example.com",
    label: (ctx) => {
      const x = Math.min(74, ctx.w * 0.3);
      return { box: { x, y: 7, w: Math.max(0, ctx.w - x - 12), h: BROWSER_BAR - 14 }, padding: 12, wrap: false };
    },
    draw: (ctx) => {
      const { w } = ctx;
      const x = Math.min(74, w * 0.3);
      return [
        ...barred(ctx, BROWSER_BAR),
        ...[0, 1, 2].map((i) => solid(ellipsePath(Math.min(18, w * 0.07) + i * Math.min(15, w * 0.06), BROWSER_BAR / 2, 4, 4), ghost(ctx))),
        solid(rectPath(x, 7, Math.max(0, w - x - 12), BROWSER_BAR - 14, 11), paper(ctx)),
      ];
    },
  }),
  device({
    id: "phone",
    name: "Phone",
    aliases: ["mobile-screen", "smartphone", "iphone", "android-phone", "mobile-frame", "app-screen"],
    description: "Phone outline that contains a mobile screen mock-up. The text is the screen title.",
    size: { w: 250, h: 500 },
    radius: 30,
    speaker: 0.24,
  }),
  device({
    id: "tablet",
    name: "Tablet",
    aliases: ["ipad", "tablet-screen", "tablet-frame"],
    description: "Tablet outline that contains a screen mock-up. The text is the screen title.",
    size: { w: 560, h: 400 },
    radius: 22,
    speaker: 0,
  }),
  wf({
    id: "modal",
    name: "Modal",
    aliases: ["dialog", "popup", "modal-dialog", "alert-dialog", "overlay", "sheet"],
    keywords: ["window", "confirm", "prompt"],
    description: "Dialog with a title bar and a close button; place its content and buttons inside.",
    size: { w: 380, h: 240 },
    minSize: { w: 140, h: 90 },
    container: { header: MODAL_BAR, padding: 16 },
    style: { radius: 10, shadow: true, bold: true, align: "left", fontSize: 14 },
    text: "Dialog title",
    label: (ctx) => ({ box: { x: 0, y: 0, w: Math.max(0, ctx.w - 36), h: MODAL_BAR }, padding: 16, wrap: false }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const x = w - 20;
      const y = MODAL_BAR / 2;
      return [
        body(ctx, rectPath(0, 0, w, h, style.radius)),
        line(ctx, linePath(0, MODAL_BAR, w, MODAL_BAR), { stroke: rule(ctx), strokeWidth: 1 }),
        line(ctx, linePath(x - 4.5, y - 4.5, x + 4.5, y + 4.5), { round: true }),
        line(ctx, linePath(x - 4.5, y + 4.5, x + 4.5, y - 4.5), { round: true }),
      ];
    },
  }),
  wf({
    id: "card",
    name: "Card",
    aliases: ["panel", "content-card", "widget", "surface"],
    description: "Rounded content card: the first line is the title, the following lines are supporting text.",
    size: { w: 220, h: 120 },
    minSize: { w: 60, h: 40 },
    style: { radius: 8, align: "left" },
    text: "Card title\nSupporting text that describes the content.",
    label: () => null,
    draw: (ctx) => {
      const [title = "", ...rest] = ctx.text.split("\n");
      return [
        body(ctx, boxPath(ctx.w, ctx.h, ctx.style)),
        ...stackText(
          ctx,
          { x: 0, y: 0, w: ctx.w, h: ctx.h },
          [
            { text: title, font: { bold: true, size: ctx.style.fontSize * 1.08 } },
            { text: rest.join("\n"), color: dim(ctx), gap: 4 },
          ],
          { align: ctx.style.align, valign: "top", padding: 14 },
        ),
      ];
    },
  }),
];

/* ------------------------------------------------------------ form controls */

const FIELD = { radius: 6, align: "left", textColor: PLACEHOLDER } as const;

type ChoiceKind = "checkbox" | "radio" | "toggle";

/** Mark at the left (box, circle or switch) with the label to its right. */
function choice(kind: ChoiceKind, def: Pick<ShapeDef, "id" | "name" | "aliases" | "description" | "text">): ShapeDef {
  const key = kind === "toggle" ? "on" : "checked";
  const mark = (h: number): { s: number; mw: number } => {
    const s = Math.min(h, 18);
    return { s, mw: kind === "toggle" ? s * 1.8 : s };
  };
  return wf({
    ...def,
    keywords: ["form", "input", "option", "select"],
    size: { w: 140, h: 20 },
    minSize: { w: 16, h: 12 },
    style: { align: "left" },
    data: { [key]: true },
    label: (ctx) => {
      const x = mark(ctx.h).mw + 8;
      return { box: { x, y: 0, w: Math.max(0, ctx.w - x), h: ctx.h }, padding: 0, wrap: false };
    },
    fit: (ctx) => ({ w: mark(20).mw + 8 + measureText(ctx.text.split("\n")[0], fontOf(ctx.style)) + 4, h: 20 }),
    draw: (ctx) => {
      const { h, style } = ctx;
      const on = param(ctx, key, true);
      const { s, mw } = mark(h);
      const y = (h - s) / 2;
      if (kind === "checkbox") {
        const tick = polyPath([[s * 0.24, y + s * 0.52], [s * 0.43, y + s * 0.7], [s * 0.77, y + s * 0.31]], false);
        return [
          body(ctx, rectPath(0, y, s, s, Math.min(3, s / 4)), on ? { fill: style.stroke } : {}),
          ...(on ? [line(ctx, tick, { stroke: paper(ctx), strokeWidth: Math.max(1.5, s / 10), round: true })] : []),
        ];
      }
      if (kind === "radio") {
        return [body(ctx, ellipsePath(s / 2, h / 2, s / 2, s / 2)), ...(on ? [solid(ellipsePath(s / 2, h / 2, s * 0.25, s * 0.25), style.stroke)] : [])];
      }
      const knob = s / 2 - Math.min(2.5, s * 0.14);
      return [
        body(ctx, rectPath(0, y, mw, s, s / 2), { fill: on ? style.stroke : surface(ctx) }),
        solid(ellipsePath(on ? mw - s / 2 : s / 2, h / 2, knob, knob), on ? paper(ctx) : style.stroke),
      ];
    },
  });
}

/** Horizontal track filled up to `value`: slider (with a knob) and progress bar. */
function track(ctx: ShapeCtx, thickness: number): { x: number; prims: Prim[] } {
  const { w, h } = ctx;
  const x = w * ratio(ctx, "value", 0.5);
  const y = (h - thickness) / 2;
  return {
    x,
    prims: [solid(rectPath(0, y, w, thickness, thickness / 2), rule(ctx)), solid(rectPath(0, y, x, thickness, thickness / 2), ctx.style.stroke)],
  };
}

const controls: ShapeDef[] = [
  wf({
    id: "button",
    name: "Button",
    aliases: ["primary-button", "cta", "submit-button", "action-button", "btn"],
    description: "Primary call-to-action button (filled).",
    size: { w: 110, h: 40 },
    minSize: { w: 30, h: 20 },
    style: { fill: TEXT, stroke: TEXT, textColor: "#ffffff", radius: 6, bold: true },
    text: "Button",
    label: () => ({ wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))],
  }),
  wf({
    id: "button-secondary",
    name: "Secondary button",
    aliases: ["outline-button", "ghost-button", "cancel-button", "secondary-btn"],
    description: "Secondary button (outlined).",
    size: { w: 110, h: 40 },
    minSize: { w: 30, h: 20 },
    style: { radius: 6, bold: true },
    text: "Cancel",
    label: () => ({ wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))],
  }),
  wf({
    id: "input",
    name: "Text input",
    aliases: ["text-field", "textbox", "text-input", "input-field", "form-field", "textfield"],
    keywords: ["form", "field", "entry"],
    description: "Single-line text field; the text is its placeholder or value.",
    size: { w: 220, h: 40 },
    minSize: { w: 40, h: 20 },
    style: FIELD,
    text: "Placeholder",
    label: () => ({ padding: 12, wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))],
  }),
  wf({
    id: "textarea",
    name: "Text area",
    aliases: ["multiline-input", "text-area", "comment-box", "message-box"],
    keywords: ["form", "field", "multiline"],
    description: "Multi-line text field with a resize grip.",
    size: { w: 220, h: 90 },
    minSize: { w: 40, h: 30 },
    style: { ...FIELD, valign: "top" },
    text: "Write a message",
    label: () => ({ padding: 12 }),
    draw: (ctx) => {
      const { w, h } = ctx;
      const g = Math.min(10, w * 0.2, h * 0.2);
      return [
        body(ctx, boxPath(w, h, ctx.style)),
        ...[1, 0.5].map((k) => line(ctx, linePath(w - 4 - g * k, h - 4, w - 4, h - 4 - g * k), { stroke: ghost(ctx), strokeWidth: 1 })),
      ];
    },
  }),
  wf({
    id: "dropdown",
    name: "Dropdown",
    aliases: ["select", "combobox", "select-box", "picker", "combo-box", "menu-button"],
    keywords: ["form", "field", "options"],
    description: "Select field with a chevron; the text is the selected value.",
    size: { w: 220, h: 40 },
    minSize: { w: 40, h: 20 },
    style: { ...FIELD, textColor: TEXT },
    text: "Select an option",
    label: (ctx) => ({ box: { x: 0, y: 0, w: Math.max(0, ctx.w - 28), h: ctx.h }, padding: 12, wrap: false }),
    draw: (ctx) => [body(ctx, boxPath(ctx.w, ctx.h, ctx.style)), chevron(ctx, ctx.w - Math.min(18, ctx.w * 0.2), ctx.h / 2, Math.min(4.5, ctx.h * 0.15), "down")],
  }),
  wf({
    id: "search",
    name: "Search field",
    aliases: ["search-box", "search-bar", "search-input", "searchbar"],
    keywords: ["form", "field", "find", "filter"],
    description: "Search input with a magnifier icon.",
    size: { w: 220, h: 40 },
    minSize: { w: 40, h: 20 },
    style: { ...FIELD, radius: 20 },
    text: "Search",
    label: (ctx) => {
      const x = Math.min(12 + 16, ctx.w * 0.4);
      return { box: { x, y: 0, w: Math.max(0, ctx.w - x), h: ctx.h }, padding: 8, wrap: false };
    },
    draw: (ctx) => {
      const size = Math.min(16, ctx.h * 0.5, ctx.w * 0.3);
      return [body(ctx, boxPath(ctx.w, ctx.h, ctx.style)), ...icon(ctx, "search", Math.min(12, ctx.w * 0.1), (ctx.h - size) / 2, size, ghost(ctx))];
    },
  }),
  choice("checkbox", {
    id: "checkbox",
    name: "Checkbox",
    aliases: ["check-box", "tick-box", "checkmark-option"],
    description: "Checkbox with its label. data.checked toggles the tick.",
    text: "Remember me",
  }),
  choice("radio", {
    id: "radio",
    name: "Radio button",
    aliases: ["radio-button", "option-button", "radio-option"],
    description: "Radio button with its label. data.checked selects it.",
    text: "Option",
  }),
  choice("toggle", {
    id: "toggle",
    name: "Toggle",
    aliases: ["switch-control", "toggle-switch", "on-off-switch"],
    description: "On/off switch with its label. data.on sets the state.",
    text: "Notifications",
  }),
  wf({
    id: "slider",
    name: "Slider",
    aliases: ["range", "range-slider", "range-input", "scrubber"],
    keywords: ["form", "input", "value"],
    description: "Slider with a knob. data.value (0..1) sets the position.",
    size: { w: 180, h: 20 },
    minSize: { w: 30, h: 10 },
    data: { value: 0.4 },
    label: () => null,
    draw: (ctx) => {
      const r = Math.min(ctx.h / 2, 8, ctx.w / 4);
      const { x, prims } = track(ctx, Math.min(4, ctx.h / 3));
      return [...prims, body(ctx, ellipsePath(clamp(x, r, ctx.w - r), ctx.h / 2, r, r))];
    },
  }),
  wf({
    id: "progress",
    name: "Progress bar",
    aliases: ["progress-bar", "loading-bar", "loader", "meter"],
    keywords: ["status", "loading", "percent"],
    description: "Progress bar. data.value (0..1) sets how much is filled.",
    size: { w: 200, h: 10 },
    minSize: { w: 30, h: 4 },
    data: { value: 0.6 },
    label: () => null,
    draw: (ctx) => track(ctx, ctx.h).prims,
  }),
  wf({
    id: "icon-button",
    name: "Icon button",
    aliases: ["icon-btn", "toolbar-button", "action-icon", "fab"],
    description: "Square button showing an icon. data.icon picks the icon (e.g. plus, settings, search, x).",
    size: { w: 36, h: 36 },
    minSize: { w: 20, h: 20 },
    keepAspect: true,
    style: { radius: 6 },
    data: { icon: "settings" },
    label: () => null,
    draw: (ctx) => {
      const size = Math.min(ctx.w, ctx.h) * 0.5;
      return [body(ctx, boxPath(ctx.w, ctx.h, ctx.style)), ...icon(ctx, param(ctx, "icon", "settings"), (ctx.w - size) / 2, (ctx.h - size) / 2, size)];
    },
  }),
];

/* --------------------------------------------------------- content blocks */

const PLACEHOLDER_STYLE = { fill: SURFACE, textColor: PLACEHOLDER, fontSize: 12 } as const;

const content: ShapeDef[] = [
  wf({
    id: "heading",
    name: "Heading",
    aliases: ["h1", "page-title", "headline", "section-title"],
    description: "Large bold heading text without a box.",
    size: { w: 200, h: 40 },
    minSize: { w: 20, h: 16 },
    style: { fill: "none", stroke: "none", fontSize: 24, bold: true, align: "left", textColor: "#212529" },
    text: "Heading",
    label: () => ({ padding: 0 }),
    fit: (ctx) => {
      const size = measureBlock(ctx.text || "Heading", fontOf(ctx.style), 480);
      return { w: size.w + 4, h: size.h + 4 };
    },
    draw: (ctx) => (ctx.style.fill === "none" && ctx.style.stroke === "none" ? [] : [body(ctx, boxPath(ctx.w, ctx.h, ctx.style))]),
  }),
  wf({
    id: "paragraph",
    name: "Paragraph",
    aliases: ["text-block", "lorem-ipsum", "body-text", "placeholder-text", "text-lines", "copy"],
    description: "Grey placeholder lines standing in for body text. Set a text to show real copy instead.",
    size: { w: 220, h: 70 },
    minSize: { w: 30, h: 12 },
    style: { align: "left", valign: "top", textColor: PLACEHOLDER },
    text: "",
    label: () => ({ padding: 0 }),
    draw: (ctx) => {
      if (ctx.text.trim()) return [];
      const { w, h } = ctx;
      const n = Math.max(1, Math.round(h / 17));
      const pitch = h / n;
      const t = Math.min(7, pitch * 0.45);
      const widths = [1, 0.94, 0.98, 0.88];
      return Array.from({ length: n }, (_, i) =>
        solid(rectPath(0, i * pitch + (pitch - t) / 2, w * (n > 1 && i === n - 1 ? 0.58 : widths[i % widths.length]), t, t / 2), ghost(ctx)),
      );
    },
  }),
  wf({
    id: "image",
    name: "Image",
    aliases: ["image-placeholder", "picture", "photo", "img", "thumbnail", "hero-image", "banner"],
    keywords: ["media", "placeholder"],
    description: "Image placeholder: a box with a diagonal cross. The text is an optional caption.",
    size: { w: 200, h: 130 },
    minSize: { w: 24, h: 24 },
    style: PLACEHOLDER_STYLE,
    text: "Image",
    label: () => null,
    draw: (ctx) => {
      const { w, h } = ctx;
      const outline = boxPath(w, h, ctx.style);
      return [
        body(ctx, outline),
        line(ctx, linePath(0, 0, w, h), { stroke: rule(ctx), strokeWidth: 1 }),
        line(ctx, linePath(0, h, w, 0), { stroke: rule(ctx), strokeWidth: 1 }),
        line(ctx, outline, { dash: ctx.style.dash }),
        ...caption(ctx, w / 2, h / 2),
      ];
    },
  }),
  wf({
    id: "avatar",
    name: "Avatar",
    aliases: ["profile-picture", "user-avatar", "profile-photo", "user-icon"],
    keywords: ["person", "account", "profile"],
    description: "Round user avatar. The text is shown underneath.",
    size: { w: 48, h: 48 },
    minSize: { w: 20, h: 20 },
    keepAspect: true,
    style: { fill: SURFACE },
    text: "",
    label: (ctx) => ({ box: { x: -60, y: ctx.h + 4, w: ctx.w + 120, h: 36 }, valign: "top", padding: 0 }),
    outline: ovalPath,
    draw: (ctx) => {
      const size = Math.min(ctx.w, ctx.h) * 0.56;
      return [body(ctx, ovalPath(ctx.w, ctx.h)), ...icon(ctx, "user", (ctx.w - size) / 2, (ctx.h - size) / 2, size)];
    },
  }),
  wf({
    id: "video",
    name: "Video",
    aliases: ["video-player", "video-placeholder", "media-player", "player"],
    keywords: ["media", "placeholder", "play"],
    description: "Video placeholder with a play button and a scrubber. The text is an optional caption.",
    size: { w: 280, h: 160 },
    minSize: { w: 40, h: 30 },
    style: PLACEHOLDER_STYLE,
    text: "",
    label: () => null,
    draw: (ctx) => {
      const { w, h } = ctx;
      const r = Math.min(26, w * 0.2, h * 0.24);
      const pad = Math.min(14, w * 0.08);
      const y = h - Math.min(14, h * 0.14);
      const played = pad + (w - pad * 2) * 0.3;
      return [
        body(ctx, boxPath(w, h, ctx.style)),
        body(ctx, ellipsePath(w / 2, h / 2, r, r), { fill: paper(ctx) === SURFACE ? "#ffffff" : paper(ctx), dash: "solid" }),
        solid(polyPath([[w / 2 - r * 0.3, h / 2 - r * 0.45], [w / 2 + r * 0.5, h / 2], [w / 2 - r * 0.3, h / 2 + r * 0.45]]), ctx.style.stroke),
        line(ctx, linePath(pad, y, w - pad, y), { stroke: rule(ctx), strokeWidth: 3, round: true }),
        line(ctx, linePath(pad, y, played, y), { strokeWidth: 3, round: true }),
        ...caption(ctx, w / 2, Math.min(h / 2 + r + 16, y - 14)),
      ];
    },
  }),
  wf({
    id: "chart-placeholder",
    name: "Chart placeholder",
    aliases: ["chart", "graph-placeholder", "bar-chart", "line-chart", "analytics-widget", "plot"],
    keywords: ["data", "placeholder", "dashboard", "kpi"],
    description: "Chart placeholder sketching bars and a trend line. The text is the chart title.",
    size: { w: 260, h: 160 },
    minSize: { w: 50, h: 40 },
    style: { radius: 8, bold: true, align: "left", valign: "top" },
    text: "Chart title",
    label: () => ({ padding: 12, wrap: false }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const pad = Math.min(14, w * 0.1, h * 0.1);
      const top = ctx.text.trim() ? Math.min(pad + style.fontSize * 1.9, h * 0.4) : pad;
      const plotH = h - pad - top;
      const bars = [0.42, 0.66, 0.5, 0.88, 0.7];
      const trend = [0.3, 0.52, 0.44, 0.68, 0.96];
      const slot = (w - pad * 2) / bars.length;
      const points = trend.map((v, i): [number, number] => [pad + slot * (i + 0.5), h - pad - v * plotH]);
      return [
        body(ctx, boxPath(w, h, style)),
        ...bars.map((v, i) => solid(rectPath(pad + slot * (i + 0.2), h - pad - v * plotH, slot * 0.6, v * plotH, 2), tint(style.stroke, 0.78))),
        line(ctx, polyPath([[pad, top], [pad, h - pad], [w - pad, h - pad]], false), { stroke: ghost(ctx), strokeWidth: 1 }),
        line(ctx, polyPath(points, false), { strokeWidth: 1.5, round: true }),
        ...points.map(([x, y]) => solid(ellipsePath(x, y, Math.min(2.5, slot * 0.1), Math.min(2.5, slot * 0.1)), style.stroke)),
      ];
    },
  }),
  wf({
    id: "map-placeholder",
    name: "Map placeholder",
    aliases: ["map", "map-view", "location-map", "geo-map"],
    keywords: ["location", "placeholder", "geo"],
    description: "Map placeholder with roads and a location pin. The text is an optional caption.",
    size: { w: 260, h: 160 },
    minSize: { w: 40, h: 30 },
    style: PLACEHOLDER_STYLE,
    text: "",
    label: () => null,
    draw: (ctx) => {
      const { w, h } = ctx;
      const outline = boxPath(w, h, ctx.style);
      const road = { stroke: paper(ctx) === SURFACE ? "#ffffff" : rule(ctx), strokeWidth: Math.min(6, h * 0.05), round: true };
      const pin = Math.min(34, w * 0.3, h * 0.36);
      const inset = Math.min(4, w * 0.05);
      const curve: Path = [
        ["M", inset, h * 0.68],
        ["C", w * 0.3, h * 0.5, w * 0.55, h * 0.92, w - inset, h * 0.6],
      ];
      return [
        body(ctx, outline),
        line(ctx, curve, road),
        line(ctx, linePath(w * 0.26, inset, w * 0.4, h - inset), road),
        line(ctx, linePath(w * 0.62, inset, w * 0.84, h - inset), { ...road, strokeWidth: road.strokeWidth * 0.6 }),
        line(ctx, linePath(inset, h * 0.26, w - inset, h * 0.2), { ...road, strokeWidth: road.strokeWidth * 0.6 }),
        line(ctx, outline, { dash: ctx.style.dash }),
        ...icon(ctx, "map-pin", (w - pin) / 2, h / 2 - pin * 0.85, pin),
        ...caption(ctx, w / 2, Math.min(h / 2 + pin * 0.5 + 8, h - 14)),
      ];
    },
  }),
  wf({
    id: "divider",
    name: "Divider",
    aliases: ["hr", "horizontal-rule", "section-divider", "line-separator"],
    description: "Thin horizontal rule between sections of a screen.",
    size: { w: 240, h: 10 },
    minSize: { w: 20, h: 2 },
    label: () => null,
    draw: (ctx) => [line(ctx, linePath(0, ctx.h / 2, ctx.w, ctx.h / 2), { stroke: rule(ctx), strokeWidth: 1, dash: ctx.style.dash })],
  }),
  wf({
    id: "badge",
    name: "Badge",
    aliases: ["status-badge", "label-pill", "counter", "status-chip", "notification-badge"],
    description: "Small pill for a status, count or tag.",
    size: { w: 50, h: 20 },
    minSize: { w: 16, h: 12 },
    style: { fill: SURFACE, fontSize: 11, bold: true, strokeWidth: 1 },
    text: "Badge",
    label: () => ({ padding: 2, wrap: false }),
    fit: (ctx) => ({ w: measureText(ctx.text.split("\n")[0], fontOf(ctx.style)) + 18, h: 20 }),
    outline: (w, h) => rectPath(0, 0, w, h, h / 2),
    draw: (ctx) => [body(ctx, rectPath(0, 0, ctx.w, ctx.h, ctx.h / 2))],
  }),
];

/* -------------------------------------------------------------- navigation */

function tooltipPath(w: number, h: number, radius: number): Path {
  const a = Math.min(6, h * 0.2, w * 0.2);
  const b = h - a;
  const r = Math.max(0, Math.min(radius, b / 2, w / 2));
  const k = r * KAPPA;
  const half = Math.max(0, Math.min(a, w / 2 - r));
  return [
    ["M", r, 0],
    ["L", w - r, 0],
    ["C", w - r + k, 0, w, r - k, w, r],
    ["L", w, b - r],
    ["C", w, b - r + k, w - r + k, b, w - r, b],
    ["L", w / 2 + half, b],
    ["L", w / 2, h],
    ["L", w / 2 - half, b],
    ["L", r, b],
    ["C", r - k, b, 0, b - r + k, 0, b - r],
    ["L", 0, r],
    ["C", 0, r - k, r - k, 0, r, 0],
    ["Z"],
  ];
}

const navigation: ShapeDef[] = [
  wf({
    id: "navbar",
    name: "Navigation bar",
    aliases: ["nav", "top-bar", "header-bar", "app-bar", "menu-bar", "topnav", "site-header"],
    keywords: ["navigation", "menu", "links"],
    description: "Top navigation bar. Items are separated by `|`: the first is the brand, the rest are links at the right.",
    size: { w: 520, h: 50 },
    minSize: { w: 80, h: 24 },
    style: { fill: SURFACE },
    text: "Brand | Home | Products | Pricing | Sign in",
    label: () => null,
    fit: (ctx) => {
      const font = fontOf(ctx.style);
      return { w: Math.max(320, parts(ctx).reduce((sum, item) => sum + measureText(item, font) + 24, 80)), h: 50 };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const [brand = "", ...links] = parts(ctx);
      const pad = Math.min(18, w * 0.05);
      const font = fontOf(style);
      const prims: Prim[] = [body(ctx, boxPath(w, h, style)), cell(ctx, brand, pad, 0, w - pad * 2, h, { font: { bold: true, size: style.fontSize * 1.1 } })];
      // Links are laid out from the right edge and dropped once they would run into the brand.
      const limit = pad + measureText(brand, fontOf(style, { bold: true, size: style.fontSize * 1.1 })) + 16;
      let x = w - pad;
      for (const link of links.reverse()) {
        const width = measureText(link, font);
        x -= width;
        if (x < limit) break;
        prims.push(cell(ctx, link, x, 0, width, h));
        x -= 24;
      }
      return prims;
    },
  }),
  wf({
    id: "tabs",
    name: "Tabs",
    aliases: ["tab-bar", "tabbar", "tab-strip", "segmented-control", "tab-navigation"],
    keywords: ["navigation", "sections"],
    description: "Row of tabs. Labels are separated by `|`; data.active (index, default 0) is underlined.",
    size: { w: 320, h: 40 },
    minSize: { w: 60, h: 20 },
    text: "Overview | Activity | Settings",
    data: { active: 0 },
    label: () => null,
    fit: (ctx) => {
      const font = fontOf(ctx.style, { bold: true });
      return { w: Math.max(120, parts(ctx).reduce((sum, item) => sum + measureText(item, font) + 28, 0)), h: 40 };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const labels = parts(ctx);
      const active = index(ctx, "active", labels.length);
      const prims: Prim[] = [line(ctx, linePath(0, h - 0.5, w, h - 0.5), { stroke: rule(ctx), strokeWidth: 1 })];
      let x = 0;
      labels.forEach((label, i) => {
        const width = measureText(label, fontOf(style, { bold: true })) + 28;
        const on = i === active;
        prims.push(cell(ctx, label, x, 0, width, h - 2, { align: "center", font: { bold: on }, color: on ? style.textColor : dim(ctx) }));
        if (on) prims.push(solid(rectPath(x, h - 2.5, width, 2.5), style.textColor));
        x += width;
      });
      return prims;
    },
  }),
  wf({
    id: "sidebar",
    name: "Sidebar",
    aliases: ["side-nav", "sidenav", "side-menu", "nav-menu", "drawer", "navigation-menu"],
    keywords: ["navigation", "menu", "links"],
    description: "Vertical navigation menu: one item per line; data.active (index, default 0) is highlighted.",
    size: { w: 180, h: 260 },
    minSize: { w: 60, h: 40 },
    text: "Dashboard\nProjects\nTeam\nReports\nSettings",
    data: { active: 0 },
    label: () => null,
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const rows = linesOf(ctx.text);
      const active = index(ctx, "active", rows.length);
      const pad = Math.min(8, w * 0.06, h * 0.06);
      const rowH = Math.min(36, (h - pad * 2) / Math.max(1, rows.length));
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      rows.forEach((row, i) => {
        const y = pad + i * rowH;
        const on = i === active;
        if (on) prims.push(solid(rectPath(pad, y + 1, w - pad * 2, rowH - 2, 6), surface(ctx)));
        prims.push(cell(ctx, row, pad, y, w - pad * 2, rowH, { padding: 12, font: { bold: on }, color: on ? style.textColor : dim(ctx) }));
      });
      return prims;
    },
  }),
  wf({
    id: "list",
    name: "List",
    aliases: ["list-view", "item-list", "menu-list", "rows", "feed"],
    keywords: ["items", "rows", "collection"],
    description: "List of rows separated by rules: one row per line of text.",
    size: { w: 240, h: 120 },
    minSize: { w: 60, h: 30 },
    style: { radius: 6 },
    text: "First item\nSecond item\nThird item",
    label: () => null,
    fit: (ctx) => ({ w: 240, h: Math.max(1, linesOf(ctx.text).length) * 40 }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const rows = linesOf(ctx.text);
      const rowH = h / Math.max(1, rows.length);
      return [
        body(ctx, boxPath(w, h, style)),
        ...rows.slice(1).map((_, i) => line(ctx, linePath(0, (i + 1) * rowH, w, (i + 1) * rowH), { stroke: rule(ctx), strokeWidth: 1 })),
        ...rows.map((row, i) => cell(ctx, row, 0, i * rowH, w, rowH, { padding: 14 })),
      ];
    },
  }),
  wf({
    id: "table",
    name: "Data table",
    aliases: ["data-table", "data-grid", "table-view", "grid-view", "datagrid"],
    keywords: ["rows", "columns", "records"],
    description: "Greyscale data table: one row per line, cells separated by `|`, first row is the header.",
    size: { w: 320, h: 120 },
    minSize: { w: 80, h: 40 },
    style: { radius: 6, fontSize: 12 },
    text: "Name | Status | Updated\nAlpha | Active | Today\nBeta | Paused | Monday\nGamma | Active | Tuesday",
    label: () => null,
    fit: (ctx) => {
      const rows = linesOf(ctx.text).map((row) => row.split("|"));
      const widest = Math.max(60, ...rows.flat().map((item) => measureText(item.trim(), fontOf(ctx.style, { bold: true })) + 28));
      return { w: Math.min(900, widest * Math.max(1, ...rows.map((row) => row.length))), h: Math.max(1, rows.length) * 30 };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const rows = linesOf(ctx.text).map((row) => row.split("|").map((item) => item.trim()));
      const rowH = h / Math.max(1, rows.length);
      const colW = w / Math.max(1, ...rows.map((row) => row.length));
      return [
        ...(rows.length > 1 ? barred(ctx, rowH) : [body(ctx, boxPath(w, h, style))]),
        ...rows.slice(2).map((_, i) => line(ctx, linePath(0, (i + 2) * rowH, w, (i + 2) * rowH), { stroke: rule(ctx), strokeWidth: 1 })),
        ...rows.flatMap((row, r) =>
          row.map((item, c) => cell(ctx, item, c * colW, r * rowH, colW, rowH, { padding: 12, font: { bold: r === 0 && rows.length > 1 } })),
        ),
      ];
    },
  }),
  wf({
    id: "breadcrumb",
    name: "Breadcrumb",
    aliases: ["breadcrumbs", "path-trail", "navigation-trail", "crumbs"],
    keywords: ["navigation", "path", "hierarchy"],
    description: "Breadcrumb trail. Items are separated by `|`; the last one is the current page.",
    size: { w: 240, h: 20 },
    minSize: { w: 40, h: 14 },
    text: "Home | Projects | Website",
    label: () => null,
    fit: (ctx) => {
      const items = parts(ctx);
      return { w: items.reduce((sum, item) => sum + measureText(item, fontOf(ctx.style, { bold: true })), 0) + Math.max(0, items.length - 1) * 20 + 4, h: 20 };
    },
    draw: (ctx) => {
      const { h, style } = ctx;
      const items = parts(ctx);
      const prims: Prim[] = [];
      let x = 0;
      items.forEach((item, i) => {
        const last = i === items.length - 1;
        const width = measureText(item, fontOf(style, { bold: last }));
        prims.push(cell(ctx, item, x, 0, width, h, { font: { bold: last }, color: last ? style.textColor : dim(ctx) }));
        x += width;
        if (!last) prims.push(cell(ctx, "›", x, 0, 20, h, { align: "center", color: dim(ctx) }));
        x += 20;
      });
      return prims;
    },
  }),
  wf({
    id: "pagination",
    name: "Pagination",
    aliases: ["pager", "page-numbers", "paging", "page-navigation"],
    keywords: ["navigation", "pages", "next", "previous"],
    description: "Previous / page numbers / next. data.pages sets the page count, data.current (1-based) the active page.",
    size: { w: 240, h: 30 },
    minSize: { w: 60, h: 14 },
    style: { radius: 5, fontSize: 12 },
    data: { pages: 5, current: 1 },
    label: () => null,
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const pages = clamp(Math.round(param(ctx, "pages", 5)), 1, 12);
      const current = clamp(Math.round(param(ctx, "current", 1)), 1, pages);
      const n = pages + 2;
      const gap = Math.min(6, w * 0.02);
      const size = Math.min(h, (w - gap * (n - 1)) / n);
      const left = (w - size * n - gap * (n - 1)) / 2;
      const top = (h - size) / 2;
      const prims: Prim[] = [];
      for (let i = 0; i < n; i++) {
        const x = left + i * (size + gap);
        const on = i === current;
        prims.push(body(ctx, rectPath(x, top, size, size, Math.min(style.radius, size / 2)), on ? { fill: style.stroke } : {}));
        if (i === 0 || i === n - 1) prims.push(chevron(ctx, x + size / 2, h / 2, size * 0.16, i === 0 ? "left" : "right"));
        else prims.push(cell(ctx, String(i), x, top, size, size, { align: "center", color: on ? paper(ctx) : style.textColor, font: { bold: on, size: Math.min(style.fontSize, size * 0.5) } }));
      }
      return prims;
    },
  }),
  wf({
    id: "tooltip",
    name: "Tooltip",
    aliases: ["popover", "hint", "hover-card", "tip", "coach-mark"],
    keywords: ["help", "hover", "annotation"],
    description: "Dark tooltip with a small arrow pointing down at its target.",
    size: { w: 140, h: 40 },
    minSize: { w: 30, h: 20 },
    style: { fill: TEXT, stroke: TEXT, textColor: "#ffffff", radius: 6, fontSize: 12 },
    text: "Helpful hint",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h - Math.min(6, ctx.h * 0.2, ctx.w * 0.2) }, padding: 10 }),
    fit: (ctx) => {
      const size = measureBlock(ctx.text, fontOf(ctx.style), 220);
      return { w: Math.max(60, size.w + 24), h: size.h + 16 + 6 };
    },
    outline: (w, h, style) => tooltipPath(w, h, style.radius),
    draw: (ctx) => [body(ctx, tooltipPath(ctx.w, ctx.h, ctx.style.radius))],
  }),
];

export const wireframeLibrary: ShapeLibrary = {
  id: "wireframe",
  name: "Wireframe",
  description:
    "Low-fidelity greyscale UI mock-up kit: browser / phone / tablet / modal containers, form controls, navigation, lists and tables, and image / video / chart / map placeholders.",
  shapes: [...frames, ...controls, ...content, ...navigation],
};
