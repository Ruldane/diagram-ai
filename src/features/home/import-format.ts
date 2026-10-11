import type { ImportFormat } from "./api";

export const IMPORT_ACCEPT = ".json,.drawio,.xml,.mmd,.mermaid,.md,.txt";

/** Mirrors the request limit of `POST /api/import`. */
export const IMPORT_MAX_CHARS = 20_000_000;

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  json: "Diagram AI JSON",
  drawio: "draw.io",
  mermaid: "Mermaid",
};

const BY_EXTENSION: Record<string, ImportFormat> = {
  json: "json",
  drawio: "drawio",
  xml: "drawio",
  mmd: "mermaid",
  mermaid: "mermaid",
};

const extension = (fileName: string): string => /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? "";

/** File name without its extension, used as the default diagram name. */
export const baseName = (fileName: string): string => fileName.replace(/\.[a-z0-9]+$/i, "").trim();

/**
 * Guesses the import format. The content decides when it is unambiguous (XML
 * starts with `<`, JSON with `{`); otherwise the file extension, and Mermaid
 * for plain text.
 */
export function detectFormat(content: string, fileName?: string): ImportFormat {
  const start = content.replace(/^﻿/, "").trimStart()[0];
  if (start === "<") return "drawio";
  if (start === "{") return "json";
  return (fileName && BY_EXTENSION[extension(fileName)]) || "mermaid";
}

/** Markdown notes often wrap Mermaid in a fenced block: import the first one. */
export function unwrapMermaid(content: string): string {
  const fenced = /```+\s*mermaid[^\n]*\n([\s\S]*?)```/i.exec(content);
  return (fenced ? fenced[1] : content).trim();
}
