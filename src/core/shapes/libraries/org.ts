import { stackHeight, stackText, stackWidth, type StackItem } from "../compartments";
import { iconCard } from "../icon-shapes";
import {
  body,
  boxPath,
  ellipsePath,
  icon,
  line,
  linePath,
  mix,
  PAPER,
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

type Meta = Pick<ShapeDef, "id" | "name" | "aliases" | "keywords" | "description" | "text">;

const KAPPA = 0.5522847498;

/** Secondary text colour: the text colour faded towards the fill. */
const muted = (ctx: Pick<ShapeCtx, "style">): string => mix(ctx.style.textColor, ctx.style.fill === "none" ? PAPER : ctx.style.fill, 0.35);

/** Rectangle with only its top corners rounded. */
function topBar(w: number, h: number, radius: number): Path {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const k = r * KAPPA;
  return [["M", 0, h], ["L", 0, r], ["C", 0, r - k, r - k, 0, r, 0], ["L", w - r, 0], ["C", w - r + k, 0, w, r - k, w, r], ["L", w, h], ["Z"]];
}

/* ------------------------------------------------------------ org cards */

const AVATAR = 44;
const CARD = { w: 220, h: 72 };

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(words[0] ?? "")][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Line 1 = name, line 2 = role, the rest = extra details. */
function cardItems(ctx: Pick<ShapeCtx, "sections" | "style">): StackItem[] {
  const [name = "", role = "", ...rest] = ctx.sections.join("\n").split("\n");
  const size = ctx.style.fontSize;
  const color = muted(ctx);
  return [
    { text: name, font: { bold: true } },
    { text: role, font: { size: size * 0.88, bold: false }, color, gap: 1 },
    { text: rest.join("\n").trim(), font: { size: size * 0.8, bold: false }, color, gap: 3 },
  ];
}

function personCard(meta: Meta, vacant: boolean): ShapeDef {
  return {
    ...meta,
    size: CARD,
    minSize: { w: 110, h: 48 },
    style: vacant
      ? { fill: "#fafafa", stroke: "#8a929b", dash: "dashed", radius: 10, textColor: "#5c6670" }
      : { fill: "#ffffff", stroke: "#2f6fed", radius: 10 },
    label: () => null,
    fit: (ctx) => {
      const items = cardItems(ctx);
      const textW = Math.min(220, stackWidth(ctx, items, 220));
      return { w: Math.max(CARD.w, AVATAR + 44 + textW), h: Math.max(CARD.h, stackHeight(ctx, items, textW + 2) + 24) };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const d = Math.max(8, Math.min(AVATAR, h - 20, w * 0.4));
      const x = Math.min(12, h * 0.2);
      const y = (h - d) / 2;
      const circle = ellipsePath(x + d / 2, h / 2, d / 2, d / 2);
      const letters = vacant ? "" : initials(ctx.text.split("\n")[0]);
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      if (vacant) prims.push(line(ctx, circle, { strokeWidth: 1.25, dash: "dashed" }));
      else if (style.fill === "none") prims.push(line(ctx, circle, { strokeWidth: 1.25 }));
      else prims.push(solid(circle, tint(style.stroke, 0.82)));
      if (letters) {
        prims.push(text(ctx, letters, { x, y, w: d, h: d }, { font: { size: d * 0.36, bold: true }, color: style.stroke, align: "center", valign: "middle", wrap: false }));
      } else {
        const size = d * 0.5;
        prims.push(...icon(ctx, vacant ? "plus" : "user", x + (d - size) / 2, y + (d - size) / 2, size));
      }
      prims.push(...stackText(ctx, { x: x + d + 2, y: 0, w: w - x - d - 6, h }, cardItems(ctx), { align: "left", padding: 10 }));
      return prims;
    },
  };
}

const TEAM_HEADER = 36;

/* ---------------------------------------------------------------- shapes */

const shapes: ShapeDef[] = [
  simpleShape({
    id: "org/mind-root",
    name: "Mind map root",
    aliases: ["mindmap-root", "central-topic", "central-idea", "mind-map-center"],
    keywords: ["mind map", "main idea", "brainstorm"],
    description: "The central idea of a mind map. Use one per map and branch topics from it.",
    size: { w: 190, h: 64 },
    inset: { x: 0.08, y: 0 },
    style: { fill: "#2b4acb", stroke: "#1f3796", textColor: "#ffffff", bold: true, fontSize: 16 },
    text: "Central idea",
    path: (w, h) => rectPath(0, 0, w, h, h / 2),
  }),
  simpleShape({
    id: "org/mind-topic",
    name: "Mind map topic",
    aliases: ["mindmap-topic", "main-topic", "mind-map-branch", "topic"],
    keywords: ["mind map", "branch", "idea"],
    description: "A main branch of a mind map, connected to the root.",
    size: { w: 150, h: 46 },
    style: { fill: "#e5efff", stroke: "#2f6fed", textColor: "#123a8f", radius: 12 },
    text: "Topic",
    path: boxPath,
  }),
  {
    id: "org/mind-subtopic",
    name: "Mind map subtopic",
    aliases: ["mindmap-subtopic", "subtopic", "mind-map-leaf", "underlined-text"],
    keywords: ["mind map", "leaf", "detail"],
    description: "A leaf of a mind map: text sitting on an underline, no box.",
    size: { w: 120, h: 32 },
    minSize: { w: 30, h: 20 },
    style: { fill: "none", stroke: "#2f6fed", strokeWidth: 2, fontSize: 13, valign: "bottom" },
    text: "Subtopic",
    label: () => ({ padding: 6 }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const y = h - style.strokeWidth / 2;
      return [...(style.fill === "none" ? [] : [solid(rectPath(0, 0, w, h), style.fill)]), line(ctx, linePath(0, y, w, y), { dash: style.dash, round: true })];
    },
  },
  {
    id: "org/mind-note",
    name: "Mind map note",
    aliases: ["mindmap-note", "topic-note", "mind-map-comment"],
    keywords: ["mind map", "remark", "callout", "aside"],
    description: "A small pale callout for a remark attached to a mind map topic.",
    size: { w: 150, h: 60 },
    minSize: { w: 50, h: 30 },
    style: { fill: "#fff8db", stroke: "#d9a600", strokeWidth: 1, radius: 8, fontSize: 12, textColor: "#5c4700", align: "left" },
    text: "A short remark about this topic",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h - Math.min(9, ctx.h * 0.2) }, padding: 8 }),
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const tail = Math.min(9, h * 0.2);
      const base = h - tail;
      const x = Math.min(18, w * 0.2);
      // The fill patch hides the bubble's edge where the tail joins it.
      return [
        body(ctx, rectPath(0, 0, w, base, style.radius)),
        solid(polyPath([[x, base - style.strokeWidth], [x, h], [x + tail * 1.4, base - style.strokeWidth]]), style.fill),
        line(ctx, polyPath([[x, base], [x, h], [x + tail * 1.4, base]], false)),
      ];
    },
  },

  personCard(
    {
      id: "org/person",
      name: "Person card",
      aliases: ["org-person", "employee", "org-chart-card", "staff-member", "org-node"],
      keywords: ["org chart", "people", "manager", "avatar"],
      description: "Org chart card with an avatar. Text: name, then role, then an optional detail line.",
      text: "Ada Lovelace\nHead of Engineering\nLondon",
    },
    false,
  ),
  {
    ...iconCard({
      id: "org/role",
      name: "Role",
      icon: "briefcase",
      color: "gray",
      aliases: ["org-role", "position", "job-title"],
      keywords: ["org chart", "function", "department"],
      description: "Compact org chart card for a position. Text: title, then department.",
      text: "Product Manager\nGrowth",
    }),
    size: { w: 190, h: 56 },
  },
  {
    id: "org/team",
    name: "Team",
    aliases: ["org-team", "department", "org-unit", "squad"],
    keywords: ["org chart", "group", "container", "division"],
    description: "Container for the people and roles of one team or department.",
    size: { w: 320, h: 220 },
    minSize: { w: 140, h: 90 },
    container: { header: TEAM_HEADER, padding: 20 },
    style: { fill: "#f8f9fb", stroke: "#5c6670", strokeWidth: 1.25, radius: 10, align: "left", fontSize: 13, bold: true, textColor: "#343a40" },
    text: "Team",
    label: (ctx) => {
      const x = Math.min(34, ctx.w * 0.3);
      return { box: { x, y: 0, w: ctx.w - x, h: Math.min(TEAM_HEADER, ctx.h) }, padding: 4, valign: "middle", wrap: false };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const header = Math.min(TEAM_HEADER, h);
      const size = Math.min(16, header * 0.5);
      const prims: Prim[] = [body(ctx, boxPath(w, h, style))];
      if (style.fill !== "none") prims.push(solid(topBar(w, header, style.radius), shade(style.fill, 0.07)), line(ctx, boxPath(w, h, style), { dash: style.dash }));
      prims.push(line(ctx, linePath(0, header, w, header), { strokeWidth: Math.min(style.strokeWidth, 1) }));
      prims.push(...icon(ctx, "users", Math.min(12, w * 0.1), (header - size) / 2, size));
      return prims;
    },
  },
  personCard(
    {
      id: "org/vacancy",
      name: "Vacancy",
      aliases: ["open-role", "open-position", "vacant-position", "hiring"],
      keywords: ["org chart", "recruiting", "to be hired", "tbh"],
      description: "Dashed org chart card for a position that is not filled yet.",
      text: "Open role\nSenior Designer",
    },
    true,
  ),
];

export const orgLibrary: ShapeLibrary = {
  id: "org",
  name: "Mind map & org chart",
  description: "Mind map topics (root, topic, subtopic, note) and organisation chart cards (person, role, team, vacancy).",
  shapes,
};
