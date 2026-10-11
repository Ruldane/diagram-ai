import { applyMatrix, multiply, type Matrix } from "../geometry/basics";
import { pathBounds, transformPath, type Path } from "../geometry/path";
import type { Color } from "../model/types";
import { isPaint } from "../render/scene";
import type { PathPrim, TextPrim } from "../shapes/types";
import { FONT_FAMILIES } from "../text/fonts";
import { layoutText } from "../text/layout";
import type { ExportPage } from "./pages";

/**
 * PowerPoint writer.
 *
 * `editable` turns every primitive into a native PowerPoint shape (custom
 * geometry) or text box, so the slide can be restyled and re-arranged in
 * PowerPoint, Keynote or Google Slides. `image` places one high-resolution
 * picture per slide for a pixel-exact result.
 */

export type SlideLayout = "16:9" | "4:3";

export interface PptxOptions {
  layout?: SlideLayout;
  mode?: "editable" | "image";
  background?: "doc" | "transparent" | Color;
  title?: string;
  /** PNG data URLs, one per page, required for `image` mode. */
  images?: string[];
}

/** Slide sizes in inches. */
const SLIDES: Record<SlideLayout, { w: number; h: number }> = {
  "16:9": { w: 13.333, h: 7.5 },
  "4:3": { w: 10, h: 7.5 },
};
const MARGIN_IN = 0.35;
/** At most this many inches per CSS px, so small diagrams are not blown up. */
const MAX_SCALE = 1 / 60;
const MIN_EXTENT_IN = 0.005;

const hex = (color: Color): string => color.replace("#", "").toUpperCase();
const transparency = (opacity: number): number => Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100);

type Slide = import("pptxgenjs").default.Slide;
/** The typings omit the custom-geometry shape name that the library supports at runtime. */
const CUSTOM_GEOMETRY = "custGeom" as unknown as Parameters<Slide["addShape"]>[0];

function addPath(slide: Slide, prim: PathPrim, matrix: Matrix, scale: number, layerOpacity: number) {
  const fill = isPaint(prim.fill);
  const stroke = isPaint(prim.stroke) && (prim.strokeWidth ?? 1) > 0;
  if (!fill && !stroke) return;
  const path: Path = transformPath(prim.d, matrix);
  const bounds = pathBounds(path);
  if (!bounds) return;
  const opacity = (prim.opacity ?? 1) * layerOpacity;

  // Custom geometry points are relative to the shape's own box.
  const points = path.map((cmd) => {
    if (cmd[0] === "Z") return { close: true as const };
    const end = cmd[0] === "C" ? { x: cmd[5] - bounds.x, y: cmd[6] - bounds.y } : { x: cmd[1] - bounds.x, y: cmd[2] - bounds.y };
    if (cmd[0] === "M") return { ...end, moveTo: true };
    if (cmd[0] === "L") return end;
    return {
      ...end,
      curve: { type: "cubic" as const, x1: cmd[1] - bounds.x, y1: cmd[2] - bounds.y, x2: cmd[3] - bounds.x, y2: cmd[4] - bounds.y },
    };
  });

  slide.addShape(CUSTOM_GEOMETRY, {
    x: bounds.x,
    y: bounds.y,
    w: Math.max(bounds.w, MIN_EXTENT_IN),
    h: Math.max(bounds.h, MIN_EXTENT_IN),
    points,
    fill: fill ? { color: hex(prim.fill!), transparency: transparency(opacity) } : { type: "none" },
    line: stroke
      ? {
          color: hex(prim.stroke!),
          width: Math.max(0.25, (prim.strokeWidth ?? 1) * scale * 72),
          dashType: prim.dash === "dashed" ? "dash" : prim.dash === "dotted" ? "sysDot" : "solid",
          transparency: transparency(opacity),
        }
      : { type: "none" },
  });
}

function addText(slide: Slide, prim: TextPrim, matrix: Matrix, scale: number, layerOpacity: number) {
  if (prim.background) {
    const { x, y, w, h } = prim.box;
    addPath(slide, { kind: "path", d: [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]], fill: prim.background }, matrix, scale, layerOpacity);
  }
  const layout = layoutText(prim);
  const lines = layout.lines.map((line) => line.text);
  if (!lines.some((line) => line.trim())) return;

  // Keep our own line breaks: PowerPoint may substitute the font, and must not re-wrap.
  const centre = applyMatrix(matrix, { x: prim.box.x + prim.box.w / 2, y: prim.box.y + prim.box.h / 2 });
  const w = prim.box.w * scale;
  const h = prim.box.h * scale;
  const rotation = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
  const padding = (prim.padding ?? 0) * scale * 72;

  slide.addText(lines.join("\n"), {
    x: centre.x - w / 2,
    y: centre.y - h / 2,
    w,
    h,
    fontFace: FONT_FAMILIES[prim.font.family]?.office ?? "Arial",
    fontSize: Math.max(1, Math.round(prim.font.size * scale * 72 * 10) / 10),
    color: hex(prim.color),
    bold: Boolean(prim.font.bold),
    italic: Boolean(prim.font.italic),
    underline: prim.underline ? { style: "sng" } : undefined,
    align: prim.align ?? "center",
    valign: prim.valign === "top" ? "top" : prim.valign === "bottom" ? "bottom" : "middle",
    margin: [padding, padding, padding, padding],
    wrap: false,
    fit: "none",
    rotate: Math.abs(rotation) < 0.01 ? 0 : Math.round(rotation * 100) / 100,
    transparency: transparency(layerOpacity),
    lineSpacingMultiple: 1.08,
  });
}

export async function renderPptx(pages: ExportPage[], options: PptxOptions = {}): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  if (pages.length === 0) throw new Error("Nothing to export.");

  const size = SLIDES[options.layout ?? "16:9"];
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "DIAGRAM", width: size.w, height: size.h });
  pptx.layout = "DIAGRAM";
  pptx.title = options.title ?? pages[0].name;
  pptx.company = "Diagram AI";

  pages.forEach((page, index) => {
    const slide = pptx.addSlide();
    const background = options.background === undefined || options.background === "doc" ? page.scene.background : options.background;
    if (background !== "transparent" && isPaint(background)) slide.background = { color: hex(background) };

    const { view } = page;
    const scale = Math.min((size.w - MARGIN_IN * 2) / view.w, (size.h - MARGIN_IN * 2) / view.h, MAX_SCALE);
    const offsetX = (size.w - view.w * scale) / 2 - view.x * scale;
    const offsetY = (size.h - view.h * scale) / 2 - view.y * scale;

    if (options.mode === "image") {
      const data = options.images?.[index];
      if (!data) throw new Error("Image mode needs one rendered PNG per page.");
      slide.addImage({ data, x: offsetX + view.x * scale, y: offsetY + view.y * scale, w: view.w * scale, h: view.h * scale });
    } else {
      const world: Matrix = [scale, 0, 0, scale, offsetX, offsetY];
      for (const layer of page.scene.layers) {
        const matrix = layer.matrix ? multiply(world, layer.matrix) : world;
        for (const prim of layer.prims) {
          if (prim.kind === "path") addPath(slide, prim, matrix, scale, layer.opacity);
          else addText(slide, prim, matrix, scale, layer.opacity);
        }
      }
    }
    if (pages.length > 1) slide.addNotes(page.name);
  });

  return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
