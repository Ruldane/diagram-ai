import type { Path } from "../geometry/path";
import type { ResolvedNodeStyle } from "../model/defaults";
import type { Color, DashStyle, DNode, HAlign, NodeStyle, Rect, Size, VAlign } from "../model/types";
import type { FontSpec } from "../text/fonts";

/* ------------------------------------------------------------- primitives */

/**
 * Display-list primitives. A shape is just a list of these in the node's local
 * coordinate space (0..w, 0..h). Every renderer (canvas, SVG, PDF, PPTX)
 * consumes the same two primitive kinds.
 */
export interface PathPrim {
  kind: "path";
  d: Path;
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  dash?: DashStyle;
  opacity?: number;
  /** Round caps and joins (icons, hand-drawn strokes). */
  round?: boolean;
  evenOdd?: boolean;
}

export interface TextPrim {
  kind: "text";
  text: string;
  box: Rect;
  font: FontSpec;
  color: Color;
  align?: HAlign;
  valign?: VAlign;
  padding?: number;
  wrap?: boolean;
  underline?: boolean;
  /** Painted behind the text (edge labels sitting on a line). */
  background?: Color;
}

export type Prim = PathPrim | TextPrim;

/* ------------------------------------------------------------------ shapes */

export interface ShapeCtx {
  w: number;
  h: number;
  node: DNode;
  style: ResolvedNodeStyle;
  /** Raw label. */
  text: string;
  /** Label split on lines containing only `---` (compartments, table sections…). */
  sections: string[];
  data: Record<string, unknown>;
}

export interface LabelSpec {
  box?: Rect;
  align?: HAlign;
  valign?: VAlign;
  padding?: number;
  wrap?: boolean;
  font?: Partial<FontSpec>;
  color?: Color;
}

export interface ShapeDef {
  /** `library/name`, e.g. `flowchart/decision`. */
  id: string;
  name: string;
  /** Extra names agents and search can use (`rhombus`, `if`…). */
  aliases?: string[];
  keywords?: string[];
  /** One line telling an agent when to use this shape. */
  description?: string;

  /** Default size when dropped on the canvas. */
  size: Size;
  minSize?: Size;
  keepAspect?: boolean;
  /** Style overrides applied on top of the global defaults. */
  style?: NodeStyle;
  /** Label used when the shape is created from the palette. */
  text?: string;
  /** Default shape parameters. */
  data?: Record<string, unknown>;

  /** Containers hold child nodes (frames, pools, packages…). */
  container?: boolean | { header?: number; padding?: number };

  /**
   * Fraction of the box, per side, that the label must stay clear of
   * (a diamond keeps text away from its corners). Used for label placement
   * and for auto-sizing to content.
   */
  inset?: { x: number; y: number };

  /** Geometry, in local coordinates. */
  draw: (ctx: ShapeCtx) => Prim[];
  /**
   * Placement of the automatic label. Omit for the default (whole box),
   * return `null` when the shape draws its own text.
   */
  label?: (ctx: ShapeCtx) => LabelSpec | null;
  /** Outline used to clip connectors and for hit-testing. Defaults to the box. */
  outline?: (w: number, h: number, style: ResolvedNodeStyle) => Path;
  /** Preferred size for the given content (auto-size). */
  fit?: (ctx: Omit<ShapeCtx, "w" | "h">) => Size;
}

export interface ShapeLibrary {
  id: string;
  name: string;
  description: string;
  shapes: ShapeDef[];
}
