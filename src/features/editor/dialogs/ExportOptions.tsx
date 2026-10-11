"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

import type { PdfPageSize } from "@/core/export/pdf";
import type { SlideLayout } from "@/core/export/pptx";
import { Field, NumberField, Segmented, Select } from "@/components/ui/fields";
import { cn } from "@/lib/cn";

import { isImageFormat, isVisualFormat, supportsTransparency, type ClientExportFormat } from "../export/client-export";
import { PAGE_SIZE_LABELS } from "../export/export-layout";
import type { ExportSettings, ScopeKind } from "../export/export-settings";

const CAPTION = "text-[11px] font-medium text-ink-3";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={CAPTION}>{label}</span>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
      <Info aria-hidden className="mt-[3px] size-3.5 shrink-0 text-ink-4" />
      <span>{children}</span>
    </p>
  );
}

interface Choice<T extends string> {
  value: T;
  label: string;
  /** Short fact shown on the right, e.g. a count. */
  detail?: string;
  /** Trade-off shown under the label. */
  description?: string;
  disabled?: boolean;
}

/** Stacked single-choice list, for options that need a count or an explanation next to them. */
function ChoiceList<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="divide-y divide-line rounded-lg border border-line-strong bg-raised">
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={choice.disabled}
            onClick={() => onChange(choice.value)}
            className="flex w-full items-start gap-2.5 px-2.5 py-[7px] text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-sunken/60 focus-visible:-outline-offset-2 disabled:opacity-45 disabled:hover:bg-transparent"
          >
            <span aria-hidden className={cn("mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent" : "border-line-strong")}>
              {selected ? <span className="size-1.5 rounded-full bg-accent" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink">{choice.label}</span>
              {choice.description ? <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{choice.description}</span> : null}
            </span>
            {choice.detail ? <span className="mt-0.5 shrink-0 font-mono text-[11px] text-ink-3">{choice.detail}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;

const SCALES = ["1", "2", "3", "4"].map((value) => ({ value, label: `${value}×` }));
const PAGE_SIZES = Object.keys(PAGE_SIZE_LABELS) as PdfPageSize[];
const ORIENTATIONS: { value: ExportSettings["orientation"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];
const SLIDE_LAYOUTS: { value: SlideLayout; label: string }[] = [
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
];
const SLIDE_MODES: Choice<ExportSettings["slideMode"]>[] = [
  {
    value: "editable",
    label: "Editable shapes",
    description:
      "Native shapes and text boxes you can restyle in PowerPoint, Keynote or Google Slides. Text uses common system fonts, so spacing can differ slightly.",
  },
  { value: "image", label: "Exact image", description: "A pixel-exact picture of the diagram on each slide. It cannot be edited." },
];

const FORMAT_NOTES: Partial<Record<ClientExportFormat, string>> = {
  svg: "The fonts the diagram uses are embedded, so the file looks the same in any browser or design tool.",
  pdf: "Vector output with selectable text. The diagram is fitted to the page without cropping.",
  drawio: "Opens in diagrams.net with editable shapes. Unusual shapes fall back to rectangles.",
  mermaid: "Covers flowcharts and sequence diagrams. Other shapes are exported as plain nodes.",
  json: "The lossless native format. Import it again to get exactly this diagram back.",
};

function frameScopeLabel(format: ClientExportFormat): string {
  if (isImageFormat(format)) return "One file per frame";
  return format === "pptx" ? "One slide per frame" : "One page per frame";
}

export interface ExportOptionsProps {
  /** Effective settings (see `effectiveSettings`). */
  settings: ExportSettings;
  onChange: (patch: Partial<ExportSettings>) => void;
  selectionCount: number;
  frameCount: number;
}

/** The options that apply to the selected format, and nothing else. */
export function ExportOptions({ settings, onChange, selectionCount, frameCount }: ExportOptionsProps) {
  const { format } = settings;
  const visual = isVisualFormat(format);
  const raster = format === "png" || format === "jpeg";
  const sheet = format === "pdf" && settings.pageSize !== "fit";

  const scopes: Choice<ScopeKind>[] = [
    { value: "all", label: "Whole diagram" },
    { value: "selection", label: "Selection", detail: selectionCount ? count(selectionCount, "element") : "nothing selected", disabled: selectionCount === 0 },
    { value: "frames", label: frameScopeLabel(format), detail: frameCount ? count(frameCount, "frame") : "no frames", disabled: frameCount === 0 },
  ];
  const backgrounds: { value: ExportSettings["background"]; label: string }[] = [
    { value: "doc", label: "Diagram" },
    { value: "white", label: "White" },
    ...(supportsTransparency(format) ? [{ value: "transparent" as const, label: "Transparent" }] : []),
  ];

  return (
    <div className="flex flex-col gap-3.5">
      {visual ? (
        <Group label="What to export">
          <ChoiceList label="What to export" value={settings.scope} choices={scopes} onChange={(scope) => onChange({ scope })} />
        </Group>
      ) : null}

      {format === "pdf" ? (
        <>
          <Field label="Page size">
            <Select value={settings.pageSize} onChange={(event) => onChange({ pageSize: event.target.value as PdfPageSize })}>
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {PAGE_SIZE_LABELS[size]}
                </option>
              ))}
            </Select>
          </Field>
          {sheet ? (
            <Group label="Orientation">
              <Segmented label="Orientation" value={settings.orientation} options={ORIENTATIONS} onChange={(orientation) => onChange({ orientation })} />
            </Group>
          ) : null}
        </>
      ) : null}

      {format === "pptx" ? (
        <>
          <Group label="Slide size">
            <Segmented label="Slide size" value={settings.slideLayout} options={SLIDE_LAYOUTS} onChange={(slideLayout) => onChange({ slideLayout })} />
          </Group>
          <Group label="Content">
            <ChoiceList label="Content" value={settings.slideMode} choices={SLIDE_MODES} onChange={(slideMode) => onChange({ slideMode })} />
          </Group>
        </>
      ) : null}

      {raster ? (
        <Group label="Scale">
          <Segmented label="Scale" value={String(settings.scale)} options={SCALES} onChange={(scale) => onChange({ scale: Number(scale) })} />
        </Group>
      ) : null}

      {visual ? (
        <Group label="Background">
          <Segmented label="Background" value={settings.background} options={backgrounds} onChange={(background) => onChange({ background })} />
        </Group>
      ) : null}

      {visual && (sheet || settings.scope !== "frames") ? (
        <div className="grid grid-cols-2 gap-2">
          {/* Frames are exported at their own bounds, so padding has nothing to add there. */}
          {settings.scope !== "frames" ? (
            <NumberField label="Padding" value={settings.padding} min={0} max={400} step={4} suffix="px" onCommit={(padding) => onChange({ padding })} />
          ) : null}
          {sheet ? <NumberField label="Margin" value={settings.margin} min={0} max={144} step={6} suffix="pt" onCommit={(margin) => onChange({ margin })} /> : null}
        </div>
      ) : null}

      {FORMAT_NOTES[format] ? <Note>{FORMAT_NOTES[format]}</Note> : null}
    </div>
  );
}
