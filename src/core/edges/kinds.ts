import type { DashStyle, EdgeStyle, MarkerKind } from "../model/types";

/**
 * Semantic relationship presets. Agents (and the inspector) can say
 * `kind: "inheritance"` instead of remembering which marker and dash UML uses.
 */
export interface EdgeKindDef {
  label: string;
  description: string;
  startMarker: MarkerKind;
  endMarker: MarkerKind;
  dash: DashStyle;
}

const kind = (
  label: string,
  description: string,
  startMarker: MarkerKind,
  endMarker: MarkerKind,
  dash: DashStyle = "solid",
): EdgeKindDef => ({ label, description, startMarker, endMarker, dash });

export const EDGE_KINDS = {
  flow: kind("Flow", "Directed flow from source to target (default).", "none", "arrow"),
  line: kind("Line", "Plain undirected link.", "none", "none"),
  bidirectional: kind("Bidirectional", "Two-way relationship.", "arrow", "arrow"),
  dashed: kind("Dashed flow", "Optional, async or indirect flow.", "none", "arrow", "dashed"),
  dotted: kind("Dotted link", "Weak or informational link.", "none", "none", "dotted"),

  // UML structure
  association: kind("Association", "UML association (source knows target).", "none", "open-arrow"),
  inheritance: kind("Inheritance", "UML generalisation: source extends target.", "none", "triangle-open"),
  implementation: kind("Implementation", "UML realisation: source implements target interface.", "none", "triangle-open", "dashed"),
  dependency: kind("Dependency", "UML dependency: source uses target.", "none", "open-arrow", "dashed"),
  aggregation: kind("Aggregation", "UML aggregation: source (whole) has target (part).", "diamond-open", "none"),
  composition: kind("Composition", "UML composition: source (whole) owns target (part).", "diamond", "none"),

  // UML behaviour
  message: kind("Message", "Synchronous message / call.", "none", "arrow"),
  async: kind("Async message", "Asynchronous message.", "none", "open-arrow"),
  return: kind("Return", "Return / reply message.", "none", "open-arrow", "dashed"),
  include: kind("Include / extend", "Use-case «include» / «extend».", "none", "open-arrow", "dashed"),

  // Entity relationship (crow's foot), read source-to-target
  "one-to-one": kind("One to one", "ER: exactly one on both sides.", "crow-one", "crow-one"),
  "one-to-many": kind("One to many", "ER: one source row relates to many target rows.", "crow-one", "crow-one-many"),
  "many-to-one": kind("Many to one", "ER: many source rows relate to one target row.", "crow-one-many", "crow-one"),
  "many-to-many": kind("Many to many", "ER: many on both sides.", "crow-one-many", "crow-one-many"),
  "zero-to-one": kind("Zero or one", "ER: optional single target.", "crow-one", "crow-zero-one"),
  "zero-to-many": kind("Zero or many", "ER: optional multiple targets.", "crow-one", "crow-zero-many"),
} as const satisfies Record<string, EdgeKindDef>;

export type EdgeKind = keyof typeof EDGE_KINDS;

export const EDGE_KIND_NAMES = Object.keys(EDGE_KINDS) as EdgeKind[];

export function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === "string" && value in EDGE_KINDS;
}

export function edgeKindStyle(name: EdgeKind): Pick<EdgeStyle, "startMarker" | "endMarker" | "dash"> {
  const { startMarker, endMarker, dash } = EDGE_KINDS[name];
  return { startMarker, endMarker, dash };
}

/** Best-matching preset for a style, to show the current kind in the inspector. */
export function matchEdgeKind(style: Pick<EdgeStyle, "startMarker" | "endMarker" | "dash">): EdgeKind | undefined {
  const start = style.startMarker ?? "none";
  const end = style.endMarker ?? "arrow";
  const dash = style.dash ?? "solid";
  return EDGE_KIND_NAMES.find((name) => {
    const def = EDGE_KINDS[name];
    return def.startMarker === start && def.endMarker === end && def.dash === dash;
  });
}
