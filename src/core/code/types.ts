import type { LayoutDirection } from "../model/types";
import type { ElementsSpec } from "../spec/apply";
import type { SequenceSpec } from "../spec/sequence";

/** Text languages the code editor reads. */
export type CodeLanguage = "mermaid" | "plantuml";

/** What kind of diagram a piece of text described. `unknown` means nothing usable was found. */
export type ImportKind = "flowchart" | "sequence" | "class" | "usecase" | "activity" | "component" | "unknown";

/** A line of the source that needs the author's attention. Lines are 1-based. */
export interface ImportDiagnostic {
  line: number;
  message: string;
  /** `error`: the line could not be read. `warning`: understood but dropped or simplified. */
  severity: "error" | "warning";
}

/**
 * What both importers return (`importMermaid` and `importPlantUml`), so the
 * rest of the code editor does not care which language the text was in.
 */
export interface CodeImport {
  kind: ImportKind;
  /** Elements without positions. Empty for sequence diagrams. */
  spec: ElementsSpec;
  /** Participants and messages, for `buildSequence`. Only set when `kind` is `"sequence"`. */
  sequence?: SequenceSpec;
  direction?: LayoutDirection;
  warnings: string[];
}
