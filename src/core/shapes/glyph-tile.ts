/**
 * The tile shared by brand logos and imported icon packs: artwork on top, the
 * label underneath, inside a card. Same proportions as the `infra` tiles, so
 * mixed diagrams look regular.
 */
import { INK } from "../model/palette";
import type { NodeStyle, Rect } from "../model/types";
import { stackHeight, stackText, stackWidth, type StackItem } from "./compartments";
import { body, rectPath } from "./kit";
import type { PathPrim, ShapeCtx, ShapeDef } from "./types";

export interface GlyphTileSpec {
  id: string;
  name: string;
  aliases?: string[];
  keywords?: string[];
  description?: string;
  /** Default label. */
  text?: string;
  /** Draws the artwork inside `box` (a square the tile reserves for it). */
  art: (ctx: ShapeCtx, box: Rect) => PathPrim[];
  data?: Record<string, unknown>;
}

/** Card style: neutral, so the artwork's own colours carry the identity. */
export const TILE_STYLE: NodeStyle = { fill: "#ffffff", stroke: "#c4cad1", strokeWidth: 1.25, radius: 10, fontSize: 13, textColor: INK };

const DEFAULT_SIZE = { w: 120, h: 96 };
const REFERENCE_GLYPH = 36;

const glyphSize = (w: number, h: number): number => Math.max(20, Math.min(w * 0.3, h * 0.4, 120));

/** Title = first line, subtitle = remaining lines. */
function titleAndSubtitle(ctx: Pick<ShapeCtx, "text" | "style">): StackItem[] {
  const [title = "", ...rest] = ctx.text.split("\n");
  return [
    { text: title, font: { bold: true } },
    { text: rest.join("\n"), font: { size: ctx.style.fontSize * 0.85, bold: false }, gap: 1 },
  ];
}

export function glyphTile(spec: GlyphTileSpec): ShapeDef {
  return {
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases,
    keywords: spec.keywords,
    description: spec.description,
    text: spec.text ?? spec.name,
    data: spec.data,
    size: DEFAULT_SIZE,
    minSize: { w: 64, h: 64 },
    style: TILE_STYLE,
    label: () => null,
    fit: (ctx) => {
      const items = titleAndSubtitle(ctx);
      const width = Math.max(DEFAULT_SIZE.w, Math.min(200, stackWidth(ctx, items, 180) + 24));
      return { w: width, h: Math.max(DEFAULT_SIZE.h, REFERENCE_GLYPH + 30 + stackHeight(ctx, items, width - 20)) };
    },
    draw: (ctx) => {
      const { w, h, style } = ctx;
      const items = titleAndSubtitle(ctx);
      const textH = stackHeight(ctx, items, w - 20);
      const size = glyphSize(w, h);
      const top = Math.max(8, (h - (size + 8 + textH)) / 2);
      return [
        body(ctx, rectPath(0, 0, w, h, style.radius)),
        ...spec.art(ctx, { x: (w - size) / 2, y: top, w: size, h: size }),
        ...stackText(ctx, { x: 0, y: top + size - 2, w, h: textH + 20 }, items, { align: "center", valign: "top", padding: 10 }),
      ];
    },
  };
}
