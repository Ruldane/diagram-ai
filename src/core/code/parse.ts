import { importMermaid } from "../io/mermaid";
import { importPlantUml } from "../io/plantuml";
import type { CodeImport, CodeLanguage, ImportDiagnostic } from "./types";

/** Longest line shown in a message about it. */
const clip = (text: string, length = 50): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export interface CodeParse {
  language: CodeLanguage;
  imported: CodeImport;
  /** Findings per line (1-based). Errors are lines that could not be read; warnings were dropped or simplified. */
  diagnostics: ImportDiagnostic[];
  /** Everything the importer wants the author to know, as sentences. */
  warnings: string[];
  counts: { nodes: number; connectors: number; participants: number; messages: number };
  /** Nothing can be applied: no text, an unsupported diagram type, or no readable element. */
  empty: boolean;
  /** At least one line could not be read. Live mode waits until the text is clean. */
  hasErrors: boolean;
}

/* ------------------------------------------------------------------ mermaid */

/** Lines of a sequence diagram that carry nothing we draw, flagged individually in the editor. */
const SKIPPED_SEQUENCE_WORD = /^(note|loop|alt|else|opt|par|and|critical|option|break|rect|box|autonumber|activate|deactivate|destroy|link|links|properties)\b/i;

/** Replaces front matter and `%%{init}%%` directives with blank lines, so line numbers survive. */
function maskPreamble(text: string): string[] {
  const blank = (match: string): string => match.replace(/[^\n]/g, "");
  const lines = text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/%%\{[\s\S]*?\}%%/g, blank)
    .split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && lines[first].trim() === "---") {
    const close = lines.findIndex((line, index) => index > first && line.trim() === "---");
    if (close > first) for (let i = first; i <= close; i++) lines[i] = "";
  }
  return lines;
}

const MAX_PROBES = 4000;
const UNPARSED = /could not be understood/;

/**
 * `importMermaid` reports skipped lines as quoted text. To point at them in
 * the editor, the lines are tried one at a time under the diagram header
 * (every Mermaid statement stands on its own line).
 */
function mermaidDiagnostics(text: string, imported: CodeImport): ImportDiagnostic[] {
  const out: ImportDiagnostic[] = [];
  const lines = maskPreamble(text);
  const headerIndex = lines.findIndex((line) => line.trim() !== "" && !line.trim().startsWith("%%"));
  if (headerIndex < 0) return out;
  const header = lines[headerIndex].trim();

  const headerProblem = imported.warnings.find((warning) => /^Unsupported Mermaid diagram type|does not look like a Mermaid diagram/.test(warning));
  if (headerProblem) {
    out.push({ line: headerIndex + 1, severity: "error", message: headerProblem });
    return out;
  }
  const sequence = /^sequenceDiagram\b/.test(header);
  const unparsed = imported.warnings.some((warning) => UNPARSED.test(warning));
  let probes = 0;
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith("%%")) continue;
    if (sequence && SKIPPED_SEQUENCE_WORD.test(line)) {
      out.push({ line: index + 1, severity: "warning", message: `Not drawn, ignored: ${line.split(/\s+/)[0]}` });
      continue;
    }
    if (!unparsed || probes++ >= MAX_PROBES) continue;
    if (importMermaid(`${header}\n${line}`).warnings.some((warning) => UNPARSED.test(warning))) {
      out.push({ line: index + 1, severity: "error", message: `Could not be understood: ${clip(line)}` });
    }
  }
  return out;
}

/* -------------------------------------------------------------------- entry */

/** Reads diagram text in either language into one result shape. Never throws. */
export function parseCode(language: CodeLanguage, text: string): CodeParse {
  const imported: CodeImport & { diagnostics?: ImportDiagnostic[] } =
    language === "plantuml" ? importPlantUml(text) : importMermaid(text);
  const diagnostics = language === "plantuml" ? (imported.diagnostics ?? []) : mermaidDiagnostics(text, imported);

  const nodes = imported.spec.nodes?.length ?? 0;
  const participants = imported.sequence?.participants.length ?? 0;
  const empty = imported.kind === "unknown" || (nodes === 0 && participants === 0);
  const errors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    language,
    imported,
    diagnostics: [...diagnostics].sort((a, b) => a.line - b.line),
    warnings: imported.warnings,
    counts: {
      nodes,
      connectors: imported.spec.edges?.length ?? 0,
      participants,
      messages: imported.sequence?.messages.length ?? 0,
    },
    empty,
    hasErrors: errors || (empty && text.trim() !== ""),
  };
}
