import { matchEdgeKind } from "../edges/kinds";
import { resolveEdgeStyle, type ResolvedEdgeStyle } from "../model/defaults";
import { normalizeColor } from "../model/palette";
import { isDescendant } from "../model/queries";
import type { DashStyle, DEdge, DiagramDoc, DNode, EdgeStyle, Id, LayoutDirection, MarkerKind, NodeStyle } from "../model/types";
import { getShape, resolveShape } from "../shapes/registry";
import type { EdgeSpec, ElementsSpec, NodeSpec } from "../spec/apply";
import type { MessageKind, SequenceMessage, SequenceParticipant, SequenceSpec } from "../spec/sequence";
import { decodeEntities } from "./xml";

/**
 * Mermaid interchange for the two diagram types that map onto our model:
 * flowcharts (`flowchart` / `graph`) and sequence diagrams.
 *
 * Mermaid has no coordinates, so export keeps structure, labels and link
 * styles but not positions or sizes, and import returns unplaced nodes for
 * the app to lay out.
 */

/* ============================================================== shared text */

const LINE_BREAK = /<br\s*\/?>/gi;
const HTML_TAG = /<\/?[A-Za-z][^>]*>/g;
/** Mermaid's own entity syntax: `#quot;`, `#35;`. */
const MERMAID_ENTITY = /#(\d+|[A-Za-z]+);/g;

/** Font Awesome icon references (`fa:fa-car`), which we cannot draw. */
const ICON_REFERENCE = /\bfa[a-z]?:fa-[\w-]+\s*/g;

/** Label text as Mermaid shows it: `<br>` breaks lines, other tags and icons are dropped, entity codes are decoded. */
function decodeText(raw: string): string {
  const text = raw
    .replace(LINE_BREAK, "\n")
    .replace(HTML_TAG, "")
    .replace(ICON_REFERENCE, "")
    .replace(MERMAID_ENTITY, (_match, body: string) => (/^\d/.test(body) ? `&#${body};` : `&${body};`));
  return decodeEntities(text, { nbsp: " " })
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

const ENTITY_CODES: Record<string, string> = { "#": "#35;", "&": "#amp;", "<": "#lt;", ">": "#gt;", '"': "#quot;", ";": "#59;" };
const ALWAYS_ENCODED = "#&<>";

/** Escapes text with Mermaid entity codes; `extra` names further characters that are special where the text goes. */
function encodeText(text: string, extra = ""): string {
  const special = ALWAYS_ENCODED + extra;
  const escaped = [...text].map((char) => (special.includes(char) ? ENTITY_CODES[char] : char));
  return escaped.join("").split("\n").join("<br/>");
}

/** A quoted Mermaid string. Empty labels become a space, because `""` does not parse. */
const quoted = (text: string): string => `"${encodeText(text, '"') || " "}"`;

/* =================================================================== export */

const DIRECTION_CODES: Record<LayoutDirection, string> = { down: "TD", right: "LR", up: "BT", left: "RL" };

const STADIUM: [string, string] = ["([", "])"];
const DIAMOND: [string, string] = ["{", "}"];
const CIRCLE: [string, string] = ["((", "))"];
const LEAN_RIGHT: [string, string] = ["[/", "/]"];
const HEXAGON: [string, string] = ["{{", "}}"];
const RECT: [string, string] = ["[", "]"];

/** Our shape id → the Mermaid brackets drawing the closest shape. Everything else is a rectangle. */
const NODE_BRACKETS: Record<string, [string, string]> = {
  "basic/rounded": ["(", ")"],
  "basic/pill": STADIUM,
  "basic/ellipse": STADIUM,
  "basic/circle": CIRCLE,
  "basic/diamond": DIAMOND,
  "basic/hexagon": HEXAGON,
  "basic/parallelogram": LEAN_RIGHT,
  "basic/trapezoid": ["[/", "\\]"],
  "basic/cylinder": ["[(", ")]"],
  "basic/chevron": [">", "]"],
  "flowchart/decision": DIAMOND,
  "flowchart/terminator": STADIUM,
  "flowchart/data": LEAN_RIGHT,
  "flowchart/predefined-process": ["[[", "]]"],
  "flowchart/manual-operation": ["[\\", "/]"],
  "flowchart/preparation": HEXAGON,
  "flowchart/connector": CIRCLE,
};

/** Words Mermaid would read as syntax if used as a node id. */
const RESERVED_IDS = new Set(["end", "subgraph", "graph", "flowchart", "style", "class", "classdef", "click", "linkstyle", "direction", "default", "participant", "actor"]);

/** Maps element ids to Mermaid ids (letters, digits, underscore), unique and stable for a given document. */
class MermaidIds {
  private readonly byId = new Map<Id, string>();
  private readonly taken = new Set<string>();

  constructor(ids: Id[]) {
    for (const id of ids) {
      const base = id.replace(/[^A-Za-z0-9_]+/g, "_") || "n";
      let candidate = RESERVED_IDS.has(base.toLowerCase()) ? `${base}_` : base;
      for (let i = 2; this.taken.has(candidate); i++) candidate = `${base}_${i}`;
      this.taken.add(candidate);
      this.byId.set(id, candidate);
    }
  }

  get(id: Id | undefined): string | undefined {
    return id === undefined ? undefined : this.byId.get(id);
  }
}

/** Edges in creation order, re-sorted only where an explicit `z` says so. */
function edgesInOrder(edges: Record<Id, DEdge>): DEdge[] {
  return Object.values(edges)
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => (a.edge.z ?? 0) - (b.edge.z ?? 0) || a.index - b.index)
    .map((entry) => entry.edge);
}

