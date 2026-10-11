"use client";

import { Braces, Copy, Download, FileImage, FileText, GitBranch, Image as ImageIcon, LoaderCircle, Presentation, Spline, Workflow, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { framesInOrder } from "@/core/export/pages";
import { isPaint } from "@/core/render/scene";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

import { canCopyImage, copyImageToClipboard, downloadFiles, exportDiagramFiles, type ClientExportFormat } from "../export/client-export";
import { exportSummary, sheetLayout } from "../export/export-layout";
import { effectiveSettings, exportedMessage, rememberSettings, rememberedSettings, toExportOptions, type ExportSettings } from "../export/export-settings";
import { useDoc, useEditor } from "../store/context";
import { ExportOptions } from "./ExportOptions";
import { ExportPreview, useExportPreview } from "./ExportPreview";

/** `caption` says what the format is best for. */
const FORMATS: { id: ClientExportFormat; name: string; caption: string; icon: LucideIcon }[] = [
  { id: "png", name: "PNG", caption: "Docs, chat and wikis", icon: ImageIcon },
  { id: "jpeg", name: "JPEG", caption: "Smallest image file", icon: FileImage },
  { id: "svg", name: "SVG", caption: "Web, sharp at any zoom", icon: Spline },
  { id: "pdf", name: "PDF", caption: "Print and sharing", icon: FileText },
  { id: "pptx", name: "PowerPoint", caption: "Slide decks", icon: Presentation },
  { id: "drawio", name: "draw.io", caption: "Edit in diagrams.net", icon: Workflow },
  { id: "mermaid", name: "Mermaid", caption: "Markdown and READMEs", icon: GitBranch },
  { id: "json", name: "JSON", caption: "Backup and re-import", icon: Braces },
];

function FormatGrid({ value, onChange }: { value: ClientExportFormat; onChange: (format: ClientExportFormat) => void }) {
  return (
    <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-1.5">
      {FORMATS.map(({ id, name, caption, icon: Icon }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={cn(
              "flex min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
              selected ? "border-accent bg-accent-soft" : "border-line-strong bg-raised hover:border-ink-3",
            )}
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Icon aria-hidden className={cn("size-4 shrink-0", selected ? "text-accent" : "text-ink-3")} />
              {name}
            </span>
            <span className={cn("text-[11.5px] leading-snug", selected ? "text-ink-2" : "text-ink-3")}>{caption}</span>
          </button>
        );
      })}
    </div>
  );
}

const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

/**
 * Export dialog: a live preview of the output next to the format and the
 * options that apply to it. Files are rendered in the browser from the
 * document as it is on screen.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useDoc();
  const selection = useEditor((state) => state.selection);
  const [chosen, setChosen] = useState<ExportSettings>(rememberedSettings);
  const [busy, setBusy] = useState<"export" | "copy" | null>(null);
  const [copySupported] = useState(canCopyImage);

  const { nodes } = doc;
  const frameCount = useMemo(() => framesInOrder({ nodes }).length, [nodes]);
  const settings = effectiveSettings(chosen, { selection: selection.length, frames: frameCount });
  const format = FORMATS.find((item) => item.id === settings.format) ?? FORMATS[0];
  const empty = Object.keys(nodes).length === 0 && Object.keys(doc.edges).length === 0;

  useEffect(() => rememberSettings(chosen), [chosen]);

  const { preview, error } = useExportPreview(doc, settings.scope, selection, settings.padding, settings.background);
  const view = preview ? { w: preview.width, h: preview.height } : null;
  const sheet = view ? sheetLayout(settings.format, settings, view) : null;
  // A PDF sheet is plain paper; a slide takes the chosen background as a whole.
  const slideFill = settings.background === "doc" && isPaint(doc.settings.background) ? doc.settings.background : "#ffffff";
  const sheetFill = sheet ? (settings.format === "pptx" ? slideFill : "#ffffff") : undefined;

  const runExport = async () => {
    setBusy("export");
    try {
      const options = toExportOptions(settings, selection);
      const files = await exportDiagramFiles(doc, settings.format, options);
      await downloadFiles(files);
      toast.success(exportedMessage(files, options.scale));
      onClose();
    } catch (cause) {
      console.error(cause);
      toast.error(errorMessage(cause, "The export failed. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const runCopy = () => {
    setBusy("copy");
    // Not awaited before the call: the clipboard write has to start inside the click.
    copyImageToClipboard(doc, toExportOptions(settings, selection))
      .then(
        () => toast.success("Image copied to the clipboard"),
        (cause: unknown) => {
          console.error(cause);
          toast.error(errorMessage(cause, "The image could not be copied."));
        },
      )
      .finally(() => setBusy(null));
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Export"
      description="Rendered in your browser from the diagram as it is right now."
      width="max-w-4xl"
      footer={
        <>
          {copySupported ? (
            <Button onClick={runCopy} disabled={busy !== null || empty}>
              {busy === "copy" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Copy aria-hidden className="size-4" />}
              Copy image
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void runExport()} disabled={busy !== null || empty} aria-busy={busy === "export"}>
            {busy === "export" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
            {busy === "export" ? "Exporting…" : `Export ${format.name}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_336px]">
        <ExportPreview
          preview={preview}
          error={error}
          sheet={sheet}
          sheetFill={sheetFill}
          summary={preview ? exportSummary(settings.format, settings, preview) : ""}
          empty={empty}
          className="md:sticky md:top-0 md:self-start"
        />
        <div className="flex min-w-0 flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-3">Format</span>
            <FormatGrid value={settings.format} onChange={(next) => setChosen((current) => ({ ...current, format: next }))} />
          </div>
          <ExportOptions
            settings={settings}
            onChange={(patch) => setChosen((current) => ({ ...current, ...patch }))}
            selectionCount={selection.length}
            frameCount={frameCount}
          />
        </div>
      </div>
    </Dialog>
  );
}
