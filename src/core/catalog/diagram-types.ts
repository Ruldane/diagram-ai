import { CATEGORIES } from "./categories";
import type { CategoryId, DiagramTypeDef } from "./types";
import { AI_TYPES } from "./types/ai";
import { CLOUD_TYPES } from "./types/cloud";
import { DATA_TYPES } from "./types/data";
import { ENGINEERING_TYPES } from "./types/engineering";
import { GENERAL_TYPES } from "./types/general";
import { PLANNING_TYPES } from "./types/planning";
import { PROCESS_TYPES } from "./types/process";
import { SOFTWARE_TYPES } from "./types/software";
import { STRATEGY_TYPES } from "./types/strategy";
import { UML_TYPES } from "./types/uml";
import { UX_TYPES } from "./types/ux";

/**
 * The diagram type catalog. Each entry configures the editor (palette,
 * defaults, layout) and tells agents how to draw that notation. The entries
 * live in `types/<category>.ts`, most common first within each category.
 */
const BY_CATEGORY: Record<CategoryId, DiagramTypeDef[]> = {
  software: SOFTWARE_TYPES,
  uml: UML_TYPES,
  data: DATA_TYPES,
  ai: AI_TYPES,
  cloud: CLOUD_TYPES,
  process: PROCESS_TYPES,
  strategy: STRATEGY_TYPES,
  planning: PLANNING_TYPES,
  ux: UX_TYPES,
  engineering: ENGINEERING_TYPES,
  general: GENERAL_TYPES,
};

/** The first five entries are the "quick start" row of the home page. */
const QUICK_START: string[] = ["flowchart", "uml-sequence", "system-architecture", "er-diagram", "uml-class"];

const inCategoryOrder = CATEGORIES.flatMap((category) => BY_CATEGORY[category.id]);

/** Quick-start types first, then every other type by category in the order of `CATEGORIES`. */
export const DIAGRAM_TYPES: DiagramTypeDef[] = [
  ...QUICK_START.flatMap((id) => inCategoryOrder.filter((type) => type.id === id)),
  ...inCategoryOrder.filter((type) => !QUICK_START.includes(type.id)),
];
