import type { ExportScope } from "@/core/export/pages";
import type { Id } from "@/core/model/types";

import {
  DEFAULT_EXPORT_OPTIONS,
  isVisualFormat,
  supportsTransparency,
  type ClientExportFormat,
  type ClientExportOptions,
  type ExportedFile,
} from "./client-export";

export type ScopeKind = ExportScope["kind"];

/**
 * What the export dialog edits: the format plus every option, with the scope
 * kept as a kind so it never holds stale element ids.
 */
export interface ExportSettings extends Omit<ClientExportOptions, "scope"> {
  format: ClientExportFormat;
  scope: ScopeKind;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { ...DEFAULT_EXPORT_OPTIONS, format: "png", scope: "all" };

/** Last used settings, kept for the session so the dialog reopens as it was left. */
let remembered = DEFAULT_EXPORT_SETTINGS;

export const rememberedSettings = (): ExportSettings => remembered;
export function rememberSettings(settings: ExportSettings): void {
  remembered = settings;
}

/**
 * The settings as they apply right now: choices the current format or diagram
 * cannot honour fall back without overwriting what the user picked, so they
 * come back when the format or the selection changes again.
 */
export function effectiveSettings(settings: ExportSettings, available: { selection: number; frames: number }): ExportSettings {
  // The text formats always serialise the whole document.
  if (!isVisualFormat(settings.format)) return { ...settings, scope: "all", background: "doc" };
  const unavailable = (settings.scope === "selection" && available.selection === 0) || (settings.scope === "frames" && available.frames === 0);
  const scope = unavailable ? "all" : settings.scope;
  const background = settings.background === "transparent" && !supportsTransparency(settings.format) ? "doc" : settings.background;
  return scope === settings.scope && background === settings.background ? settings : { ...settings, scope, background };
}

export function toScope(kind: ScopeKind, selection: Id[]): ExportScope {
  return kind === "selection" ? { kind, ids: selection } : { kind };
}

export function toExportOptions(settings: ExportSettings, selection: Id[]): ClientExportOptions {
  return {
    scope: toScope(settings.scope, selection),
    background: settings.background,
    scale: settings.scale,
    padding: settings.padding,
    pageSize: settings.pageSize,
    orientation: settings.orientation,
    margin: settings.margin,
    slideLayout: settings.slideLayout,
    slideMode: settings.slideMode,
  };
}

/** Toast text after a successful export. */
export function exportedMessage(files: ExportedFile[], requestedScale: number): string {
  const [first] = files;
  if (files.length > 1) return `Exported ${files.length} files: ${first.fileName} … ${files[files.length - 1].fileName}`;
  if (first.pages > 1) return `Exported ${first.fileName} (${first.pages} pages)`;
  if (first.scale !== undefined && first.scale < requestedScale) {
    return `Exported ${first.fileName} at ${Math.round(first.scale * 100) / 100}× instead of ${requestedScale}×, the largest this browser can draw`;
  }
  return `Exported ${first.fileName}`;
}
