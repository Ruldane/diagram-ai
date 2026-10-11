import { applyMatrix, multiply, type Matrix } from "../geometry/basics";
import { rectPath, transformPath, type Path } from "../geometry/path";
import { hexToRgb } from "../model/palette";
import type { Color } from "../model/types";
import { dashSpec, isPaint, type Scene } from "../render/scene";
import type { PathPrim, TextPrim } from "../shapes/types";
import { allFontVariants, fontVariant } from "../text/fonts";
import { layoutText } from "../text/layout";
import type { ExportPage } from "./pages";

/**
 * Vector PDF writer. Draws the scene straight into PDF operators (paths and
 * real, selectable text with the embedded diagram fonts), so the result stays
 * sharp at any zoom and prints at any size.
 */

export type PdfPageSize = "fit" | "a4" | "a3" | "letter" | "legal" | "tabloid";

export interface PdfOptions {
  /** `fit` sizes each page to its content; the others scale the content to the sheet. */
  pageSize?: PdfPageSize;
  orientation?: "auto" | "portrait" | "landscape";
  /** Sheet margin in points (ignored for `fit`). */
  margin?: number;
  background?: "doc" | "transparent" | Color;
  /** Base64 TTF data keyed by font file name. Missing fonts fall back to the PDF standard fonts. */
  fonts?: Record<string, string>;
  title?: string;
}

/** Sheet sizes in points (portrait). */
const SHEETS: Record<Exclude<PdfPageSize, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
};

/** CSS px → PDF points at 96 dpi. */
const PX_TO_PT = 0.75;
/** Small diagrams are enlarged on a sheet, but never beyond this factor. */
const MAX_ENLARGE = 2;
const STANDARD_FONTS = { sans: "helvetica", serif: "times", mono: "courier", hand: "helvetica" } as const;

type JsPdf = import("jspdf").jsPDF;

function pageGeometry(view: ExportPage["view"], options: PdfOptions) {
  const pageSize = options.pageSize ?? "fit";
  if (pageSize === "fit") {
    const width = view.w * PX_TO_PT;
    const height = view.h * PX_TO_PT;
    return { width, height, scale: PX_TO_PT, offsetX: -view.x * PX_TO_PT, offsetY: -view.y * PX_TO_PT };
  }
  const [short, long] = SHEETS[pageSize];
  const landscape = options.orientation === "landscape" || ((options.orientation ?? "auto") === "auto" && view.w > view.h);
  const width = landscape ? long : short;
  const height = landscape ? short : long;
  const margin = options.margin ?? 36;
  const scale = Math.min((width - margin * 2) / view.w, (height - margin * 2) / view.h, PX_TO_PT * MAX_ENLARGE);
  return {
    width,
    height,
    scale,
    // Centre the content on the sheet.
    offsetX: (width - view.w * scale) / 2 - view.x * scale,
    offsetY: (height - view.h * scale) / 2 - view.y * scale,
  };
}

function tracePath(doc: JsPdf, path: Path) {
  for (const cmd of path) {
    if (cmd[0] === "M") doc.moveTo(cmd[1], cmd[2]);
    else if (cmd[0] === "L") doc.lineTo(cmd[1], cmd[2]);
    else if (cmd[0] === "C") doc.curveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
    else doc.close();
  }
}

