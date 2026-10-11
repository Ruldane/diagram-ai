/**
 * Icon-based shape builders. Infrastructure, cloud, AI and business libraries
 * are mostly presets of these four layouts with a different icon and colour.
 *
 * The icon is read from `node.data.icon` (any name from `ICON_NAMES`), so users
 * and agents can swap it without changing the shape.
 */
import { PALETTE, type PaletteName } from "../model/palette";
import type { NodeStyle } from "../model/types";
import { stackHeight, stackText, stackWidth, type StackItem } from "./compartments";
import { body, ellipsePath, icon, param, rectPath, solid, tint } from "./kit";
import type { ShapeCtx, ShapeDef } from "./types";

export interface IconPreset {
  id: string;
  name: string;
  /** Default icon name. */
  icon: string;
  /** Palette colour for the default style. */
  color?: PaletteName;
  aliases?: string[];
  keywords?: string[];
  description?: string;
  /** Default label; defaults to `name`. */
  text?: string;
}

function presetStyle(color: PaletteName | undefined, extra: NodeStyle = {}): NodeStyle {
  if (!color) return extra;
  const swatch = PALETTE[color];
  return { fill: swatch.fill, stroke: swatch.stroke, textColor: swatch.text, ...extra };
}

function meta(preset: IconPreset): Pick<ShapeDef, "id" | "name" | "aliases" | "keywords" | "description" | "text" | "data"> {
  return {
    id: preset.id,
    name: preset.name,
    aliases: preset.aliases,
    keywords: preset.keywords,
    description: preset.description,
    text: preset.text ?? preset.name,
    data: { icon: preset.icon },
  };
}

const iconName = (ctx: Pick<ShapeCtx, "data">): string => param(ctx, "icon", "box");

/** Title = first line, subtitle = remaining lines. */
function titleAndSubtitle(ctx: Pick<ShapeCtx, "text" | "style">): StackItem[] {
  const [title = "", ...rest] = ctx.text.split("\n");
  return [
    { text: title, font: { bold: true } },
    { text: rest.join("\n"), font: { size: ctx.style.fontSize * 0.85, bold: false }, gap: 1 },
  ];
}

/** Bare icon with the label underneath. */
export function iconShape(preset: IconPreset): ShapeDef {
  return {
    ...meta(preset),
    size: { w: 56, h: 56 },
    minSize: { w: 24, h: 24 },
    keepAspect: true,
    style: { fill: "none", stroke: preset.color ? PALETTE[preset.color].stroke : undefined, fontSize: 13 },
    label: (ctx) => ({ box: { x: -50, y: ctx.h + 4, w: ctx.w + 100, h: 40 }, valign: "top", padding: 0 }),
    outline: (w, h) => rectPath(0, 0, w, h, 6),
    draw: (ctx) => icon(ctx, iconName(ctx), 0, 0, Math.min(ctx.w, ctx.h)),
  };
}

/** Circle with an icon inside and the label underneath. */
export function iconBadge(preset: IconPreset): ShapeDef {
  return {
    ...meta(preset),
    size: { w: 64, h: 64 },
    minSize: { w: 32, h: 32 },
    keepAspect: true,
    style: presetStyle(preset.color ?? "default", { fontSize: 13 }),
    label: (ctx) => ({ box: { x: -50, y: ctx.h + 4, w: ctx.w + 100, h: 40 }, valign: "top", padding: 0 }),
    outline: (w, h) => ellipsePath(w / 2, h / 2, w / 2, h / 2),
    draw: (ctx) => {
      const size = Math.min(ctx.w, ctx.h) * 0.5;
      return [
        body(ctx, ellipsePath(ctx.w / 2, ctx.h / 2, ctx.w / 2, ctx.h / 2)),
        ...icon(ctx, iconName(ctx), (ctx.w - size) / 2, (ctx.h - size) / 2, size),
      ];
    },
  };
}

const TILE_ICON = 30;

/** Card with the icon on top and the label below it, inside the box. */
export function iconTile(preset: IconPreset): ShapeDef {
  return {
    ...meta(preset),
    size: { w: 120, h: 96 },
    minSize: { w: 64, h: 64 },
    style: presetStyle(preset.color ?? "default", { radius: 10, fontSize: 13 }),
    label: () => null,
    fit: (ctx) => {
      const items = titleAndSubtitle(ctx);
      const width = Math.max(120, Math.min(200, stackWidth(ctx, items, 180) + 24));
      return { w: width, h: Math.max(96, TILE_ICON + 30 + stackHeight(ctx, items, width - 20)) };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const items = titleAndSubtitle(ctx);
      const textH = stackHeight(ctx, items, w - 20);
      const groupH = TILE_ICON + 8 + textH;
      const top = Math.max(8, (h - groupH) / 2);
      return [
        body(ctx, rectPath(0, 0, w, h, style.radius)),
        ...icon(ctx, iconName(ctx), (w - TILE_ICON) / 2, top, TILE_ICON),
        ...stackText(ctx, { x: 0, y: top + TILE_ICON - 2, w, h: textH + 20 }, items, { align: "center", valign: "top", padding: 10 }),
      ];
    },
  };
}

const CARD_ICON = 22;
const CARD_CHIP = 38;

/** Horizontal card: tinted icon chip on the left, title and subtitle on the right. */
export function iconCard(preset: IconPreset): ShapeDef {
  return {
    ...meta(preset),
    size: { w: 190, h: 60 },
    minSize: { w: 100, h: 48 },
    style: presetStyle(preset.color ?? "default", { radius: 10, align: "left" }),
    label: () => null,
    fit: (ctx) => {
      const items = titleAndSubtitle(ctx);
      const textW = Math.min(240, stackWidth(ctx, items, 240));
      return { w: Math.max(190, CARD_CHIP + 34 + textW), h: Math.max(60, stackHeight(ctx, items, textW + 2) + 24) };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const chip = Math.min(CARD_CHIP, h - 16);
      const iconSize = Math.min(CARD_ICON, chip - 12);
      const chipFill = style.fill === "none" ? "none" : style.fill === "#ffffff" ? "#f1f3f5" : tint(style.stroke, 0.78);
      const cx = 11;
      const cy = (h - chip) / 2;
      return [
        body(ctx, rectPath(0, 0, w, h, style.radius)),
        solid(rectPath(cx, cy, chip, chip, 8), chipFill),
        ...icon(ctx, iconName(ctx), cx + (chip - iconSize) / 2, cy + (chip - iconSize) / 2, iconSize),
        ...stackText(ctx, { x: cx + chip + 2, y: 0, w: w - cx - chip - 6, h }, titleAndSubtitle(ctx), { align: "left", padding: 8 }),
      ];
    },
  };
}