/** Reading order along the layout direction, so the exported text starts where the diagram starts. */
function readingOrder(nodes: DNode[], direction: LayoutDirection): DNode[] {
  const horizontal = direction === "right" || direction === "left";
  const sign = direction === "up" || direction === "left" ? -1 : 1;
  const main = (node: DNode): number => sign * (horizontal ? node.x + node.w / 2 : node.y + node.h / 2);
  const cross = (node: DNode): number => (horizontal ? node.y + node.h / 2 : node.x + node.w / 2);
  return [...nodes].sort((a, b) => main(a) - main(b) || cross(a) - cross(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Head = "" | ">" | "o" | "x";

function headOf(marker: MarkerKind): Head {
  if (marker === "none") return "";
  if (marker === "circle" || marker === "circle-open") return "o";
  return marker === "cross" ? "x" : ">";
}

/** Stroke width from which a line exports as a Mermaid thick link (and that thick links import with). */
const THICK_WIDTH = 3;

/**
 * The link operator closest to an edge style. Mermaid only knows arrow, circle
 * and cross heads, and a head at the start must be mirrored at the end, so a
 * start-only marker (aggregation, composition) degrades to a plain line.
 */
function linkOperator(style: ResolvedEdgeStyle): string {
  const end = headOf(style.endMarker);
  const mirrored = end && headOf(style.startMarker) ? (end === ">" ? "<" : end) : "";
  if (style.dash !== "solid") return `${mirrored}-.-${end}`;
  if (style.strokeWidth >= THICK_WIDTH) return `${mirrored}==${end || "="}`;
  return `${mirrored}--${end || "-"}`;
}

function exportFlowchart(doc: DiagramDoc, header: string): string {
  const { direction } = doc.settings.layout;
  const nodes = readingOrder(Object.values(doc.nodes), direction);
  const ids = new MermaidIds(nodes.map((node) => node.id));

  const children = new Map<Id, DNode[]>();
  const roots: DNode[] = [];
  for (const node of nodes) {
    const parent = node.parent ? doc.nodes[node.parent] : undefined;
    const nested = parent && getShape(parent.shape).container && !isDescendant(doc.nodes, node.id, node.id);
    if (!nested) roots.push(node);
    else children.set(parent.id, [...(children.get(parent.id) ?? []), node]);
  }

  const lines = [header, `flowchart ${DIRECTION_CODES[direction] ?? "TD"}`];
  const emit = (node: DNode, depth: number): void => {
    const pad = "  ".repeat(depth);
    const id = ids.get(node.id)!;
    const members = children.get(node.id);
    if (!members) {
      const [open, close] = NODE_BRACKETS[node.shape] ?? RECT;
      lines.push(`${pad}${id}${open}${quoted(node.text ?? "")}${close}`);
      return;
    }
    lines.push(`${pad}subgraph ${id} [${quoted(node.text ?? "")}]`);
    for (const member of members) emit(member, depth + 1);
    lines.push(`${pad}end`);
  };
  for (const node of roots) emit(node, 1);

  let unattached = 0;
  for (const edge of edgesInOrder(doc.edges)) {
    const from = ids.get(edge.from.node);
    const to = ids.get(edge.to.node);
    if (!from || !to) {
      unattached++;
      continue;
    }
    const label = edge.text?.trim() ? `|${quoted(edge.text.trim())}|` : "";
    lines.push(`  ${from} ${linkOperator(resolveEdgeStyle(edge.style))}${label} ${to}`);
  }
  if (unattached) lines.push(`  %% ${unattached} connector${unattached === 1 ? "" : "s"} with a free end omitted`);
  return `${lines.join("\n")}\n`;
}

const LIFELINE_SHAPE = "uml/lifeline";
const ACTOR_LIFELINE_SHAPE = "uml/actor-lifeline";
const isLifeline = (node: DNode): boolean => node.shape === LIFELINE_SHAPE || node.shape === ACTOR_LIFELINE_SHAPE;

/** Vertical position of a message: where it leaves (or reaches) its lifeline. */
function messageY(edge: DEdge, nodes: Record<Id, DNode>): number {
  for (const end of [edge.from, edge.to]) {
    const node = end.node ? nodes[end.node] : undefined;
    if (node && typeof end.anchor === "object") return node.y + end.anchor.y * node.h;
  }
  return edge.waypoints?.[0]?.y ?? Number.POSITIVE_INFINITY;
}

function messageArrow(style: ResolvedEdgeStyle): string {
  if (style.dash !== "solid") return "-->>";
  if (style.endMarker === "open-arrow") return "-)";
  return style.endMarker === "none" ? "->" : "->>";
}

function exportSequence(doc: DiagramDoc, header: string): string {
  const participants = Object.values(doc.nodes).sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  const ids = new MermaidIds(participants.map((node) => node.id));
  const lines = [header, "sequenceDiagram"];
  for (const node of participants) {
    const id = ids.get(node.id)!;
    const keyword = node.shape === ACTOR_LIFELINE_SHAPE ? "actor" : "participant";
    lines.push(`  ${keyword} ${id} as ${encodeText(node.text?.trim() || id, ";")}`);
  }
  const messages = edgesInOrder(doc.edges)
    .map((edge, index) => ({ edge, index, y: messageY(edge, doc.nodes) }))
    .sort((a, b) => a.y - b.y || a.index - b.index);
  for (const { edge } of messages) {
    const from = ids.get(edge.from.node);
    const to = ids.get(edge.to.node);
    if (!from || !to) continue;
    lines.push(`  ${from}${messageArrow(resolveEdgeStyle(edge.style))}${to}: ${encodeText(edge.text?.trim() ?? "", ";")}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Writes a diagram as Mermaid text.
 *
 * Normally a `flowchart` in the document's layout direction: nodes with the
 * bracket shape closest to theirs (rectangle when Mermaid has none), containers
 * that hold nodes as nested `subgraph`s, links as `-->`, `---`, `-.->`, `==>`
 * (and `--o`, `--x`, `<-->`) with `|label|`. When every node is a sequence
 * lifeline the result is a `sequenceDiagram`, messages ordered top to bottom.
 *
 * Mermaid cannot express positions, sizes, colours, fonts, most markers, edge
 * end labels, waypoints or connectors with a free end; those are left out.
 */
export function exportMermaid(doc: DiagramDoc): string {
  const header = `%% ${doc.name.replace(/\s+/g, " ").trim()}`;
  const nodes = Object.values(doc.nodes);
  return nodes.length > 0 && nodes.every(isLifeline) ? exportSequence(doc, header) : exportFlowchart(doc, header);
}

/* =================================================================== import */

export interface MermaidImport {
  kind: "flowchart" | "sequence";
  /** Flowchart elements, without positions or sizes. Empty for sequence diagrams. */
  spec: ElementsSpec;
  /** Participants and messages, for `buildSequence`. Only set when `kind` is `"sequence"`. */
  sequence?: SequenceSpec;
  /** Flowchart direction, when the source states one. */
  direction?: "down" | "right" | "up" | "left";
  /** Everything that was skipped or could not be read, phrased for the user. */
  warnings: string[];
}

const SUPPORTED = "Only flowchart (graph) and sequenceDiagram can be imported.";

const emptyImport = (warning: string): MermaidImport => ({ kind: "flowchart", spec: { nodes: [], edges: [] }, warnings: [warning] });

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Source lines without front matter, `%%{init}%%` directives, comments and blank lines. */
function sourceLines(source: string): string[] {
  const lines = source
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/%%\{[\s\S]*?\}%%/g, "")
    .split("\n")
    .map((line) => line.trim());
  const first = lines.findIndex((line) => line !== "");
  if (first >= 0 && lines[first] === "---") {
    const close = lines.indexOf("---", first + 1);
    if (close > first) lines.splice(first, close - first + 1);
  }
  return lines.filter((line) => line !== "" && !line.startsWith("%%"));
}

function unparsedWarning(statements: string[]): string {
  const shown = statements.slice(0, 3).map((statement) => `"${statement.length > 60 ? `${statement.slice(0, 57)}…` : statement}"`);
  const more = statements.length > shown.length ? ` and ${statements.length - shown.length} more` : "";
  return `${plural(statements.length, "line")} could not be understood and ${statements.length === 1 ? "was" : "were"} skipped: ${shown.join(", ")}${more}.`;
}

/* ---------------------------------------------------------------- flowchart */

const FLOW_DIRECTIONS: Record<string, LayoutDirection> = { TB: "down", TD: "down", BT: "up", LR: "right", RL: "left" };

interface BracketShape {
  open: string;
  close: string;
  shape: string;
}

/** Mermaid node brackets, longest opener first so `((` wins over `(`. */
const BRACKET_SHAPES: BracketShape[] = [
  { open: "(((", close: ")))", shape: "basic/circle" },
  { open: "((", close: "))", shape: "basic/circle" },
  { open: "([", close: "])", shape: "flowchart/terminator" },
  { open: "[(", close: ")]", shape: "basic/cylinder" },
  { open: "[[", close: "]]", shape: "flowchart/predefined-process" },
  { open: "[/", close: "/]", shape: "flowchart/data" },
  { open: "[/", close: "\\]", shape: "basic/trapezoid" },
  // We have no left-leaning parallelogram; the right-leaning one is the same symbol.
  { open: "[\\", close: "\\]", shape: "flowchart/data" },
  { open: "[\\", close: "/]", shape: "flowchart/manual-operation" },
  { open: "{{", close: "}}", shape: "basic/hexagon" },
  { open: "{", close: "}", shape: "flowchart/decision" },
  { open: "(", close: ")", shape: "basic/rounded" },
  { open: "[", close: "]", shape: "flowchart/process" },
  { open: ">", close: "]", shape: "basic/chevron" },
];

/** Shape names of Mermaid's `id@{ shape: … }` syntax. Unlisted names are tried against our shape registry as-is. */
const NAMED_SHAPES: Record<string, string> = {
  rect: "flowchart/process",
  rectangle: "flowchart/process",
  proc: "flowchart/process",
  process: "flowchart/process",
  rounded: "basic/rounded",
  event: "basic/rounded",
  stadium: "flowchart/terminator",
  pill: "flowchart/terminator",
  terminal: "flowchart/terminator",
  diamond: "flowchart/decision",
  diam: "flowchart/decision",
  decision: "flowchart/decision",
  question: "flowchart/decision",
  cyl: "basic/cylinder",
  cylinder: "basic/cylinder",
  database: "basic/cylinder",
  db: "basic/cylinder",
  circle: "basic/circle",
  circ: "basic/circle",
  "dbl-circ": "basic/circle",
  "double-circle": "basic/circle",
  "sm-circ": "flowchart/connector",
  hex: "basic/hexagon",
  hexagon: "basic/hexagon",
  prepare: "flowchart/preparation",
  "lean-r": "flowchart/data",
  "lean-l": "flowchart/data",
  "in-out": "flowchart/data",
  "trap-b": "basic/trapezoid",
  trapezoid: "basic/trapezoid",
  "trap-t": "flowchart/manual-operation",
  "manual": "flowchart/manual-operation",
  subproc: "flowchart/predefined-process",
  subprocess: "flowchart/predefined-process",
  "fr-rect": "flowchart/predefined-process",
  doc: "flowchart/document",
  document: "flowchart/document",
  docs: "flowchart/multi-document",
  delay: "flowchart/delay",
  display: "flowchart/display",
  "manual-input": "flowchart/manual-input",
  "sl-rect": "flowchart/manual-input",
  text: "basic/text",
  cloud: "basic/cloud",
  tri: "basic/triangle",
  triangle: "basic/triangle",
  "notch-rect": "flowchart/card",
  card: "flowchart/card",
};

const DEFAULT_FLOW_SHAPE = "flowchart/process";
const SUBGRAPH_SHAPE = "basic/group";

interface FlowNode {
  /** Id used in the spec (safe for `applySpec`). */
  id: string;
  shape: string;
  text: string;
  container: boolean;
  parent?: string;
  classes: string[];
  style: NodeStyle;
}

interface Subgraph {
  key: string;
  /** Mermaid ids of nodes mentioned directly in the body. */
  members: Set<string>;
  parent?: string;
}

interface Link {
  line: "solid" | "dotted" | "thick" | "invisible";
  start: "" | "<" | "o" | "x";
  end: Head;
  text?: string;
}

/** A node as one statement mentions it; `shape` and `text` only when it is declared there. */
interface NodeRef {
  key: string;
  shape?: string;
  text?: string;
  className?: string;
}

const UNSAFE_ID_CHARS = /[^A-Za-z0-9_.:-]+/g;
const MAX_ID_LENGTH = 64;

/** Turns Mermaid ids into ids `applySpec` accepts unchanged, keeping distinct sources distinct. */
class SafeIds {
  private readonly taken = new Set<string>();

  next(raw: string): string {
    const cleaned = raw.replace(UNSAFE_ID_CHARS, "-").replace(/^[^A-Za-z0-9]+/, "");
    const base = (cleaned || "node").slice(0, MAX_ID_LENGTH - 6);
    let candidate = base;
    for (let i = 2; this.taken.has(candidate); i++) candidate = `${base}-${i}`;
    this.taken.add(candidate);
    return candidate;
  }
}

/** `fill:#f9f,stroke:#333,stroke-width:2px` → the parts of it a node style can hold. */
function parseCssStyle(css: string): NodeStyle {
  const style: NodeStyle = {};
  for (const declaration of css.split(/[,;]/)) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const key = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const color = normalizeColor(value);
    const size = Number.parseFloat(value);
    if (key === "fill" && color) style.fill = color;
    else if (key === "stroke" && color) style.stroke = color;
    else if (key === "color" && color && color !== "none") style.textColor = color;
    else if (key === "stroke-width" && Number.isFinite(size)) style.strokeWidth = size;
    else if (key === "stroke-dasharray" && value !== "0" && value !== "none") style.dash = "dashed";
    else if (key === "font-size" && Number.isFinite(size)) style.fontSize = size;
    else if (key === "font-weight" && /bold|[6-9]00/.test(value)) style.bold = true;
    else if (key === "font-style" && value === "italic") style.italic = true;
  }
  return style;
}

/** Splits a line into statements at `;`, except inside quotes, brackets, `|labels|` and entity codes (`#59;`). */
function splitStatements(line: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let inPipes = false;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    if (char === "|") inPipes = !inPipes;
    else if ("[({".includes(char)) depth++;
    else if ("])}".includes(char)) depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0 && !inPipes && !/#\w+$/.test(line.slice(start, i))) {
      statements.push(line.slice(start, i));
      start = i + 1;
    }
  }
  statements.push(line.slice(start));
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

const ID_PATTERN = /[A-Za-z0-9_\u00a1-\uffff]+(?:[-.][A-Za-z0-9_\u00a1-\uffff]+)*/y;
/** Groups: 1 start head, 2 solid, 3 thick, 4 dotted, 5 invisible, 6 end head. */
const LINK_PATTERN = /([<ox])?(?:(-{3,}|-{2,}(?=[>ox]))|(={3,}|={2,}(?=[>ox]))|(-\.+-)|(~{3,}))([>ox])?/y;
/** A link that carries its label inline: `-- text -->`, `== text ==>`, `-. text .->`. */
const LINK_OPENER = /([<ox])?(--|==|-\.)/y;
const LINK_CLOSERS: Record<string, { line: Link["line"]; pattern: RegExp }> = {
  "--": { line: "solid", pattern: /-{2,}[>ox]|-{3,}/g },
  "==": { line: "thick", pattern: /={2,}[>ox]|={3,}/g },
  "-.": { line: "dotted", pattern: /\.+-[>ox]?/g },
};
const EDGE_ID_PATTERN = /[A-Za-z0-9_]+@(?=[-=<~])/y;

const headAt = (text: string): Head => {
  const last = text[text.length - 1];
  return last === ">" || last === "o" || last === "x" ? last : "";
};

/** Reads one flowchart statement left to right. Every `read…` returns undefined, without consuming, when it does not apply. */
class StatementReader {
  position = 0;

  constructor(readonly text: string) {}

  get done(): boolean {
    this.skipSpaces();
    return this.position >= this.text.length;
  }

  skipSpaces(): void {
    while (this.text[this.position] === " " || this.text[this.position] === "\t") this.position++;
  }

  startsWith(token: string): boolean {
    return this.text.startsWith(token, this.position);
  }

  match(pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = this.position;
    const found = pattern.exec(this.text);
    if (found) this.position = pattern.lastIndex;
    return found;
  }

  /** `"quoted text"` at the cursor. */
  readQuoted(): string | undefined {
    if (!this.startsWith('"')) return undefined;
    const end = this.text.indexOf('"', this.position + 1);
    if (end < 0) return undefined;
    const value = this.text.slice(this.position + 1, end);
    this.position = end + 1;
    return value;
  }

  /** Text up to one of the closers (quoted or bare), consuming the closer. Returns the text and which closer ended it. */
  readUntil(closers: string[]): { text: string; closer: string } | undefined {
    const start = this.position;
    this.skipSpaces();
    const quotedText = this.readQuoted();
    if (quotedText !== undefined) {
      this.skipSpaces();
      const closer = closers.find((candidate) => this.startsWith(candidate));
      if (closer) {
        this.position += closer.length;
        return { text: quotedText, closer };
      }
      this.position = start;
    }
    let best: { at: number; closer: string } | undefined;
    for (const closer of closers) {
      const at = this.text.indexOf(closer, this.position);
      if (at >= 0 && (!best || at < best.at || (at === best.at && closer.length > best.closer.length))) best = { at, closer };
    }
    if (!best) {
      this.position = start;
      return undefined;
    }
    const text = this.text.slice(this.position, best.at);
    this.position = best.at + best.closer.length;
    return { text, closer: best.closer };
  }

  readLink(): Link | undefined {
    const start = this.position;
    this.skipSpaces();
    this.match(EDGE_ID_PATTERN);
    const link = this.readPlainLink() ?? this.readLabelledLink();
    if (!link) {
      this.position = start;
      return undefined;
    }
    this.skipSpaces();
    if (this.startsWith("|")) {
      this.position++;
      const label = this.readUntil(["|"]);
      if (label) link.text = label.text;
    }
    return link;
  }

  private readPlainLink(): Link | undefined {
    const found = this.match(LINK_PATTERN);
    if (!found) return undefined;
    const line: Link["line"] = found[2] ? "solid" : found[3] ? "thick" : found[4] ? "dotted" : "invisible";
    return { line, start: (found[1] ?? "") as Link["start"], end: (found[6] ?? "") as Head };
  }

  private readLabelledLink(): Link | undefined {
    const start = this.position;
    const opener = this.match(LINK_OPENER);
    if (!opener) return undefined;
    const { line, pattern } = LINK_CLOSERS[opener[2]];
    this.skipSpaces();
    const quotedText = this.readQuoted();
    pattern.lastIndex = this.position;
    const closer = pattern.exec(this.text);
    if (!closer) {
      this.position = start;
      return undefined;
    }
    const text = quotedText ?? this.text.slice(this.position, closer.index);
    this.position = closer.index + closer[0].length;
    return { line, start: (opener[1] ?? "") as Link["start"], end: headAt(closer[0]), text };
  }

  /** One or more nodes joined by `&`. */
  readGroup(): NodeRef[] | undefined {
    const group: NodeRef[] = [];
    for (;;) {
      const node = this.readNode();
      if (!node) return undefined;
      group.push(node);
      this.skipSpaces();
      if (!this.startsWith("&")) return group;
      this.position++;
    }
  }

  /** An id, optionally followed by a bracket shape or `@{ … }` attributes, then `:::class`. */
  private readNode(): NodeRef | undefined {
    this.skipSpaces();
    const id = this.match(ID_PATTERN);
    if (!id) return undefined;
    const node: NodeRef = { key: id[0] };
    this.skipSpaces();
    if (this.startsWith("@{")) this.readAttributes(node);
    else if (!this.readBrackets(node)) return undefined;
    this.skipSpaces();
    if (this.startsWith(":::")) {
      this.position += 3;
      node.className = this.match(CLASS_NAME)?.[0];
    }
    return node;
  }

  /** Reads `[text]`-style brackets when present. False only when a bracket opens and never closes. */
  private readBrackets(node: NodeRef): boolean {
    const openers = new Set(BRACKET_SHAPES.filter((bracket) => this.startsWith(bracket.open)).map((bracket) => bracket.open));
    // `[/path]` opens like a parallelogram but only closes as a rectangle, so shorter openers get their turn.
    for (const opener of openers) {
      const candidates = BRACKET_SHAPES.filter((bracket) => bracket.open === opener);
      const start = this.position;
      this.position += opener.length;
      const content = this.readUntil(candidates.map((bracket) => bracket.close));
      if (content) {
        node.shape = candidates.find((bracket) => bracket.close === content.closer)?.shape;
        node.text = decodeText(content.text.trim().replace(MARKDOWN_STRING, "$1"));
        return true;
      }
      this.position = start;
    }
    return openers.size === 0;
  }

  /** `@{ shape: diamond, label: "Text" }`. */
  private readAttributes(node: NodeRef): void {
    this.position += 2;
    const body = this.readUntil(["}"]);
    if (!body) return;
    const attributes = parseAttributes(body.text);
    const name = attributes.shape?.toLowerCase();
    if (name) node.shape = NAMED_SHAPES[name] ?? resolveShape(name)?.id;
    if (attributes.label !== undefined) node.text = decodeText(attributes.label);
  }
}

const CLASS_NAME = /[A-Za-z0-9_-]+/y;
/** Mermaid "markdown strings" are wrapped in backticks inside the quotes. */
const MARKDOWN_STRING = /^`([\s\S]*)`$/;

/** `key: value` pairs of a `@{ … }` block (values may be quoted). */
function parseAttributes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pair = /([A-Za-z_]+)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,\n]*))/g;
  for (let found = pair.exec(body); found; found = pair.exec(body)) out[found[1]] = (found[2] ?? found[3] ?? found[4] ?? "").trim();
  return out;
}

interface Chain {
  /** Node groups, with `links[i]` joining `groups[i]` to `groups[i + 1]`. */
  groups: NodeRef[][];
  links: Link[];
}

/** `A & B --> C -- label --> D`. Undefined when the statement is not a chain of nodes and links. */
function parseChain(statement: string): Chain | undefined {
  const reader = new StatementReader(statement);
  const first = reader.readGroup();
  if (!first) return undefined;
  const chain: Chain = { groups: [first], links: [] };
  while (!reader.done) {
    const link = reader.readLink();
    const group = link && reader.readGroup();
    if (!link || !group) return undefined;
    chain.links.push(link);
    chain.groups.push(group);
  }
  return chain;
}

const START_MARKERS: Record<Link["start"], MarkerKind> = { "": "none", "<": "arrow", o: "circle", x: "cross" };
const END_MARKERS: Record<Head, MarkerKind> = { "": "none", ">": "arrow", o: "circle", x: "cross" };

const KEYWORD = /^(subgraph|end|direction|style|classDef|class|linkStyle|click|accTitle|accDescr)(?:[\s:]+([\s\S]*))?$/;

class FlowchartParser {
  private readonly nodes = new Map<string, FlowNode>();
  private readonly edges: EdgeSpec[] = [];
  private readonly ids = new SafeIds();
  private readonly open: Subgraph[] = [];
  private readonly closed: Subgraph[] = [];
  private readonly classDefs = new Map<string, NodeStyle>();
  private readonly unparsed: string[] = [];
  private invisibleLinks = 0;
  private anonymousSubgraphs = 0;

  parse(statements: string[]): { spec: ElementsSpec; warnings: string[] } {
    for (const statement of statements) this.statement(statement);
    while (this.open.length) this.closeSubgraph();
    this.assignParents();

    const warnings: string[] = [];
    if (this.unparsed.length) warnings.push(unparsedWarning(this.unparsed));
    if (this.invisibleLinks) warnings.push(`${plural(this.invisibleLinks, "invisible link")} (~~~) ignored.`);
    return { spec: { nodes: [...this.nodes.values()].map((node) => this.nodeSpec(node)), edges: this.edges }, warnings };
  }

  private statement(statement: string): void {
    const keyword = KEYWORD.exec(statement);
    const rest = keyword?.[2]?.trim() ?? "";
    switch (keyword?.[1]) {
      case "subgraph":
        return this.openSubgraph(rest);
      case "end":
        return this.closeSubgraph();
      case "style":
        return this.styleStatement(rest);
      case "classDef":
        return this.classDefStatement(rest);
      case "class":
        return this.classStatement(rest);
      case undefined:
        if (!this.chain(statement)) this.unparsed.push(statement);
        return;
      default:
        // direction, linkStyle, click, accTitle, accDescr: nothing to carry over.
        return;
    }
  }

  /* ---------------------------------------------------------------- nodes */

  private node(key: string): FlowNode {
    let node = this.nodes.get(key);
    if (!node) {
      node = { id: this.ids.next(key), shape: DEFAULT_FLOW_SHAPE, text: key, container: false, classes: [], style: {} };
      this.nodes.set(key, node);
    }
    this.open[this.open.length - 1]?.members.add(key);
    return node;
  }

  private nodeSpec(node: FlowNode): NodeSpec {
    const layers = node.container ? [] : [this.classDefs.get("default")];
    for (const name of node.classes) layers.push(this.classDefs.get(name));
    const style: NodeStyle = Object.assign({}, ...layers, node.style);
    return {
      id: node.id,
      shape: node.shape,
      text: node.text,
      ...(node.parent ? { parent: node.parent } : {}),
      ...(Object.keys(style).length ? { style } : {}),
    };
  }

  /* ------------------------------------------------------------ subgraphs */

  /** `subgraph id [Title]`, `subgraph id`, `subgraph Title words` or `subgraph "Title"`. */
  private openSubgraph(header: string): void {
    const titled = /^([^\s[]+)\s*\[([\s\S]*)\]$/.exec(header);
    const bare = /^"([\s\S]*)"$/.exec(header);
    let key: string;
    let title: string;
    if (titled) [key, title] = [titled[1], titled[2].trim().replace(/^"([\s\S]*)"$/, "$1")];
    else if (bare || !header || /\s/.test(header)) [key, title] = [`subgraph-${++this.anonymousSubgraphs}`, bare ? bare[1] : header];
    else [key, title] = [header, header];

    const parent = this.open[this.open.length - 1];
    const node = this.node(key);
    node.container = true;
    node.shape = SUBGRAPH_SHAPE;
    node.text = decodeText(title);
    this.open.push({ key, members: new Set(), parent: parent?.key });
  }

  private closeSubgraph(): void {
    const subgraph = this.open.pop();
    if (subgraph) this.closed.push(subgraph);
  }

  /** Like Mermaid: a node belongs to the first-closed subgraph that mentions it; subgraphs nest structurally. */
  private assignParents(): void {
    for (const subgraph of this.closed) {
      const container = this.nodes.get(subgraph.key)!;
      if (subgraph.parent) container.parent = this.nodes.get(subgraph.parent)?.id;
      for (const key of subgraph.members) {
        const member = this.nodes.get(key);
        if (member && !member.container && !member.parent) member.parent = container.id;
      }
    }
  }

  /* --------------------------------------------------------------- styles */

  private styleStatement(rest: string): void {
    const found = /^(\S+)\s+([\s\S]+)$/.exec(rest);
    if (!found) return;
    const style = parseCssStyle(found[2]);
    for (const key of found[1].split(",")) {
      const node = this.nodes.get(key.trim());
      if (node) Object.assign(node.style, style);
    }
  }

  private classDefStatement(rest: string): void {
    const found = /^(\S+)\s+([\s\S]+)$/.exec(rest);
    if (!found) return;
    const style = parseCssStyle(found[2]);
    for (const name of found[1].split(",")) this.classDefs.set(name.trim(), style);
  }

  private classStatement(rest: string): void {
    const found = /^(\S+)\s+(\S+)$/.exec(rest);
    if (!found) return;
    for (const key of found[1].split(",")) this.nodes.get(key.trim())?.classes.push(found[2]);
  }

  /* --------------------------------------------------------------- chains */

  /** Applies a chain statement: declares its nodes and connects each group to the next. False when it is not a chain. */
  private chain(statement: string): boolean {
    const chain = parseChain(statement);
    if (!chain) return false;
    const groups = chain.groups.map((group) => group.map((ref) => this.declare(ref)));
    chain.links.forEach((link, index) => {
      for (const from of groups[index]) for (const to of groups[index + 1]) this.addEdge(from, to, link);
    });
    return true;
  }

  private declare(ref: NodeRef): FlowNode {
    const node = this.node(ref.key);
    if (ref.shape && !node.container) node.shape = ref.shape;
    if (ref.text !== undefined) node.text = ref.text;
    if (ref.className) node.classes.push(ref.className);
    return node;
  }

  private addEdge(from: FlowNode, to: FlowNode, link: Link): void {
    if (link.line === "invisible") {
      this.invisibleLinks++;
      return;
    }
    const startMarker = START_MARKERS[link.start];
    const endMarker = END_MARKERS[link.end];
    const dash: DashStyle = link.line !== "dotted" ? "solid" : startMarker === "none" && endMarker === "none" ? "dotted" : "dashed";
    const kind = matchEdgeKind({ startMarker, endMarker, dash });
    const style: EdgeStyle = { ...(kind ? {} : { startMarker, endMarker, dash }), ...(link.line === "thick" ? { strokeWidth: THICK_WIDTH } : {}) };
    const text = link.text === undefined ? "" : decodeText(link.text);
    this.edges.push({
      from: from.id,
      to: to.id,
      ...(text ? { text } : {}),
      ...(kind ? { kind } : {}),
      ...(Object.keys(style).length ? { style } : {}),
    });
  }
}

function importFlowchart(statements: string[], direction: LayoutDirection | undefined): MermaidImport {
  const { spec, warnings } = new FlowchartParser().parse(statements);
  return { kind: "flowchart", spec, ...(direction ? { direction } : {}), warnings };
}

/* ----------------------------------------------------------------- sequence */

/** Longest first, so `-->>` is not read as `-->`. */
const MESSAGE = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*([^:]+?)\s*(?::\s*([\s\S]*))?$/;
const PARTICIPANT = /^(?:create\s+)?(participant|actor)\s+([\s\S]+?)(?:\s+as\s+([\s\S]+))?$/i;

const MESSAGE_KINDS: Record<string, MessageKind> = {
  "->>": "sync",
  "->": "sync",
  "-x": "sync",
  "<<->>": "sync",
  "-->>": "return",
  "-->": "return",
  "--x": "return",
  "<<-->>": "return",
  "-)": "async",
  "--)": "async",
};

/** Statements with no counterpart in our sequence builder, by the name reported to the user. */
const SKIPPED_SEQUENCE: Record<string, string> = {
  note: "Note",
  loop: "loop",
  alt: "alt",
  else: "else",
  opt: "opt",
  par: "par",
  and: "and",
  critical: "critical",
  option: "option",
  break: "break",
  rect: "rect",
  box: "box",
  autonumber: "autonumber",
  activate: "activate",
  deactivate: "deactivate",
  destroy: "destroy",
  link: "link",
  links: "links",
  properties: "properties",
};

/** Understood but carrying nothing we keep: block ends and titles. */
const SILENT_SEQUENCE = new Set(["end", "title", "acctitle", "accdescr"]);

function importSequence(lines: string[]): MermaidImport {
  const participants = new Map<string, SequenceParticipant>();
  const messages: SequenceMessage[] = [];
  const skipped = new Map<string, number>();
  const unparsed: string[] = [];

  const participant = (id: string): string => {
    if (!participants.has(id)) participants.set(id, { id, name: id });
    return id;
  };

  for (const raw of lines) {
    const line = raw.replace(/;$/, "").trim();
    // A keyword stands alone or before a space or colon; `loop->>A` is a message from a participant called "loop".
    const keyword = /^([A-Za-z]+)(?=[\s:]|$)/.exec(line)?.[1].toLowerCase() ?? "";
    const declared = PARTICIPANT.exec(line);
    const message = MESSAGE.exec(line);
    if (declared) {
      const id = declared[2].replace(/@\{[\s\S]*\}$/, "").trim();
      const kind = declared[1].toLowerCase() === "actor" ? "actor" : "participant";
      participants.set(id, { ...participants.get(id), id, name: decodeText(declared[3] ?? id) || id, kind });
    } else if (SILENT_SEQUENCE.has(keyword)) {
      continue;
    } else if (SKIPPED_SEQUENCE[keyword]) {
      skipped.set(SKIPPED_SEQUENCE[keyword], (skipped.get(SKIPPED_SEQUENCE[keyword]) ?? 0) + 1);
    } else if (message) {
      const text = decodeText(message[4] ?? "");
      messages.push({ from: participant(message[1].trim()), to: participant(message[3].trim()), kind: MESSAGE_KINDS[message[2]], ...(text ? { text } : {}) });
    } else {
      unparsed.push(line);
    }
  }

  const warnings: string[] = [];
  if (skipped.size) {
    const list = [...skipped].map(([name, count]) => `${name} (${count})`).join(", ");
    warnings.push(`Sequence statements without an equivalent were skipped: ${list}. Messages inside loop/alt/opt/par blocks were kept.`);
  }
  if (unparsed.length) warnings.push(unparsedWarning(unparsed));
  return {
    kind: "sequence",
    spec: { nodes: [], edges: [] },
    sequence: { participants: [...participants.values()], messages },
    warnings,
  };
}

/* -------------------------------------------------------------------- entry */

/**
 * Reads Mermaid text.
 *
 * - `flowchart` / `graph`: nodes (all classic bracket shapes and the
 *   `id@{ shape, label }` form), chained links with labels, `&` fan-out,
 *   nested `subgraph`s as `basic/group` containers, and fill / stroke / text
 *   colours from `style`, `classDef` and `class`. Nodes carry no position or
 *   size: lay the result out after applying it. `linkStyle`, `click` and
 *   `direction` inside subgraphs are ignored.
 * - `sequenceDiagram`: participants, actors and messages, returned in
 *   `sequence` for `buildSequence` (with an empty `spec`). Notes, activations,
 *   `autonumber` and block statements (`loop`, `alt`, …) are skipped and
 *   reported once; the messages inside blocks are kept.
 *
 * Any other diagram type yields an empty spec and a warning. Never throws.
 */
export function importMermaid(source: string): MermaidImport {
  try {
    const lines = sourceLines(typeof source === "string" ? source : "");
    if (!lines.length) return emptyImport(`The Mermaid source is empty. ${SUPPORTED}`);

    const [header, ...body] = lines;
    if (/^sequenceDiagram\b/.test(header)) return importSequence(body);

    const flowchart = /^(?:flowchart(?:-elk)?|graph)(?![A-Za-z])\s*([A-Za-z]{2}\b)?\s*;?([\s\S]*)$/.exec(header);
    if (!flowchart) {
      const type = /^[A-Za-z][\w-]*/.exec(header)?.[0];
      return emptyImport(type ? `Unsupported Mermaid diagram type "${type}". ${SUPPORTED}` : `This does not look like a Mermaid diagram. ${SUPPORTED}`);
    }
    const direction = FLOW_DIRECTIONS[(flowchart[1] ?? "").toUpperCase()];
    const statements = [flowchart[2], ...body].flatMap(splitStatements);
    return importFlowchart(statements, direction);
  } catch (error) {
    return emptyImport(`The Mermaid source could not be read. ${error instanceof Error ? error.message : String(error)}`);
  }
}