export async function renderPdf(pages: ExportPage[], options: PdfOptions = {}): Promise<ArrayBuffer> {
  const { jsPDF, GState } = await import("jspdf");
  if (pages.length === 0) throw new Error("Nothing to export.");

  const first = pageGeometry(pages[0].view, options);
  const doc = new jsPDF({
    unit: "pt",
    format: [first.width, first.height],
    orientation: first.width > first.height ? "landscape" : "portrait",
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.setProperties({ title: options.title ?? pages[0].name, creator: "Diagram AI" });

  // Register the bundled fonts that were supplied.
  const registered = new Set<string>();
  for (const variant of allFontVariants()) {
    const data = options.fonts?.[variant.file];
    if (!data) continue;
    const style = `${variant.weight >= 600 ? "bold" : ""}${variant.italic ? "italic" : ""}` || "normal";
    doc.addFileToVFS(variant.file, data);
    doc.addFont(variant.file, variant.cssFamily, style);
    registered.add(variant.key);
  }

  const setOpacity = (opacity: number) => doc.setGState(new GState({ opacity, "stroke-opacity": opacity }));

  const drawPath = (prim: PathPrim, matrix: Matrix, scale: number, layerOpacity: number) => {
    const fill = isPaint(prim.fill);
    const stroke = isPaint(prim.stroke) && (prim.strokeWidth ?? 1) > 0;
    if (!fill && !stroke) return;
    const opacity = (prim.opacity ?? 1) * layerOpacity;
    if (opacity < 1) {
      doc.saveGraphicsState();
      setOpacity(opacity);
    }
    if (fill) doc.setFillColor(...hexToRgb(prim.fill!));
    if (stroke) {
      const width = prim.strokeWidth ?? 1;
      const dash = dashSpec(prim.dash, width);
      doc.setDrawColor(...hexToRgb(prim.stroke!));
      doc.setLineWidth(width * scale);
      doc.setLineDashPattern(dash ? dash.array.map((v) => v * scale) : [], 0);
      const round = prim.round || dash?.round;
      doc.setLineCap(round ? "round" : "butt");
      doc.setLineJoin(round ? "round" : "miter");
    }
    tracePath(doc, transformPath(prim.d, matrix));
    if (fill && stroke) doc.fillStroke();
    else if (fill) {
      if (prim.evenOdd) doc.fillEvenOdd();
      else doc.fill();
    } else doc.stroke();
    if (opacity < 1) doc.restoreGraphicsState();
  };

  const drawText = (prim: TextPrim, matrix: Matrix, scale: number, layerOpacity: number) => {
    if (prim.background) {
      drawPath({ kind: "path", d: rectPath(prim.box.x, prim.box.y, prim.box.w, prim.box.h, 3), fill: prim.background }, matrix, scale, layerOpacity);
    }
    const layout = layoutText(prim);
    const variant = fontVariant(prim.font);
    if (registered.has(variant.key)) {
      doc.setFont(variant.cssFamily, `${variant.weight >= 600 ? "bold" : ""}${variant.italic ? "italic" : ""}` || "normal");
    } else {
      doc.setFont(STANDARD_FONTS[prim.font.family] ?? "helvetica", `${prim.font.bold ? "bold" : ""}${prim.font.italic ? "italic" : ""}` || "normal");
    }
    doc.setFontSize(prim.font.size * scale);
    doc.setTextColor(...hexToRgb(prim.color));
    // Rotation of the layer, recovered from its matrix (PDF angles are counter-clockwise).
    const angle = (-Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
    if (layerOpacity < 1) {
      doc.saveGraphicsState();
      setOpacity(layerOpacity);
    }
    for (const line of layout.lines) {
      if (!line.text.trim()) continue;
      const left = layout.anchor === "start" ? line.x : layout.anchor === "end" ? line.x - line.width : line.x - line.width / 2;
      const at = applyMatrix(matrix, { x: left, y: line.y });
      doc.text(line.text, at.x, at.y, { baseline: "alphabetic", angle: Math.abs(angle) < 0.01 ? 0 : angle });
      if (prim.underline) {
        const y = line.y + prim.font.size * 0.14;
        drawPath(
          { kind: "path", d: [["M", left, y], ["L", left + line.width, y]], stroke: prim.color, strokeWidth: Math.max(1, prim.font.size / 14) },
          matrix,
          scale,
          1,
        );
      }
    }
    if (layerOpacity < 1) doc.restoreGraphicsState();
  };

  const drawScene = (scene: Scene, view: ExportPage["view"], geometry: ReturnType<typeof pageGeometry>) => {
    const background = options.background === undefined || options.background === "doc" ? scene.background : options.background;
    if (background !== "transparent" && isPaint(background)) {
      doc.setFillColor(...hexToRgb(background));
      if ((options.pageSize ?? "fit") === "fit") doc.rect(0, 0, geometry.width, geometry.height, "F");
      else doc.rect(geometry.offsetX + view.x * geometry.scale, geometry.offsetY + view.y * geometry.scale, view.w * geometry.scale, view.h * geometry.scale, "F");
    }
    const world: Matrix = [geometry.scale, 0, 0, geometry.scale, geometry.offsetX, geometry.offsetY];
    for (const layer of scene.layers) {
      const matrix = layer.matrix ? multiply(world, layer.matrix) : world;
      for (const prim of layer.prims) {
        if (prim.kind === "path") drawPath(prim, matrix, geometry.scale, layer.opacity);
        else drawText(prim, matrix, geometry.scale, layer.opacity);
      }
    }
  };

  pages.forEach((page, index) => {
    const geometry = index === 0 ? first : pageGeometry(page.view, options);
    if (index > 0) doc.addPage([geometry.width, geometry.height], geometry.width > geometry.height ? "landscape" : "portrait");
    drawScene(page.scene, page.view, geometry);
  });

  return doc.output("arraybuffer");
}
