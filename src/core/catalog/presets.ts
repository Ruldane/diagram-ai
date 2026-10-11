import type { LayoutDirection, LayoutOptions, NodeStyle } from "../model/types";
import type { NodeSpec } from "../spec/apply";

/**
 * Shared building blocks for the catalog entries in `types/`: layout presets
 * and a few helpers for the hand-placed (positional) templates.
 */

/* ----------------------------------------------------------------- layouts */

/** Ranked layout for flows, architectures and anything with containers. */
export const layered = (direction: LayoutDirection = "down", spacing = 48, rankSpacing = 72): LayoutOptions => ({
  algorithm: "layered",
  direction,
  spacing,
  rankSpacing,
});

/** Strict hierarchy: org charts, breakdown structures, decision trees. Does not lay out containers. */
export const tree = (direction: LayoutDirection = "down", spacing = 36, rankSpacing = 28): LayoutOptions => ({
  algorithm: "tree",
  direction,
  spacing,
  rankSpacing,
});

/** Undirected networks without a reading direction. `edgeLength` is the desired link length. */
export const force = (edgeLength = 160, spacing = 48): LayoutOptions => ({
  algorithm: "force",
  direction: "down",
  spacing,
  rankSpacing: edgeLength / 2,
});

/** A centre with rings around it. `radius` is the distance between rings. */
export const radial = (radius = 180, spacing = 32): LayoutOptions => ({
  algorithm: "radial",
  direction: "right",
  spacing,
  rankSpacing: radius / 2,
});

/**
 * Layout stored on positional types (matrices, boards, wireframes…). Their
 * templates use explicit coordinates; this only applies if the user later
 * asks for an automatic layout.
 */
export const FREEFORM: LayoutOptions = layered("down");

/* ------------------------------------------------------------------ styles */

/** Body copy inside cells and panels: small, top-left aligned. */
export const CELL_TEXT: NodeStyle = { fontSize: 12, align: "left", valign: "top" };

/** Quiet secondary text (axis captions, row headers). */
export const MUTED_TEXT: NodeStyle = { fontSize: 12, textColor: "#5c6670" };

/** Thin grey outline for grids and cells that should not compete with the content. */
export const HAIRLINE: NodeStyle = { stroke: "#c9ccd1", strokeWidth: 1 };

/* ----------------------------------------------------------------- helpers */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `• ` bullet list, one bullet per argument. */
export const bullets = (...lines: string[]): string => lines.map((line) => `• ${line}`).join("\n");

/** Borderless text placed at an explicit position. */
export const label = (id: string, text: string, box: Box, style?: NodeStyle): NodeSpec => ({
  id,
  shape: "basic/text",
  text,
  ...box,
  ...(style ? { style } : {}),
});

/**
 * Titled panel with body copy: a coloured header column holding one text
 * block. Used for canvases and framework grids (business model canvas, PESTLE…).
 * Pass `parent` when the panel itself sits inside another container.
 */
export function panel(id: string, title: string, body: string, box: Box, color?: string, parent?: string): NodeSpec[] {
  return [
    { id, shape: "strategy/kanban-column", text: title, ...box, ...(color ? { color } : {}), ...(parent ? { parent } : {}) },
    {
      id: `${id}-body`,
      shape: "basic/text",
      text: body,
      parent: id,
      x: box.x + 10,
      y: box.y + 48,
      w: box.w - 20,
      h: box.h - 58,
      style: { ...CELL_TEXT, fontSize: 13 },
    },
  ];
}
