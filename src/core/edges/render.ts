import { resolveEdgeStyle } from "../model/defaults";
import type { Color, DEdge, Point } from "../model/types";
import type { Prim, TextPrim } from "../shapes/types";
import type { FontSpec } from "../text/fonts";
import { measureBlock } from "../text/layout";
import type { EdgeGeometry } from "./geometry";
import { markerPrims } from "./markers";

const LABEL_MAX_WIDTH = 180;
const LABEL_PAD_X = 5;
const LABEL_PAD_Y = 2;

function labelPrim(content: string, at: Point, font: FontSpec, color: Color, background: Color, underline: boolean): TextPrim {
  const size = measureBlock(content, font, LABEL_MAX_WIDTH);
  // Whole pixels, so the renderer never wraps the label narrower than it was measured.
  const w = Math.ceil(size.w) + LABEL_PAD_X * 2;
  const h = Math.ceil(size.h) + LABEL_PAD_Y * 2;
  return {
    kind: "text",
    text: content,
    box: { x: at.x - w / 2, y: at.y - h / 2, w, h },
    font,
    color,
    align: "center",
    valign: "middle",
    padding: LABEL_PAD_X,
    underline,
    background: background === "none" ? "#ffffff" : background,
  };
}

export interface EdgePrims {
  /** The line and its markers. */
  line: Prim[];
  /** Labels, drawn above nodes so they are never hidden. */
  labels: TextPrim[];
}

/** Display list for an edge, in world coordinates. */
export function edgePrims(edge: DEdge, geometry: EdgeGeometry, background: Color): EdgePrims {
  const style = resolveEdgeStyle(edge.style);
  const line: Prim[] = [
    { kind: "path", d: geometry.path, stroke: style.stroke, strokeWidth: style.strokeWidth, dash: style.dash, round: true },
    ...markerPrims(style.startMarker, geometry.start, geometry.startDir, style.stroke, style.strokeWidth, background),
    ...markerPrims(style.endMarker, geometry.end, geometry.endDir, style.stroke, style.strokeWidth, background),
  ];

  const font: FontSpec = { family: style.fontFamily, size: style.fontSize, bold: style.bold, italic: style.italic };
  const small: FontSpec = { ...font, size: Math.max(9, style.fontSize - 1) };
  const labels: TextPrim[] = [];
  if (edge.text?.trim()) labels.push(labelPrim(edge.text, geometry.labelPoint, font, style.textColor, background, style.underline));
  if (edge.startText?.trim()) labels.push(labelPrim(edge.startText, geometry.startLabelPoint, small, style.textColor, background, false));
  if (edge.endText?.trim()) labels.push(labelPrim(edge.endText, geometry.endLabelPoint, small, style.textColor, background, false));
  return { line, labels };
}
