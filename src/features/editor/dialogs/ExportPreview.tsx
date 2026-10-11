"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { DiagramDoc, Id } from "@/core/model/types";
import { cn } from "@/lib/cn";

import { DEFAULT_EXPORT_OPTIONS, previewSvg, type ClientExportOptions, type ExportPreview as Preview } from "../export/client-export";
import type { SheetLayout } from "../export/export-layout";
import { toScope, type ScopeKind } from "../export/export-settings";

const PREVIEW_DEBOUNCE_MS = 140;
/** Small diagrams are enlarged in the preview, but not beyond this factor. */
const MAX_PREVIEW_ZOOM = 2;

/** Neutral checkerboard, so transparent areas read as transparent in both themes. */
const CHECKERBOARD: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage: "repeating-conic-gradient(#e7e7e7 0% 25%, transparent 0% 50%)",
  backgroundSize: "16px 16px",
};

export interface PreviewState {
  preview: Preview | null;
  error: string | null;
}

/**
 * Renders the first page of the export whenever the document or an option that
 * changes the picture does. Updates are debounced; the first one is immediate.
 */
export function useExportPreview(
  doc: DiagramDoc,
  scope: ScopeKind,
  selection: Id[],
  padding: number,
  background: ClientExportOptions["background"],
): PreviewState {
  const [state, setState] = useState<PreviewState>({ preview: null, error: null });
  const rendered = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        previewSvg(doc, { ...DEFAULT_EXPORT_OPTIONS, scope: toScope(scope, selection), padding, background }).then(
          (preview) => {
            if (cancelled) return;
            rendered.current = true;
            setState({ preview, error: null });
          },
          (error: unknown) => {
            if (!cancelled) setState({ preview: null, error: error instanceof Error ? error.message : "The preview could not be rendered." });
          },
        );
      },
      rendered.current ? PREVIEW_DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, scope, selection, padding, background]);

  return state;
}

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

export interface ExportPreviewProps extends PreviewState {
  /** The page the diagram is placed on, or null when the output is just the diagram. */
  sheet: SheetLayout | null;
  /** Colour of the sheet around the diagram. Without it a checkerboard shows through transparent areas. */
  sheetFill?: string;
  /** Output size, e.g. "1840 × 1220 px @2×". */
  summary: string;
  empty: boolean;
  className?: string;
}

/** Scaled-to-fit picture of what will be exported, in the diagram's true colours. */
export function ExportPreview({ preview, error, sheet, sheetFill, summary, empty, className }: ExportPreviewProps) {
  const paper = preview ? (sheet?.sheet ?? { w: preview.width, h: preview.height }) : null;
  const ratio = paper ? paper.w / paper.h : 1;
  // Fit inside the tile (container query units) while keeping the page's proportions.
  const fit = [`100cqw`, `calc(100cqh * ${ratio})`, ...(preview && !sheet ? [`${preview.width * MAX_PREVIEW_ZOOM}px`] : [])].join(", ");

  return (
    <section aria-label="Preview" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="relative h-[200px] rounded-xl border border-line bg-sunken md:h-[min(50vh,430px)]">
        <div className="absolute inset-4 flex items-center justify-center [container-type:size]">
          {preview && paper && !empty ? (
            <div
              role="img"
              aria-label={`Preview of ${preview.name}`}
              className="relative shrink-0 overflow-hidden rounded-[3px] shadow-[var(--shadow-md)] ring-1 ring-black/10"
              style={{ ...(sheetFill ? { backgroundColor: sheetFill } : CHECKERBOARD), aspectRatio: `${paper.w} / ${paper.h}`, width: `min(${fit})` }}
            >
              {/* Inert: links inside the diagram must not be reachable from a preview. */}
              <div
                inert
                className="pointer-events-none absolute [&>svg]:block [&>svg]:size-full"
                style={
                  sheet
                    ? {
                        left: percent(sheet.content.x, sheet.sheet.w),
                        top: percent(sheet.content.y, sheet.sheet.h),
                        width: percent(sheet.content.w, sheet.sheet.w),
                        height: percent(sheet.content.h, sheet.sheet.h),
                      }
                    : { inset: 0 }
                }
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
            </div>
          ) : (
            <p className={cn("text-center text-[12px]", error ? "text-danger" : "text-ink-3")}>
              {empty ? "This diagram is empty. There is nothing to export yet." : (error ?? "Rendering preview…")}
            </p>
          )}
        </div>

        {preview && preview.pages > 1 && !empty ? (
          <p className="absolute top-2 left-2 max-w-[calc(100%-16px)] truncate rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-2">
            Page 1 of {preview.pages} · {preview.name}
          </p>
        ) : null}
      </div>

      <p aria-live="polite" className="min-h-[17px] font-mono text-[11.5px] text-ink-2">
        {empty ? "" : summary}
      </p>
    </section>
  );
}
