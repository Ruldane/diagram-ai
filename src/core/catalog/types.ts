import type { EdgeKind } from "../edges/kinds";
import type { EdgeRouting, LayoutOptions } from "../model/types";
import type { ElementsSpec } from "../spec/apply";
import type { SequenceSpec } from "../spec/sequence";

export type CategoryId =
  | "software"
  | "uml"
  | "data"
  | "ai"
  | "cloud"
  | "process"
  | "strategy"
  | "planning"
  | "ux"
  | "engineering"
  | "general";

export interface DiagramCategory {
  id: CategoryId;
  name: string;
  description: string;
}

/**
 * Starter content for a diagram type. Uses the same spec format agents send
 * through MCP, so templates double as worked examples for them.
 */
export interface DiagramTemplate extends ElementsSpec {
  /**
   * `"auto"` runs the type's default layout after insertion; `"none"` keeps the
   * explicit x/y given in the spec (matrices, timelines, wireframes…).
   */
  layout: "auto" | "none";
  /** Sequence diagrams are built from participants + messages instead. */
  sequence?: SequenceSpec;
}

export interface DiagramTypeDef {
  /** Stable kebab-case id, stored in documents. */
  id: string;
  name: string;
  category: CategoryId;
  /** One sentence: what the diagram shows and when to use it. */
  description: string;
  /** Search terms and synonyms. */
  keywords: string[];
  /** Shape libraries pinned first in the palette for this type. */
  libraries: string[];
  /** Shape given to nodes created without an explicit shape. */
  defaultShape: string;
  /** Default connector routing. */
  routing: EdgeRouting;
  /** Default connector semantics. */
  edgeKind: EdgeKind;
  /** Layout used by "auto layout". */
  layout: LayoutOptions;
  /**
   * Short guidance for AI agents: which shapes and edge kinds express this
   * notation correctly. Returned by `diagram_list_types` and `diagram_create`.
   */
  agentGuide: string;
  /**
   * `dedicated`: purpose-built shapes and conventions exist.
   * `generic`: drawn with general-purpose shapes.
   */
  support: "dedicated" | "generic";
  template?: DiagramTemplate;
}
