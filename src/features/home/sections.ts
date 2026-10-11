/** Element ids shared by the page sections and the controls that jump to them. */
export const SECTION = {
  diagrams: "diagrams",
  create: "new",
  agents: "agents",
} as const;

export const TYPE_SEARCH_ID = "type-search";

/**
 * Scrolls to a section (smoothly unless the user prefers reduced motion) and
 * optionally moves keyboard focus to a control inside it.
 */
export function jumpTo(sectionId: string, focusId?: string): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(sectionId)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
