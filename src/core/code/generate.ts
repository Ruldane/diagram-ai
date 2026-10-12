import { getDiagramType } from "../catalog";
import { exportMermaid } from "../io/mermaid";
import { exportPlantUml } from "../io/plantuml-export";
import type { DiagramDoc } from "../model/types";
import { getShape } from "../shapes/registry";
import { mermaidShapeOf } from "./equivalence";
import type { CodeLanguage, ImportKind } from "./types";

/**
 * "Generate from diagram": the Mermaid text of the open diagram, offered
 * only when it says what the canvas shows. Mermaid has flowcharts and
 * sequence diagrams; a class or network diagram exported as boxes and arrows
 * would look like a faithful copy and silently lose its meaning.
 */

export type Generation =
  | { ok: true; text: string; kind: Exclude<ImportKind, "unknown">; note: string }
  | { ok: false; reason: string; example: string };

const LIFELINES = new Set(["uml/lifeline", "uml/actor-lifeline"]);

const FLOWCHART_EXAMPLE = `flowchart TD
  start([Start]) --> check{Is it valid?}
  check -->|yes| done([Done])
  check -->|no| fix[Fix the input]
  fix --> check`;

/** A shape survives the round trip when Mermaid text brings back the same shape (or any container, as a subgraph). */
function survives(shape: string): boolean {
  return Boolean(getShape(shape).container) || mermaidShapeOf(shape) === shape;
}

export function generateMermaid(doc: DiagramDoc): Generation {
  const nodes = Object.values(doc.nodes);
  if (nodes.length > 0 && nodes.every((node) => LIFELINES.has(node.shape))) {
    return {
      ok: true,
      text: exportMermaid(doc),
      kind: "sequence",
      note: "Message order comes from their position on the canvas. Lifeline positions are rebuilt when you apply the text.",
    };
  }
  const flowchartLike = nodes.every((node) => survives(node.shape));
  if (doc.type === "flowchart" || nodes.length === 0 || flowchartLike) {
    return {
      ok: true,
      text: exportMermaid(doc),
      kind: "flowchart",
      note: "Positions, sizes and colours are not part of the text. Applying it keeps them for every shape that is still there.",
    };
  }
  const name = getDiagramType(doc.type).name;
  return {
    ok: false,
    reason: `Mermaid covers flowcharts and sequence diagrams. This ${name.toLowerCase()} uses shapes it cannot express, so the generated text would lose them.`,
    example: FLOWCHART_EXAMPLE,
  };
}

const PLANTUML_NOTE = "Positions, sizes and colours are not part of the text. Applying it keeps them for every shape that is still there.";

export function generatePlantUml(doc: DiagramDoc): Generation {
  const result = exportPlantUml(doc);
  if (!result.ok) return result;
  return { ok: true, text: result.text, kind: result.kind, note: [...result.notes, ...(result.notes.some((note) => /^Written as/.test(note)) ? [] : [PLANTUML_NOTE])].join(" ") };
}

/** The text of the open diagram in `language`, or why that language cannot say it. */
export function generateCode(doc: DiagramDoc, language: CodeLanguage): Generation {
  return language === "plantuml" ? generatePlantUml(doc) : generateMermaid(doc);
}
