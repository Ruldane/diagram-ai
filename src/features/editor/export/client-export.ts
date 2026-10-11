import { exportPages, safeFileName, type ExportPage, type ExportScope } from "@/core/export/pages";
import type { PdfPageSize } from "@/core/export/pdf";
import type { SlideLayout } from "@/core/export/pptx";
import type { Color, DiagramDoc, Size } from "@/core/model/types";
import { EXPORT_EXTENSION, EXPORT_MIME } from "@/core/protocol";
import { fontFaceCss, renderSvg, usedFonts, type SvgResult } from "@/core/render/svg";
import type { FontVariant } from "@/core/text/fonts";

/**
 * Browser-side export. Everything is rendered locally from the live document,
 * so unsaved changes are included and nothing round-trips through the server.
 * The heavy writers (jsPDF, PptxGenJS, the draw.io / Mermaid serializers) are
 * loaded on demand.
 */

export type ClientExportFormat = "png" | "jpeg" | "svg" | "pdf" | "pptx" | "drawio" | "mermaid" | "json";

export interface ClientExportOptions {
  scope: ExportScope;
  /** `transparent` only applies to SVG and PNG; other formats fall back to the diagram background. */
  background: "doc" | "transparent" | "white";
  /** Raster pixel density: 1 | 2 | 3 | 4. */
  scale: number;
  /** Empty space around the content, in px (frames keep their own bounds). */
  padding: number;
  pageSize: PdfPageSize;
  orientation: "auto" | "portrait" | "landscape";
  /** PDF sheet margin in points. */
  margin: number;
  slideLayout: SlideLayout;
  slideMode: "editable" | "image";
}

export const DEFAULT_EXPORT_OPTIONS: ClientExportOptions = {
  scope: { kind: "all" },
  background: "doc",
  scale: 2,
  padding: 24,
  pageSize: "fit",
  orientation: "auto",
  margin: 36,
  slideLayout: "16:9",
  slideMode: "editable",
};

export interface ExportedFile {
  blob: Blob;
  fileName: string;
  /** Pages / slides inside this file. */
  pages: number;
  /** Pixel density actually used for raster files; lower than requested when the image had to be shrunk. */
  scale?: number;
}

/* ----------------------------------------------------------- pure helpers */

/** Largest canvas the common browsers allocate reliably. */
export const MAX_CANVAS_PIXELS = 64_000_000;
export const MAX_CANVAS_SIDE = 16_384;
/** Pixel density of the pictures placed on "exact image" slides. */
const SLIDE_IMAGE_SCALE = 3;
const JPEG_QUALITY = 0.92;
const WHITE: Color = "#ffffff";

export function exportMime(format: ClientExportFormat): string {
  return format === "jpeg" ? "image/jpeg" : EXPORT_MIME[format];
}

export function exportExtension(format: ClientExportFormat): string {
  return format === "jpeg" ? "jpg" : EXPORT_EXTENSION[format];
}

export const supportsTransparency = (format: ClientExportFormat): boolean => format === "svg" || format === "png";

/** One file per page for these; PDF and PowerPoint hold every page in a single file. */
export const isImageFormat = (format: ClientExportFormat): format is "png" | "jpeg" | "svg" => format === "png" || format === "jpeg" || format === "svg";

/** Formats rendered from the scene. The others serialise the whole document as text. */
export const isVisualFormat = (format: ClientExportFormat): boolean => isImageFormat(format) || format === "pdf" || format === "pptx";

/** Maps the dialog's background choice to what the core renderers expect. */
export function resolveBackground(format: ClientExportFormat, background: ClientExportOptions["background"]): "doc" | "transparent" | Color {
  if (background === "white") return WHITE;
  if (background === "transparent" && supportsTransparency(format)) return "transparent";
  return "doc";
}

/** The requested pixel density, reduced when the canvas would exceed what browsers can allocate. */
export function rasterScale(view: Size, requested: number): number {
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, view.w * view.h));
  const bySide = MAX_CANVAS_SIDE / Math.max(1, view.w, view.h);
  return Math.min(Math.max(requested, 0.1), byArea, bySide);
}

/** `name.png`, or `name-01.png`, `name-02.png`… when a scope produces several files. */
export function exportFileNames(docName: string, format: ClientExportFormat, count = 1): string[] {
  const base = safeFileName(docName);
  const extension = exportExtension(format);
  if (count <= 1) return [`${base}.${extension}`];
  const digits = Math.max(2, String(count).length);
  return Array.from({ length: count }, (_, index) => `${base}-${String(index + 1).padStart(digits, "0")}.${extension}`);
}

/** Base64 of binary data, built in chunks so large fonts do not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ fonts */

/** Base64 TTF data by file name. Entries are promises so parallel exports share one download. */
const fontCache = new Map<string, Promise<string>>();

