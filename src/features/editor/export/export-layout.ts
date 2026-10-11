import type { PdfPageSize } from "@/core/export/pdf";
import type { SlideLayout } from "@/core/export/pptx";
import type { Rect, Size } from "@/core/model/types";

import { rasterScale, type ClientExportFormat, type ClientExportOptions } from "./client-export";

/**
 * How an export lands on its page, for the dialog's preview and caption.
 *
 * The sheet sizes and fitting rules below mirror constants that are private to
 * `core/export/pdf.ts` and `core/export/pptx.ts`; keep them in step.
 */

const PDF_SHEETS_PT: Record<Exclude<PdfPageSize, "fit">, [short: number, long: number]> = {
  a4: [595.28, 841.89],
  a3: [841.89, 1190.55],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
};
const PX_TO_PT = 0.75;
const PDF_MAX_ENLARGE = 2;
const SLIDES_IN: Record<SlideLayout, Size> = { "16:9": { w: 13.333, h: 7.5 }, "4:3": { w: 10, h: 7.5 } };
const SLIDE_MARGIN_IN = 0.35;
const SLIDE_MAX_IN_PER_PX = 1 / 60;
const MM_PER_PX = 25.4 / 96;

export const PAGE_SIZE_LABELS: Record<PdfPageSize, string> = {
  fit: "Fit to diagram",
  a4: "A4",
  a3: "A3",
  letter: "Letter",
  legal: "Legal",
  tabloid: "Tabloid",
};

export interface SheetLayout {
  /** Page or slide size; only the proportions matter to the preview. */
  sheet: Size;
  /** Where the diagram sits on the sheet, in the same units. */
  content: Rect;
  landscape: boolean;
}

type SheetOptions = Pick<ClientExportOptions, "pageSize" | "orientation" | "margin" | "slideLayout">;

function centred(sheet: Size, view: Size, scale: number): SheetLayout {
  const w = view.w * scale;
  const h = view.h * scale;
  return { sheet, content: { x: (sheet.w - w) / 2, y: (sheet.h - h) / 2, w, h }, landscape: sheet.w > sheet.h };
}

/**
 * The sheet a page of `view` px is placed on, or null when the output is
 * exactly as large as its content (images, and PDF with "fit to diagram").
 */
export function sheetLayout(format: ClientExportFormat, options: SheetOptions, view: Size): SheetLayout | null {
  if (format === "pdf" && options.pageSize !== "fit") {
    const [short, long] = PDF_SHEETS_PT[options.pageSize];
    const landscape = options.orientation === "landscape" || (options.orientation === "auto" && view.w > view.h);
    const sheet = landscape ? { w: long, h: short } : { w: short, h: long };
    const scale = Math.min((sheet.w - options.margin * 2) / view.w, (sheet.h - options.margin * 2) / view.h, PX_TO_PT * PDF_MAX_ENLARGE);
    return centred(sheet, view, Math.max(scale, 0));
  }
  if (format === "pptx") {
    const sheet = SLIDES_IN[options.slideLayout];
    const scale = Math.min((sheet.w - SLIDE_MARGIN_IN * 2) / view.w, (sheet.h - SLIDE_MARGIN_IN * 2) / view.h, SLIDE_MAX_IN_PER_PX);
    return centred(sheet, view, scale);
  }
  return null;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
const trimmed = (value: number): string => String(Math.round(value * 100) / 100);

/** One-line description of the output: "1840 × 1220 px @2×", "A4 landscape · 1 page"… */
export function exportSummary(
  format: ClientExportFormat,
  options: Pick<ClientExportOptions, "scale"> & SheetOptions,
  page: { width: number; height: number; pages: number },
): string {
  const view = { w: page.width, h: page.height };
  const files = page.pages > 1 ? ` · ${plural(page.pages, "file")}` : "";

  if (format === "png" || format === "jpeg") {
    const scale = rasterScale(view, options.scale);
    const reduced = scale < options.scale ? " (reduced to fit the browser limit)" : "";
    return `${Math.round(view.w * scale)} × ${Math.round(view.h * scale)} px @${trimmed(scale)}×${reduced}${files}`;
  }
  if (format === "svg") return `${Math.round(view.w)} × ${Math.round(view.h)} px · vector${files}`;
  if (format === "pdf") {
    const layout = sheetLayout(format, options, view);
    const size = layout
      ? `${PAGE_SIZE_LABELS[options.pageSize]} ${layout.landscape ? "landscape" : "portrait"}`
      : `${Math.round(view.w * MM_PER_PX)} × ${Math.round(view.h * MM_PER_PX)} mm`;
    return `${size} · ${plural(page.pages, "page")}`;
  }
  if (format === "pptx") return `${options.slideLayout} · ${plural(page.pages, "slide")}`;
  return "Whole diagram · text file";
}
