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

export function loadLanguage(diagramId: Id): CodeLanguage {
  try {
    return window.sessionStorage.getItem(languageKey(diagramId)) === "plantuml" ? "plantuml" : "mermaid";
  } catch {
    return "mermaid";
  }
}

export function saveLanguage(diagramId: Id, language: CodeLanguage): void {
  try {
    window.sessionStorage.setItem(languageKey(diagramId), language);
  } catch {
    // See above.
  }
}