function loadFont(file: string): Promise<string> {
  let pending = fontCache.get(file);
  if (!pending) {
    pending = fetch(`/fonts/${file}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => bytesToBase64(new Uint8Array(buffer)));
    // A failed download must not poison later attempts.
    pending.catch(() => fontCache.delete(file));
    fontCache.set(file, pending);
  }
  return pending;
}

/** Loads the given variants, keyed by file name as `fontFaceCss` and `renderPdf` expect. */
async function loadFonts(variants: FontVariant[]): Promise<Record<string, string>> {
  const files = [...new Set(variants.map((variant) => variant.file))];
  try {
    const data = await Promise.all(files.map(loadFont));
    return Object.fromEntries(files.map((file, index) => [file, data[index]]));
  } catch (error) {
    // Exporting with fallback fonts would silently change the text, so fail instead.
    throw new Error("The diagram fonts could not be loaded. Check your connection and try again.", { cause: error });
  }
}

/* -------------------------------------------------------------- rendering */

type SceneBackground = "doc" | "transparent" | Color;

async function pageSvg(page: ExportPage, background: SceneBackground, embedFonts: boolean, scale = 1): Promise<SvgResult> {
  const variants = embedFonts ? usedFonts(page.scene) : [];
  // An exported SVG carries the fonts it uses, so it renders identically anywhere.
  const fontCss = variants.length ? fontFaceCss(variants, await loadFonts(variants)) : undefined;
  return renderSvg(page.scene, { bounds: page.view, padding: 0, background, scale, fontCss, title: page.name });
}

interface Raster {
  canvas: HTMLCanvasElement;
  scale: number;
}

/**
 * Draws a page onto a canvas. The SVG is loaded through an `Image`, which is
 * isolated from the page and cannot see its fonts — hence the embedded ones.
 */
async function rasterizePage(page: ExportPage, background: SceneBackground, requestedScale: number, matte?: Color): Promise<Raster> {
  const scale = rasterScale(page.view, requestedScale);
  // The intrinsic size is the target size, so no browser rasterises small and upscales.
  const { svg } = await pageSvg(page, background, true, scale);
  const width = Math.max(1, Math.round(page.view.w * scale));
  const height = Math.max(1, Math.round(page.view.h * scale));

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas context.");
    if (matte) {
      context.fillStyle = matte;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    return { canvas, scale };
  } catch (error) {
    throw new Error("The browser could not draw the diagram as an image. Try a lower scale, or export SVG or PDF instead.", { cause: error });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image is too large for this browser. Try a lower scale."))),
      type,
      quality,
    );
  });
}

/** Releases the pixel buffer right away instead of waiting for garbage collection. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

async function pagePng(page: ExportPage, background: SceneBackground, requestedScale: number): Promise<{ blob: Blob; scale: number }> {
  const { canvas, scale } = await rasterizePage(page, background, requestedScale);
  try {
    return { blob: await canvasBlob(canvas, "image/png"), scale };
  } finally {
    releaseCanvas(canvas);
  }
}

async function pageJpeg(page: ExportPage, background: SceneBackground, requestedScale: number): Promise<{ blob: Blob; scale: number }> {
  // JPEG has no alpha channel: anything the diagram background leaves open becomes white.
  const { canvas, scale } = await rasterizePage(page, background, requestedScale, WHITE);
  try {
    return { blob: await canvasBlob(canvas, "image/jpeg", JPEG_QUALITY), scale };
  } finally {
    releaseCanvas(canvas);
  }
}

const textBlob = (text: string, format: ClientExportFormat): Blob => new Blob([text], { type: `${exportMime(format)};charset=utf-8` });

async function renderFiles(doc: DiagramDoc, format: ClientExportFormat, options: ClientExportOptions, firstPageOnly: boolean): Promise<ExportedFile[]> {
  const [fileName] = exportFileNames(doc.name, format);
  const single = (blob: Blob, pages = 1): ExportedFile[] => [{ blob, fileName, pages }];

  switch (format) {
    case "json":
      return single(textBlob(JSON.stringify(doc, null, 2), format));
    case "drawio": {
      const { exportDrawio } = await import("@/core/io/drawio");
      return single(textBlob(exportDrawio(doc), format));
    }
    case "mermaid": {
      const { exportMermaid } = await import("@/core/io/mermaid");
      return single(textBlob(exportMermaid(doc), format));
    }
  }

  const allPages = exportPages(doc, options.scope, options.padding);
  const background = resolveBackground(format, options.background);

  switch (format) {
    case "svg":
    case "png":
    case "jpeg": {
      const pages = firstPageOnly ? allPages.slice(0, 1) : allPages;
      const names = exportFileNames(doc.name, format, pages.length);
      const files: ExportedFile[] = [];
      // One at a time: several full-size canvases at once can exhaust memory.
      for (const [index, page] of pages.entries()) {
        if (format === "svg") {
          const { svg } = await pageSvg(page, background, true);
          files.push({ blob: textBlob(svg, format), fileName: names[index], pages: 1 });
        } else {
          const { blob, scale } = await (format === "png" ? pagePng : pageJpeg)(page, background, options.scale);
          files.push({ blob, fileName: names[index], pages: 1, scale });
        }
      }
      return files;
    }
    case "pdf": {
      const { renderPdf } = await import("@/core/export/pdf");
      const data = await renderPdf(allPages, {
        pageSize: options.pageSize,
        orientation: options.orientation,
        margin: options.margin,
        background,
        fonts: await loadFonts(allPages.flatMap((page) => usedFonts(page.scene))),
        title: doc.name,
      });
      return single(new Blob([data], { type: exportMime(format) }), allPages.length);
    }
    case "pptx": {
      const { renderPptx } = await import("@/core/export/pptx");
      let images: string[] | undefined;
      if (options.slideMode === "image") {
        images = [];
        for (const page of allPages) {
          const { canvas } = await rasterizePage(page, background, SLIDE_IMAGE_SCALE);
          images.push(canvas.toDataURL("image/png"));
          releaseCanvas(canvas);
        }
      }
      const data = await renderPptx(allPages, { layout: options.slideLayout, mode: options.slideMode, background, title: doc.name, images });
      // Copied into a fresh buffer: `Blob` does not accept a view whose buffer might be shared.
      return single(new Blob([new Uint8Array(data)], { type: exportMime(format) }), allPages.length);
    }
  }
}

/* -------------------------------------------------------------------- API */

/**
 * Renders the document to files ready for download. PDF, PowerPoint and the
 * text formats always give one file; SVG, PNG and JPEG give one file per page,
 * so a "one page per frame" scope returns several (`name-01.png`, `name-02.png`…).
 */
export function exportDiagramFiles(doc: DiagramDoc, format: ClientExportFormat, options: ClientExportOptions): Promise<ExportedFile[]> {
  return renderFiles(doc, format, options, false);
}

/** Single-file variant: for the image formats only the first page of the scope is rendered. */
export async function exportDiagram(doc: DiagramDoc, format: ClientExportFormat, options: ClientExportOptions): Promise<ExportedFile> {
  const [file] = await renderFiles(doc, format, options, true);
  return file;
}

/** Saves a blob through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick cancels the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads files one after another; browsers drop downloads that are fired in the same tick. */
export async function downloadFiles(files: ExportedFile[]): Promise<void> {
  for (const [index, file] of files.entries()) {
    if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, 250));
    downloadBlob(file.blob, file.fileName);
  }
}

export function canCopyImage(): boolean {
  return typeof ClipboardItem !== "undefined" && typeof navigator !== "undefined" && typeof navigator.clipboard?.write === "function";
}

/**
 * Copies the first page of the scope to the clipboard as a PNG. Must be called
 * straight from a click or key handler: the clipboard write is started before
 * anything is awaited, which Safari requires.
 */
export async function copyImageToClipboard(doc: DiagramDoc, options: ClientExportOptions): Promise<void> {
  if (!canCopyImage()) throw new Error("This browser cannot copy images to the clipboard. Export a PNG instead.");

  const [page] = exportPages(doc, options.scope, options.padding);
  let renderError: unknown;
  const png = pagePng(page, resolveBackground("png", options.background), options.scale).then(
    ({ blob }) => blob,
    (error: unknown) => {
      renderError = error;
      throw error;
    },
  );
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (error) {
    if (renderError instanceof Error) throw renderError;
    const blocked = error instanceof DOMException && error.name === "NotAllowedError";
    throw new Error(
      blocked ? "The browser blocked access to the clipboard. Allow it for this site, or export a PNG instead." : "The image could not be copied to the clipboard.",
      { cause: error },
    );
  }
}

export interface ExportPreview {
  svg: string;
  /** Size of the page in CSS px, before any raster scale. */
  width: number;
  height: number;
  /** Pages the scope produces; `svg` shows the first. */
  pages: number;
  /** Name of the previewed page (the frame's title for a frame scope). */
  name: string;
}

/**
 * First page of what an export would contain, for on-screen preview. Fonts are
 * not embedded: the markup is meant to be inlined in the app, where the
 * diagram fonts are already loaded.
 */
export async function previewSvg(doc: DiagramDoc, options: ClientExportOptions): Promise<ExportPreview> {
  const pages = exportPages(doc, options.scope, options.padding);
  const [page] = pages;
  const { svg, width, height } = await pageSvg(page, resolveBackground("svg", options.background), false);
  return { svg, width, height, pages: pages.length, name: page.name };
}
