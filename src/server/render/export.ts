import { exportPages, safeFileName, type ExportPage, type ExportScope } from "@/core/export/pages";
import { renderPdf, type PdfPageSize } from "@/core/export/pdf";
import { renderPptx, type SlideLayout } from "@/core/export/pptx";
import { exportDrawio } from "@/core/io/drawio";
import { exportMermaid } from "@/core/io/mermaid";
import type { DiagramDoc } from "@/core/model/types";
import { EXPORT_EXTENSION, EXPORT_MIME, type ExportFormat } from "@/core/protocol";
import { fontFaceCss, renderSvg, usedFonts } from "@/core/render/svg";

import { fontFilePaths, fontsBase64 } from "./fonts";

export interface ExportOptions {
  scope?: ExportScope;
  /** Raster scale factor (PNG). */
  scale?: number;
  background?: "doc" | "transparent";
  pageSize?: PdfPageSize;
  slideLayout?: SlideLayout;
  /** `image` embeds a picture per slide instead of editable shapes. */
  slideMode?: "editable" | "image";
  padding?: number;
}

export interface ExportedFile {
  fileName: string;
  mime: string;
  data: Uint8Array | string;
  /** Number of pages / slides written. */
  pages: number;
}

const MAX_PIXELS = 64_000_000;

async function pageSvg(page: ExportPage, options: ExportOptions, embedFonts: boolean): Promise<string> {
  const fontCss = embedFonts ? fontFaceCss(usedFonts(page.scene), await fontsBase64()) : undefined;
  return renderSvg(page.scene, { bounds: page.view, padding: 0, background: options.background ?? "doc", fontCss, title: page.name }).svg;
}

/** Rasterises a page with resvg, using the bundled fonts so text matches the editor. */
export async function pagePng(page: ExportPage, options: ExportOptions = {}): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const requested = Math.min(Math.max(options.scale ?? 2, 0.1), 8);
  // Keep huge diagrams within a sane pixel budget.
  const scale = Math.min(requested, Math.sqrt(MAX_PIXELS / Math.max(1, page.view.w * page.view.h)));
  const svg = await pageSvg(page, options, false);
  const renderer = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { fontFiles: fontFilePaths(), loadSystemFonts: false, defaultFontFamily: "IBM Plex Sans" },
  });
  return renderer.render().asPng();
}

/** Renders a document to any supported format, entirely on the server. */
export async function exportDiagram(doc: DiagramDoc, format: ExportFormat, options: ExportOptions = {}): Promise<ExportedFile> {
  const base = safeFileName(doc.name);
  const file = (data: Uint8Array | string, pages = 1): ExportedFile => ({
    fileName: `${base}.${EXPORT_EXTENSION[format]}`,
    mime: EXPORT_MIME[format],
    data,
    pages,
  });

  switch (format) {
    case "json":
      return file(JSON.stringify(doc, null, 2));
    case "drawio":
      return file(exportDrawio(doc));
    case "mermaid":
      return file(exportMermaid(doc));
  }

  const pages = exportPages(doc, options.scope, options.padding);
  switch (format) {
    case "svg":
      return file(await pageSvg(pages[0], options, true));
    case "png":
      return file(await pagePng(pages[0], options));
    case "pdf": {
      const data = await renderPdf(pages, {
        pageSize: options.pageSize,
        background: options.background,
        fonts: await fontsBase64(),
        title: doc.name,
      });
      return file(new Uint8Array(data), pages.length);
    }
    case "pptx": {
      const mode = options.slideMode ?? "editable";
      const images =
        mode === "image"
          ? await Promise.all(
              pages.map(async (page) => `data:image/png;base64,${Buffer.from(await pagePng(page, { ...options, scale: 3 })).toString("base64")}`),
            )
          : undefined;
      const data = await renderPptx(pages, { layout: options.slideLayout, mode, background: options.background, title: doc.name, images });
      return file(data, pages.length);
    }
  }
}
