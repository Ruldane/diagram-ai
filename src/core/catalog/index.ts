import { DEFAULT_LAYOUT } from "../model/defaults";
import { CATEGORIES } from "./categories";
import { DIAGRAM_TYPES } from "./diagram-types";
import type { CategoryId, DiagramCategory, DiagramTypeDef } from "./types";

export type { CategoryId, DiagramCategory, DiagramTemplate, DiagramTypeDef } from "./types";
export { CATEGORIES } from "./categories";

export const DEFAULT_DIAGRAM_TYPE = "flowchart";

const byId = new Map(DIAGRAM_TYPES.map((type) => [type.id, type]));

export function listDiagramTypes(): DiagramTypeDef[] {
  return DIAGRAM_TYPES;
}

export function hasDiagramType(id: string): boolean {
  return byId.has(id);
}

/** Used when a document names a type this build does not know (older file, removed type). */
const FALLBACK_TYPE: DiagramTypeDef = {
  id: "blank",
  name: "Diagram",
  category: "general",
  description: "A free-form canvas with every shape library available.",
  keywords: [],
  libraries: ["basic", "flowchart", "icons"],
  defaultShape: "basic/rounded",
  routing: "orthogonal",
  edgeKind: "flow",
  layout: DEFAULT_LAYOUT,
  agentGuide: "No notation is implied. Pick shapes from any library with diagram_list_shapes.",
  support: "generic",
};

/** Lookup that always returns a type, so unknown or legacy ids never break rendering. */
export function getDiagramType(id: string): DiagramTypeDef {
  return byId.get(id) ?? byId.get(DEFAULT_DIAGRAM_TYPE) ?? FALLBACK_TYPE;
}

export function getCategory(id: CategoryId): DiagramCategory {
  return CATEGORIES.find((category) => category.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Lenient lookup for agents: id, name or keyword ("class diagram", "erd", "swimlane"). */
export function resolveDiagramType(query: string): DiagramTypeDef | undefined {
  const exact = byId.get(query) ?? byId.get(query.toLowerCase().replace(/[\s_]+/g, "-"));
  if (exact) return exact;
  const q = normalize(query).replace(/ diagram$/, "");
  if (!q) return undefined;
  return (
    DIAGRAM_TYPES.find((type) => normalize(type.name).replace(/ diagram$/, "") === q) ??
    DIAGRAM_TYPES.find((type) => type.keywords.some((keyword) => normalize(keyword) === q)) ??
    searchDiagramTypes(query, 1)[0]
  );
}

export function searchDiagramTypes(query: string, limit = 50): DiagramTypeDef[] {
  const q = normalize(query);
  if (!q) return DIAGRAM_TYPES.slice(0, limit);
  const terms = q.split(" ");
  const scored: { type: DiagramTypeDef; score: number }[] = [];
  for (const type of DIAGRAM_TYPES) {
    const name = normalize(type.name);
    const keywords = normalize(type.keywords.join(" "));
    const description = normalize(type.description);
    let score = 0;
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 70;
    else if (name.includes(q)) score += 50;
    for (const term of terms) {
      if (name.includes(term)) score += 12;
      if (keywords.includes(term)) score += 8;
      if (description.includes(term)) score += 3;
    }
    if (score > 0) scored.push({ type, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.type.name.localeCompare(b.type.name))
    .slice(0, limit)
    .map((s) => s.type);
}
