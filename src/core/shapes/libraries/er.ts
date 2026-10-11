import { compartmentBox, compartmentFit, type CompartmentOptions } from "../compartments";
import {
  boxPath,
  ellipsePath,
  line,
  ovalPath,
  param,
  polyPath,
  rectPath,
  shade,
  simpleShape,
  solid,
  type Path,
  type Prim,
  type ShapeCtx,
  type ShapeDef,
  type ShapeLibrary,
} from "../kit";

type FitCtx = Omit<ShapeCtx, "w" | "h">;

const KAPPA = 0.5522847498;

/** Gap between the two borders of the "double" Chen symbols. */
const doubleGap = (w: number, h: number) => Math.min(5, w * 0.1, h * 0.1);

const diamond = (w: number, h: number, x = 0, y = 0): Path => polyPath([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);

/** Rectangle rounded on its top corners only: the header band of a rounded box. */
function topRoundedRect(w: number, h: number, radius: number): Path {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const k = r * (1 - KAPPA);
  return [["M", 0, h], ["L", 0, r], ["C", 0, k, k, 0, r, 0], ["L", w - r, 0], ["C", w - k, 0, w, k, w, r], ["L", w, h], ["Z"]];
}

/* ----------------------------------------------------------------- tables */

const STEREOTYPE = /^\s*(?:«\s*(.+?)\s*»|<<\s*(.+?)\s*>>)\s*$/;

/** Compartment options and sections of a table, with a leading `«stereotype»` line lifted out of the header. */
function tableModel(ctx: FitCtx): { sections: string[]; options: CompartmentOptions } {
  const [first = "", ...rest] = (ctx.sections[0] ?? "").split("\n");
  const match = STEREOTYPE.exec(first);
  const named = param(ctx, "stereotype", "");
  return {
    sections: [match ? rest.join("\n") : (ctx.sections[0] ?? ""), ...ctx.sections.slice(1)],
    options: {
      stereotype: match ? `«${match[1] ?? match[2]}»` : named ? `«${named}»` : undefined,
      bodyFont: { family: "mono", size: ctx.style.fontSize * 0.86 },
      minSections: 1,
      headerFill: "none",
    },
  };
}

/** Database table: bold name in a header band, then one compartment of columns per `---` section. */
function tableShape(def: Omit<ShapeDef, "draw" | "fit" | "label">): ShapeDef {
  return {
    minSize: { w: 80, h: 50 },
    ...def,
    label: () => null,
    fit: (ctx) => {
      const { sections, options } = tableModel(ctx);
      return compartmentFit({ style: ctx.style, sections }, options, { w: def.size.w, h: 0 });
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const { sections, options } = tableModel(ctx);
      const headerH = compartmentFit({ style, sections: sections.slice(0, 1) }, { ...options, minSections: 0 }, { w: 0, h: 0 }).h;
      const outline = rectPath(0, 0, w, h, style.radius);
      // compartmentBox squares off its header band, so paint a rounded one under its lines and text.
      const [, ...content] = compartmentBox({ ...ctx, sections }, options);
      return [
        solid(outline, style.fill),
        solid(topRoundedRect(w, Math.min(headerH, h), style.radius), shade(style.fill, 0.06)),
        line(ctx, outline, { dash: style.dash }),
        ...content,
      ];
    },
  };
}

/* ---------------------------------------------------------------- shapes */

const shapes: ShapeDef[] = [
  tableShape({
    id: "er/entity",
    name: "Entity",
    aliases: ["table", "db-table", "sql-table", "er-entity", "er-table"],
    keywords: ["database", "schema", "columns", "crow's foot", "model"],
    description:
      "Database table: name, then `---` and one column per line (`PK id: uuid`). Connect tables with crow's-foot markers. Extra `---` sections add compartments.",
    size: { w: 180, h: 140 },
    style: { radius: 6 },
    text: "users\n---\nPK id: uuid\nFK org_id: uuid\nemail: varchar\nname: varchar\ncreated_at: timestamp",
  }),
  tableShape({
    id: "er/view",
    name: "View",
    aliases: ["db-view", "sql-view", "materialized-view", "er-view"],
    keywords: ["database", "query", "derived", "virtual table"],
    description: "Database view: dashed table with a «view» header, then `---` and one column per line.",
    size: { w: 180, h: 120 },
    style: { radius: 6, dash: "dashed" },
    text: "active_users\n---\nid: uuid\nemail: varchar\nlast_seen: timestamp",
    data: { stereotype: "view" },
  }),
  simpleShape({
    id: "er/strong-entity",
    name: "Entity (Chen)",
    aliases: ["chen-entity", "entity-set", "regular-entity"],
    keywords: ["chen", "conceptual"],
    description: "Chen notation entity: a plain rectangle naming a thing, with attributes drawn as separate ellipses.",
    size: { w: 140, h: 60 },
    text: "Entity",
    path: boxPath,
  }),
  simpleShape({
    id: "er/weak-entity",
    name: "Weak entity",
    aliases: ["weak-entity-set", "chen-weak-entity", "dependent-entity"],
    keywords: ["chen", "double rectangle"],
    description: "Chen notation weak entity (double rectangle): exists only through its owner entity.",
    size: { w: 140, h: 60 },
    text: "Weak entity",
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: ctx.h }, padding: 10 + doubleGap(ctx.w, ctx.h) }),
    path: boxPath,
    extra: (ctx) => {
      const g = doubleGap(ctx.w, ctx.h);
      return [line(ctx, rectPath(g, g, ctx.w - 2 * g, ctx.h - 2 * g, Math.max(0, ctx.style.radius - g)), { dash: ctx.style.dash })];
    },
  }),
  simpleShape({
    id: "er/relationship",
    name: "Relationship",
    aliases: ["er-relationship", "chen-relationship", "relation", "relationship-set"],
    keywords: ["chen", "diamond", "association"],
    description: "Chen notation relationship (diamond) linking entities; name it with a verb.",
    size: { w: 140, h: 80 },
    inset: { x: 0.2, y: 0.2 },
    text: "has",
    path: (w, h) => diamond(w, h),
  }),
  simpleShape({
    id: "er/weak-relationship",
    name: "Weak relationship",
    aliases: ["identifying-relationship", "chen-weak-relationship", "double-diamond"],
    keywords: ["chen", "diamond", "weak entity"],
    description: "Chen notation identifying relationship (double diamond) between a weak entity and its owner.",
    size: { w: 160, h: 90 },
    inset: { x: 0.22, y: 0.22 },
    text: "belongs to",
    path: (w, h) => diamond(w, h),
    extra: (ctx) => {
      const { w, h } = ctx;
      // Inset along each axis so the inner diamond stays parallel at a constant gap.
      const g = doubleGap(w, h);
      const diagonal = Math.hypot(w, h);
      const dx = Math.min((g * diagonal) / h, w * 0.3);
      const dy = Math.min((g * diagonal) / w, h * 0.3);
      return [line(ctx, diamond(w - 2 * dx, h - 2 * dy, dx, dy), { dash: ctx.style.dash })];
    },
  }),
  simpleShape({
    id: "er/attribute",
    name: "Attribute",
    aliases: ["er-attribute", "chen-attribute", "simple-attribute"],
    keywords: ["chen", "property", "field", "ellipse"],
    description: "Chen notation attribute (ellipse) attached to an entity or relationship.",
    size: { w: 120, h: 60 },
    inset: { x: 0.12, y: 0.12 },
    text: "attribute",
    path: ovalPath,
  }),
  simpleShape({
    id: "er/key-attribute",
    name: "Key attribute",
    aliases: ["primary-key-attribute", "pk-attribute", "identifier-attribute", "chen-key"],
    keywords: ["chen", "primary key", "identifier", "underlined"],
    description: "Chen notation key attribute (underlined): uniquely identifies the entity.",
    size: { w: 120, h: 60 },
    inset: { x: 0.12, y: 0.12 },
    style: { underline: true },
    text: "id",
    path: ovalPath,
  }),
  simpleShape({
    id: "er/multivalued-attribute",
    name: "Multivalued attribute",
    aliases: ["multi-valued-attribute", "multivalue-attribute", "chen-multivalued"],
    keywords: ["chen", "double ellipse", "list", "set"],
    description: "Chen notation multivalued attribute (double ellipse): can hold several values, e.g. phone numbers.",
    size: { w: 130, h: 60 },
    inset: { x: 0.16, y: 0.16 },
    text: "phones",
    path: ovalPath,
    extra: (ctx) => {
      const { w, h } = ctx;
      const g = doubleGap(w, h);
      return [line(ctx, ellipsePath(w / 2, h / 2, w / 2 - g, h / 2 - g), { dash: ctx.style.dash })];
    },
  }),
  simpleShape({
    id: "er/derived-attribute",
    name: "Derived attribute",
    aliases: ["computed-attribute", "calculated-attribute", "chen-derived"],
    keywords: ["chen", "dashed ellipse", "computed"],
    description: "Chen notation derived attribute (dashed ellipse): computed from other attributes, e.g. age.",
    size: { w: 120, h: 60 },
    inset: { x: 0.12, y: 0.12 },
    style: { dash: "dashed" },
    text: "age",
    path: ovalPath,
  }),
  simpleShape({
    id: "er/associative-entity",
    name: "Associative entity",
    aliases: ["junction-entity", "bridge-entity", "link-entity", "chen-associative"],
    keywords: ["chen", "many-to-many", "join table", "diamond in rectangle"],
    description: "Chen notation associative entity (diamond in a rectangle): a relationship that has its own attributes.",
    size: { w: 150, h: 80 },
    inset: { x: 0.2, y: 0.2 },
    text: "enrollment",
    path: boxPath,
    extra: (ctx): Prim[] => [line(ctx, diamond(ctx.w, ctx.h))],
  }),
];

export const erLibrary: ShapeLibrary = {
  id: "er",
  name: "Entity relationship",
  description: "Database modelling: tables and views with columns, plus Chen notation entities, attributes and relationships.",
  shapes,
};
