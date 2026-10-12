import type { CodeLanguage } from "@/core/code/types";
import type { Id } from "@/core/model/types";

/**
 * The text in the code editor survives switching tabs and reloading, per
 * diagram and per language. It lives in `sessionStorage`: it is a working
 * draft, not part of the document, and closing the tab discards it.
 * Storage can be missing or throw (private windows, blocked site data), so
 * every access is guarded and the editor works without it.
 */

const textKey = (diagramId: Id, language: CodeLanguage): string => `diagram-ai:code:${diagramId}:${language}`;
const languageKey = (diagramId: Id): string => `diagram-ai:code-language:${diagramId}`;

export function loadDraft(diagramId: Id, language: CodeLanguage): string {
  try {
    return window.sessionStorage.getItem(textKey(diagramId, language)) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(diagramId: Id, language: CodeLanguage, text: string): void {
  try {
    if (text) window.sessionStorage.setItem(textKey(diagramId, language), text);
    else window.sessionStorage.removeItem(textKey(diagramId, language));
  } catch {
    // Quota or blocked storage: the draft just does not survive a reload.
  }
}

/** The language last used for this diagram, or null when the person has not chosen one yet. */
export function loadLanguage(diagramId: Id): CodeLanguage | null {
  try {
    const stored = window.sessionStorage.getItem(languageKey(diagramId));
    return stored === "plantuml" || stored === "mermaid" ? stored : null;
  } catch {
    return null;
  }
}

export function saveLanguage(diagramId: Id, language: CodeLanguage): void {
  try {
    window.sessionStorage.setItem(languageKey(diagramId), language);
  } catch {
    // See above.
  }
}

const generatedKey = (diagramId: Id, language: CodeLanguage): string => `diagram-ai:code-generated:${diagramId}:${language}`;

/** The text last written from the canvas, kept so "the diagram changed since" survives switching tabs. */
export function loadGenerated(diagramId: Id, language: CodeLanguage): string | null {
  try {
    return window.sessionStorage.getItem(generatedKey(diagramId, language));
  } catch {
    return null;
  }
}

export function saveGenerated(diagramId: Id, language: CodeLanguage, text: string | null): void {
  try {
    if (text !== null) window.sessionStorage.setItem(generatedKey(diagramId, language), text);
    else window.sessionStorage.removeItem(generatedKey(diagramId, language));
  } catch {
    // See above.
  }
}
