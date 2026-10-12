import type { ImportDiagnostic } from "../code/types";
import { normalizeColor } from "../model/palette";
import type { LayoutDirection } from "../model/types";
import type { EdgeSpec, ElementsSpec, NodeSpec } from "../spec/apply";
import type { MessageKind, SequenceMessage, SequenceParticipant, SequenceSpec } from "../spec/sequence";

/**
 * PlantUML import: a documented subset of the text format, enough for the
 * diagrams people paste from documentation and chat.
 *
 * Supported (see `docs/code-editor.md` for the syntax table):
 * sequence diagrams, class / object diagrams, use case diagrams, simple
 * component and deployment diagrams, and activity diagrams in the new syntax
 * (`start`, `:action;`, `if` / `while` / `repeat` / `fork`).
 *
 * The importer is deliberately forgiving. What it cannot represent is skipped
 * and reported once, in a single aggregated warning; `diagnostics` carries the
 * same information line by line for the editor. It never throws.
 */

export type PlantUmlKind = "sequence" | "class" | "usecase" | "activity" | "component";

export interface PlantUmlImport {
  /** `unknown` when the text holds no diagram this importer reads (`warnings` says why). */
  kind: PlantUmlKind | "unknown";
  /** Elements without positions. Empty for sequence diagrams. */
  spec: ElementsSpec;
  /** Participants and messages, for `buildSequence`. Only set when `kind` is `"sequence"`. */
  sequence?: SequenceSpec;
  /** From `left to right direction` / `top to bottom direction`. */
  direction?: LayoutDirection;
  /** Everything that was skipped or simplified, phrased for the user. */
  warnings: string[];
  /** The same findings per line, for highlighting in the editor. */
  diagnostics: ImportDiagnostic[];
}

const SUPPORTED = "Supported: sequence, class, use case, component / deployment and activity diagrams.";

/** Longest line the pattern matching below is applied to; longer ones are reported as unreadable. */
const MAX_LINE = 1000;
const MAX_LINES = 20000;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
const clip = (text: string, length = 40): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/* ========================================================== shared plumbing */

interface Line {
  /** 1-based line number in the source. */
  no: number;
  text: string;
  /** From a `' @id name` comment on the line before: the id the element this line creates should get. */
  id?: string;
}

/** Collects what is skipped, so it can be reported once. */
class Findings {
  readonly diagnostics: ImportDiagnostic[] = [];
  readonly extra: string[] = [];
  private readonly unsupported = new Map<string, number>();
  private readonly unreadable: Line[] = [];
  private readonly flattened = new Map<string, number>();

  /** A construct that is valid PlantUML but has no counterpart here. */
  skip(line: number, label: string): void {
    this.unsupported.set(label, (this.unsupported.get(label) ?? 0) + 1);
    this.diagnostics.push({ line, severity: "warning", message: `Not supported, ignored: ${label}` });
  }

  /** A line that matches no syntax this importer knows. */
  unread(line: Line): void {
    this.unreadable.push(line);
    this.diagnostics.push({ line: line.no, severity: "error", message: `Could not be understood: ${clip(line.text, 60)}` });
  }

  flatten(line: number, label: string): void {
    this.flattened.set(label, (this.flattened.get(label) ?? 0) + 1);
    this.diagnostics.push({ line, severity: "warning", message: `Block flattened: ${label}` });
  }

  warnings(): string[] {
    const out = [...this.extra];
    const times = (map: Map<string, number>): string =>
      [...map].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join(", ");
    if (this.flattened.size) {
      out.push(`Blocks were flattened: ${times(this.flattened)}. Their messages are drawn in order, without the frame.`);
    }
    const unsupportedCount = [...this.unsupported.values()].reduce((sum, count) => sum + count, 0);
    const total = unsupportedCount + this.unreadable.length;
    if (total) {
      const parts: string[] = [];
      if (unsupportedCount) parts.push(`unsupported: ${times(this.unsupported)}`);
      if (this.unreadable.length) {
        const shown = this.unreadable.slice(0, 3).map((line) => `line ${line.no} "${clip(line.text)}"`);
        const more = this.unreadable.length > shown.length ? ` and ${this.unreadable.length - shown.length} more` : "";
        parts.push(`not understood: ${shown.join(", ")}${more}`);
      }
      out.push(`${plural(total, "line")} ignored (${parts.join("; ")}).`);
    }
    return out;
  }
}

/** Readable, path-safe element ids that stay the same as long as the source name does. */
class IdMint {
  private readonly taken = new Set<string>();
  private readonly reserved = new Set<string>();

  private static clean(raw: string): string {
    return raw
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_.:-]+/g, "-")
      .replace(/^[^A-Za-z0-9]+/, "")
      .replace(/-+$/, "")
      .slice(0, 40);
  }

  /** Keeps `raw` free for the element that asks for it by name (`claim`), so generated ids go around it. */
  reserve(raw: string): void {
    const id = IdMint.clean(raw);
    if (id) this.reserved.add(id);
  }

  /** The id an element asked for in a `' @id` comment, unless another element already holds it. */
  claim(raw: string, fallback: string): string {
    const id = IdMint.clean(raw);
    if (id && !this.taken.has(id)) {
      this.taken.add(id);
      return id;
    }
    return this.next(raw, fallback);
  }

  next(raw: string, fallback: string): string {
    const base = IdMint.clean(raw) || fallback;
    let candidate = base;
    for (let i = 2; this.taken.has(candidate) || this.reserved.has(candidate); i++) candidate = `${base}-${i}`;
    this.taken.add(candidate);
    return candidate;
  }
}

const unquote = (token: string): string => (token.length >= 2 && token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token);

/** Label text: `\n` and `<br>` break lines, other HTML tags and `**` emphasis are dropped. */
function labelText(raw: string): string {
  return raw
    .replace(/\\n|%n\(\)|<br\s*\/?>/gi, "\n")
    .replace(/<<\s*([^<>]+?)\s*>>/g, "«$1»")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

const COLOR_NAMES: Record<string, string> = {
  red: "red",
  lightcoral: "red",
  salmon: "red",
  pink: "pink",
  lightpink: "pink",
  blue: "blue",
  lightblue: "blue",
  skyblue: "blue",
  cyan: "teal",
  aqua: "teal",
  teal: "teal",
  green: "green",
  lightgreen: "green",
  palegreen: "green",
  yellow: "yellow",
  lightyellow: "yellow",
  gold: "yellow",
  orange: "orange",
  purple: "purple",
  violet: "purple",
  gray: "gray",
  grey: "gray",
  lightgray: "gray",
  lightgrey: "gray",
  silver: "gray",
  black: "dark",
};

/** `#palegreen`, `#FFAA00`, `#red;line:blue` → a palette name or hex colour; undefined for anything else. */
function colorOf(raw: string): string | undefined {
  const value = raw.replace(/^#/, "").split(/[;|/\\,]/)[0].trim().toLowerCase();
  return COLOR_NAMES[value] ?? normalizeColor(`#${value}`);
}

/* ======================================================== source preparation */

interface Prepared {
  lines: Line[];
  /** Name after `@start`; `uml` when there is no marker at all. */
  type: string;
  /** Diagrams after the first one in the same text. */
  extraDiagrams: number;
  direction?: LayoutDirection;
  /** Names of notes declared with `note … as Name`; relations to them are dropped. */
  noteNames: Set<string>;
}

/** Block comments `/' … '/` removed, keeping line numbers intact. */
function stripBlockComments(source: string): string {
  let out = "";
  let inside = false;
  for (let i = 0; i < source.length; i++) {
    const pair = source.slice(i, i + 2);
    if (!inside && pair === "/'") {
      inside = true;
      i++;
    } else if (inside && pair === "'/") {
      inside = false;
      i++;
    } else if (!inside || source[i] === "\n") {
      out += source[i];
    }
  }
  return out;
}

const NOTE_START = /^(?:r|h)?note\b/i;

/**
 * Splits the text into the lines of the first diagram, dropping comments,
 * `skinparam`, titles and notes (reported through `findings` where they carry
 * something the diagram loses).
 */
function prepare(source: string, findings: Findings): Prepared {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const raw = stripBlockComments(text).split("\n").slice(0, MAX_LINES);
  const hasMarker = raw.some((line) => /^\s*@start/i.test(line));

  const lines: Line[] = [];
  const noteNames = new Set<string>();
  let type = "uml";
  let direction: LayoutDirection | undefined;
  let inside = !hasMarker;
  let pendingId: string | undefined;
  let started = false;
  let extraDiagrams = 0;
  /** While inside a block that is dropped as a whole: the line that ends it. */
  let blockEnd: RegExp | null = null;

  for (let i = 0; i < raw.length; i++) {
    const trimmed = raw[i].trim();
    const no = i + 1;

    const start = /^@start([a-z]+)/i.exec(trimmed);
    if (start) {
      if (!started) {
        started = true;
        inside = true;
        type = start[1].toLowerCase();
      } else {
        extraDiagrams++;
        inside = false;
      }
      continue;
    }
    if (/^@end[a-z]*/i.test(trimmed)) {
      inside = false;
      continue;
    }
    if (inside && trimmed.startsWith("'")) {
      const named = /^'\s*@id\s+(\S+)\s*$/.exec(trimmed);
      if (named) pendingId = named[1];
      continue;
    }
    if (!inside || !trimmed) continue;

    if (blockEnd) {
      if (blockEnd.test(trimmed)) blockEnd = null;
      continue;
    }

    // Blocks that span lines and are dropped whole.
    const lower = trimmed.toLowerCase();
    if (/^skinparam\b/.test(lower)) {
      if (trimmed.endsWith("{")) blockEnd = /^\}$/;
      continue;
    }
    if (/^title\b/.test(lower)) {
      if (lower === "title") blockEnd = /^end\s*title$/i;
      continue;
    }
    if (NOTE_START.test(trimmed)) {
      const alias = /\bas\s+([\w.$]+)\s*$/i.exec(trimmed) ?? /"\s+as\s+([\w.$]+)/i.exec(trimmed);
      if (alias) noteNames.add(alias[1]);
      findings.skip(no, "note");
      if (!trimmed.includes(":") && !/"/.test(trimmed)) blockEnd = /^end\s*(?:r|h)?note$/i;
      continue;
    }
    const container = /^(legend|header|footer|caption)\b/i.exec(trimmed);
    if (container) {
      const word = container[1].toLowerCase();
      findings.skip(no, word);
      // `legend` always spans lines; `header` and `footer` do when they stand alone.
      if (word === "legend" || (word !== "caption" && trimmed.length === word.length)) blockEnd = new RegExp(`^end\\s*${word}$`, "i");
      continue;
    }
    if (/^ref\s+over\b/i.test(trimmed)) {
      findings.skip(no, "ref");
      if (!trimmed.includes(":")) blockEnd = /^end\s*ref$/i;
      continue;
    }

    if (/^left\s+to\s+right\s+direction$/i.test(trimmed)) {
      direction = "right";
      continue;
    }
    if (/^top\s+to\s+bottom\s+direction$/i.test(trimmed)) {
      direction = "down";
      continue;
    }
    lines.push({ no, text: trimmed, ...(pendingId ? { id: pendingId } : {}) });
    pendingId = undefined;
  }
  return { lines, type, extraDiagrams, direction, noteNames };
}

/** Lines the structural and sequence parsers meet that are valid but carry nothing here, by label. */
const IGNORED_KEYWORD =
  /^(hide|show|set|remove|restore|scale|mainframe|newpage|autonumber|destroy|create|return|delay|label|goto|backward|detach|kill|port|portin|portout|swimlane|!\w+|\.\.\.|\|\|\||==)/i;

function ignoredLabel(text: string): string | undefined {
  const found = IGNORED_KEYWORD.exec(text);
  if (!found) return undefined;
  const label = found[1].toLowerCase();
  if (label === "==") return "divider";
  if (label === "...") return "delay";
  if (label === "|||") return "spacing";
  return label;
}

/* ============================================================ kind detection */

const SEQUENCE_STRONG =
  /^(?:participant\b|autonumber\b|activate\b|deactivate\b|alt\b|opt\b|loop\b|par\b|critical\b|break\b|group\b|return\b|box\b|create\b|destroy\b|\|\|\||\.\.\.|==)/i;
const CLASS_KEYWORD = /^(?:abstract\s+class|abstract|class|enum|annotation|struct|protocol|exception|metaclass|dataclass|object)\s+\S/i;
const COMPONENT_KEYWORD = /^(?:component|node|cloud|artifact|folder|frame|storage|file|card|stack|agent|hexagon|portin|portout|port)\s+\S/i;
const COMPONENT_INLINE = /^(?:\[[^\]]+\]|\(\)\s*\S+)/;
const USECASE_INLINE = /^(?:\(\s*[^()]+\)|:[^:]+:)(?:\s+as\s+\S+)?(?:\s|$)/;
const ACTIVITY_LINE = /^(?:start|stop|repeat|fork(?:\s+again)?|end\s*fork|end\s*merge|endif|endwhile|split(?:\s+again)?|end\s*split|if\s*\(.*|while\s*\(.*|partition\b.*|\|[^|]+\||#\w+:.*[;|<>/\]}]|:[\s\S]*[;|<>/\]}])$/i;

type Hints = {
  activity: number;
  sequence: number;
  /** Class-only keywords and member lines. */
  classes: number;
  /** Arrow heads only classes use (`<|--`, `*--`); use case and component diagrams share some. */
  classArrows: number;
  usecase: number;
  component: number;
  arrows: number;
  weak: Set<string>;
};

const WEAK_KEYWORDS = new Set(["actor", "database", "queue", "boundary", "control", "entity", "collections", "interface", "package", "rectangle", "namespace"]);

function gatherHints(lines: Line[]): Hints {
  const hints: Hints = { activity: 0, sequence: 0, classes: 0, classArrows: 0, usecase: 0, component: 0, arrows: 0, weak: new Set() };
  for (const { text } of lines) {
    if (text.length > MAX_LINE) continue;
    const word = /^([A-Za-z]+)\b/.exec(text)?.[1].toLowerCase() ?? "";
    if (ACTIVITY_LINE.test(text) && !USECASE_INLINE.test(text)) hints.activity++;
    if (SEQUENCE_STRONG.test(text) || /^note\s+over\b/i.test(text)) hints.sequence++;
    if (CLASS_KEYWORD.test(text)) hints.classes++;
    if (/^usecase\b/i.test(text)) hints.usecase++;
    if (COMPONENT_KEYWORD.test(text)) hints.component++;
    if (WEAK_KEYWORDS.has(word)) hints.weak.add(word);

    const relation = RELATION.exec(text);
    if (relation) {
      const [, left, , arrow, , right] = relation;
      const shape = ARROW_PARTS.exec(arrow);
      const heads = [shape?.[1], shape?.[3]];
      if (heads.some((head) => head === "<|" || head === "|>" || head === "*" || head === "o" || head === "^")) hints.classArrows++;
      for (const end of [left, right]) {
        if (/^\(\s*[^()]/.test(end) || /^:[^:]+:$/.test(end)) hints.usecase++;
        else if (/^\[[^\]]+\]$/.test(end) || /^\(\)/.test(end)) hints.component++;
      }
      hints.arrows++;
    } else if (COMPONENT_INLINE.test(text)) hints.component++;
    else if (USECASE_INLINE.test(text)) hints.usecase++;
    else if (/^[\w.$"]+(?:\s+"[^"]*")?\s*:\s*[+\-#~]?\s*\S/.test(text) && !DECLARATION.test(text) && !SEQUENCE_ARROW.test(text) && !ignoredLabel(text)) hints.classes++;

    if (SEQUENCE_ARROW.test(text) && /(>>|<<|[xo]\s|\\|\/\/?)/.test(text.replace(/\[[^\]]*\]/g, ""))) hints.sequence++;
  }
  return hints;
}

function detectKind(lines: Line[]): PlantUmlKind | undefined {
  const hints = gatherHints(lines);
  if (hints.activity > 0 && hints.classes === 0 && hints.sequence === 0) return "activity";
  if (hints.classes > 0) return "class";
  if (hints.usecase > 0) return "usecase";
  if (hints.component > 0) return "component";
  if (hints.classArrows > 0) return "class";
  if (hints.sequence > 0 || (hints.arrows > 0 && ![...hints.weak].some((w) => ["interface", "package", "rectangle", "namespace"].includes(w)))) {
    return "sequence";
  }
  if (hints.weak.has("interface")) return "class";
  if (hints.weak.has("actor")) return "usecase";
  if (hints.weak.size > 0 || hints.arrows > 0) return "component";
  return undefined;
}

/* ================================================================== sequence */

const PARTICIPANT_WORDS = "participant|actor|boundary|control|entity|database|collections|queue";
const PARTICIPANT = new RegExp(`^(${PARTICIPANT_WORDS})\\s+(.+)$`, "i");

/** Arrow heads: `-` bodies with `>`, `<`, `\`, `/` heads, `x` (lost) and `o` (circle), optional `[#color]` style. */
const SEQ_LEFT = String.raw`(?:<<?|\\{1,2}|\/{1,2})`;
const SEQ_RIGHT = String.raw`(?:>>?|\\{1,2}|\/{1,2}|x(?=\s|$)|o(?=\s|$))`;
const SEQ_BODY = String.raw`-{1,2}(?:\[[^\]]*\]-{0,2})?`;
const SEQ_ARROW_SOURCE = String.raw`(?:${SEQ_LEFT}${SEQ_BODY}${SEQ_RIGHT}?|${SEQ_BODY}${SEQ_RIGHT})(?:\+\+|--|\*\*|!!|[+*!-])?`;
const SEQ_NAME = String.raw`"[^"]+"|[^\s"<>\\/:]+`;
/** Activation markers may follow the target: `A -> B ++ : text`. */
const SEQ_ACTIVATION = String.raw`(?:\s*(?:\+\+|--|\*\*|!!)(?:\s*#\w+)?)?`;
const SEQUENCE_MESSAGE = new RegExp(String.raw`^(${SEQ_NAME}?)\s*(${SEQ_ARROW_SOURCE})\s*("[^"]+"|[^\s":]+?)${SEQ_ACTIVATION}\s*(?::\s*([\s\S]*))?$`);
const SEQUENCE_ARROW = new RegExp(String.raw`^(?:${SEQ_NAME}?)\s*${SEQ_ARROW_SOURCE}\s*(?:"[^"]+"|[^\s":]+)\s*(?::|$)`);
const SEQ_BLOCK = /^(alt|opt|loop|par|critical|break|group)(?=\s|$)/i;
const SEQ_BLOCK_PART = /^(else|and|end)\b/i;

function arrowKind(arrow: string): { kind: MessageKind; reversed: boolean } {
  const bare = arrow.replace(/\[[^\]]*\]/g, "");
  const dotted = /--/.test(bare.replace(/(--|\+\+|\*\*|!!)$/, ""));
  const left = /^(?:<|\\|\/)/.test(bare);
  const right = /(?:>|\\|\/|x|o)(?:\+\+|--|\*\*|!!|[+*!-])?$/.test(bare);
  const thin = />>|<</.test(bare);
  return { kind: dotted ? "return" : thin ? "async" : "sync", reversed: left && !right };
}

function parseSequence(lines: Line[], findings: Findings): SequenceSpec {
  const participants = new Map<string, SequenceParticipant>();
  const messages: SequenceMessage[] = [];

  const ensure = (key: string): string => {
    if (!participants.has(key)) participants.set(key, { id: key, name: key });
    return key;
  };

  for (const line of lines) {
    const { text } = line;
    if (text.length > MAX_LINE) {
      findings.unread(line);
      continue;
    }
    const declared = PARTICIPANT.exec(text);
    if (declared && !SEQUENCE_MESSAGE.test(text)) {
      const rest = declared[2].replace(/\s*<<.*?>>/g, "").replace(/\s+#[\w;|:#,/-]+/g, "").replace(/\s+order\s+\d+/i, "").trim();
      const found = /^("[^"]+"|[^\s"]+)(?:\s+as\s+("[^"]+"|[^\s"]+))?$/i.exec(rest);
      if (!found) {
        findings.unread(line);
        continue;
      }
      const first = found[1];
      const second = found[2];
      // `participant "Long name" as L` and `participant L as "Long name"` both name L by its alias.
      const aliasFirst = second !== undefined && !first.startsWith('"') && second.startsWith('"');
      const name = labelText(unquote(aliasFirst ? second : first));
      const key = unquote(second !== undefined && !aliasFirst ? second : first);
      const kind = declared[1].toLowerCase() === "actor" ? "actor" : "participant";
      participants.set(key, { ...participants.get(key), id: key, name: name || key, kind });
      continue;
    }

    const block = SEQ_BLOCK.exec(text);
    // `loop -> B` is a message from a participant that happens to be called "loop".
    if (block && !/^[-<>\\/]/.test(text.slice(block[0].length).trim())) {
      findings.flatten(line.no, block[1].toLowerCase());
      continue;
    }
    if (SEQ_BLOCK_PART.test(text)) continue;
    if (/^(?:activate|deactivate)\b/i.test(text)) continue;

    const message = SEQUENCE_MESSAGE.exec(text);
    if (message && message[1]) {
      const { kind, reversed } = arrowKind(message[2]);
      const a = ensure(unquote(message[1]));
      const b = ensure(unquote(message[3]));
      const label = labelText(message[4] ?? "");
      messages.push({ from: reversed ? b : a, to: reversed ? a : b, kind, ...(label ? { text: label } : {}) });
      continue;
    }

    const label = ignoredLabel(text);
    if (label) findings.skip(line.no, label);
    else if (/^\[?[-<>\\/]|[-<>\\/]\]?\s*(?::|$)/.test(text) && /\[|\]/.test(text)) findings.skip(line.no, "found message");
    else findings.unread(line);
  }

  return { participants: [...participants.values()], messages };
}

/* ========================================================= structure diagrams */

type StructureKind = "class" | "usecase" | "component";

interface KeywordDef {
  shape: string;
  /** Shape used when the element opens a `{ … }` block of children. */
  group?: string;
  /** Members listed in a body are attributes and operations. */
  members?: boolean;
  stereotype?: string;
  abstract?: boolean;
}

const KEYWORDS: Record<string, KeywordDef> = {
  class: { shape: "uml/class", members: true },
  abstract: { shape: "uml/class", members: true, abstract: true },
  "abstract class": { shape: "uml/class", members: true, abstract: true },
  interface: { shape: "uml/interface", members: true },
  enum: { shape: "uml/enum", members: true },
  annotation: { shape: "uml/class", members: true, stereotype: "annotation" },
  struct: { shape: "uml/class", members: true, stereotype: "struct" },
  protocol: { shape: "uml/class", members: true, stereotype: "protocol" },
  exception: { shape: "uml/class", members: true, stereotype: "exception" },
  metaclass: { shape: "uml/class", members: true, stereotype: "metaclass" },
  dataclass: { shape: "uml/class", members: true, stereotype: "dataclass" },
  object: { shape: "uml/object", members: true },
  component: { shape: "uml/component", group: "uml/package" },
  actor: { shape: "uml/actor" },
  usecase: { shape: "uml/use-case" },
  node: { shape: "uml/node", group: "uml/node" },
  cloud: { shape: "basic/cloud", group: "uml/node" },
  database: { shape: "basic/cylinder", group: "uml/node" },
  storage: { shape: "basic/cylinder", group: "uml/node" },
  queue: { shape: "basic/pill", group: "uml/package" },
  artifact: { shape: "uml/artifact", group: "uml/package" },
  file: { shape: "uml/artifact", group: "uml/package" },
  package: { shape: "uml/package", group: "uml/package" },
  namespace: { shape: "uml/package", group: "uml/package" },
  folder: { shape: "uml/package", group: "uml/package" },
  frame: { shape: "uml/package", group: "uml/package" },
  rectangle: { shape: "basic/rect", group: "uml/package" },
  card: { shape: "basic/rect", group: "uml/package" },
  stack: { shape: "basic/rect", group: "uml/package" },
  agent: { shape: "basic/rect", group: "uml/package" },
  label: { shape: "basic/rect", group: "uml/package" },
  hexagon: { shape: "basic/hexagon", group: "uml/package" },
  boundary: { shape: "uml/boundary" },
  control: { shape: "uml/control" },
  entity: { shape: "uml/class", members: true, stereotype: "entity" },
  collections: { shape: "basic/rect" },
  together: { shape: "" },
};

const DECLARATION = new RegExp(`^(abstract\\s+class|${Object.keys(KEYWORDS).filter((k) => k !== "abstract class").join("|")})\\b\\s*(.*)$`, "i");

/** Endpoint of a relation: `"Quoted"`, `(use case)`, `:actor:`, `[component]`, `() interface` or a bare name. */
const ENDPOINT = String.raw`(?:"[^"]+"|\([^()]+\)|:[^:]+:|\[[^\[\]]+\]|\(\)\s*(?:"[^"]+"|[^\s"]+)|[\w.$¡-￿]+(?:::[\w.$¡-￿]+)*)`;
const LEFT_DECORATION = String.raw`(?:<\||<|\*|o|#|x|\+|\^)`;
const RIGHT_DECORATION = String.raw`(?:\|>|>|\*|o|#|x|\+|\^)`;
const LINE_BODY = String.raw`(?:-\[[^\]]*\]-*|\.\[[^\]]*\]\.*|[-.=~]*-(?:up|down|left|right|u|d|l|r)-[-.=~]*|[-.=~]+)`;
const ARROW_SOURCE = `${LEFT_DECORATION}?${LINE_BODY}${RIGHT_DECORATION}?`;
/** Groups: 1 left endpoint, 2 left multiplicity, 3 arrow, 4 right multiplicity, 5 right endpoint, 6 label. */
const RELATION = new RegExp(String.raw`^(${ENDPOINT})(?:\s+"([^"]*)")?\s*(${ARROW_SOURCE})\s*(?:"([^"]*)"\s+)?(${ENDPOINT})(?:\s*:\s*([\s\S]*))?$`);
/** Groups: 1 left decoration, 2 body, 3 right decoration. */
const ARROW_PARTS = new RegExp(String.raw`^(${LEFT_DECORATION}?)(${LINE_BODY})(${RIGHT_DECORATION}?)$`);

interface Entity {
  key: string;
  id: string;
  shape: string;
  title: string;
  stereotype?: string;
  attributes: string[];
  operations: string[];
  members: boolean;
  abstract: boolean;
  color?: string;
  parent?: Entity;
  container: boolean;
}

type Frame = { type: "body"; entity: Entity } | { type: "group"; entity?: Entity } | { type: "skip" };

interface Declared {
  name: string;
  alias?: string;
  stereotype?: string;
  color?: string;
  opens: boolean;
  extendsNames: string[];
  implementsNames: string[];
}

/** The part of a declaration after its keyword: name, alias, `<<stereotype>>`, `#color`, `extends`, `{`. */
function readDeclared(rest: string): Declared | undefined {
  let text = rest.trim();
  let opens = false;
  if (text.endsWith("{}")) text = text.slice(0, -2).trim();
  else if (text.endsWith("{")) {
    opens = true;
    text = text.slice(0, -1).trim();
  }
  let stereotype: string | undefined;
  text = text.replace(/\s*<<\s*(.*?)\s*>>/, (_all, name: string) => {
    stereotype = name.replace(/^\(.\s*,\s*#?\w+\)\s*/, "").trim() || undefined;
    return "";
  });
  text = text.replace(/\s*\[\[[^\]]*\]\]/g, "");
  let color: string | undefined;
  text = text.replace(/\s+(#[\w#;|:,/\\-]+)\s*$/, (_all, value: string) => {
    color = colorOf(value);
    return "";
  });
  const extendsNames: string[] = [];
  const implementsNames: string[] = [];
  text = text.replace(/\s+implements\s+([\w.$,\s]+?)(?=\s+extends\b|$)/i, (_all, list: string) => {
    implementsNames.push(...list.split(",").map((name) => name.trim()).filter(Boolean));
    return "";
  });
  text = text.replace(/\s+extends\s+([\w.$,\s]+?)(?=\s+implements\b|$)/i, (_all, list: string) => {
    extendsNames.push(...list.split(",").map((name) => name.trim()).filter(Boolean));
    return "";
  });
  text = text.trim();
  if (!text) return undefined;

  const found = /^("[^"]+"|[^\s"]+)(?:\s+as\s+("[^"]+"|[^\s"]+))?$/i.exec(text);
  if (!found) return { name: unquote(text), stereotype, color, opens, extendsNames, implementsNames };
  const first = found[1];
  const second = found[2];
  if (second === undefined) return { name: unquote(first), stereotype, color, opens, extendsNames, implementsNames };
  const aliasFirst = !first.startsWith('"') && second.startsWith('"');
  return {
    name: unquote(aliasFirst ? second : first),
    alias: unquote(aliasFirst ? first : second),
    stereotype,
    color,
    opens,
    extendsNames,
    implementsNames,
  };
}

/** Attribute / operation line of a class body. Undefined for separators. */
function readMember(raw: string): { text: string; method: boolean } | undefined {
  if (/^(?:--|==|\.\.|__)(?:.*(?:--|==|\.\.|__))?$/.test(raw)) return undefined;
  let method: boolean | undefined;
  const text = raw
    .replace(/\{(static|abstract|classifier|field|method)\}/gi, (_all, modifier: string) => {
      if (modifier.toLowerCase() === "field") method = false;
      if (modifier.toLowerCase() === "method") method = true;
      return "";
    })
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return { text, method: method ?? text.includes("(") };
}

interface Relation {
  from: Entity;
  to: Entity;
  kind: string;
  text?: string;
  startText?: string;
  endText?: string;
}

class StructureParser {
  private readonly entities = new Map<string, Entity>();
  private readonly ordered: Entity[] = [];
  private readonly relations: Relation[] = [];
  private readonly ids = new IdMint();
  private readonly frames: Frame[] = [];
  /** The element declared last, which a `{` on the next line opens. */
  private last: { entity: Entity; def: KeywordDef } | undefined;
  private hiddenLinks = 0;

  constructor(
    private readonly kind: StructureKind,
    private readonly findings: Findings,
    private readonly noteNames: Set<string>,
  ) {}

  parse(lines: Line[]): ElementsSpec {
    for (const line of lines) {
      try {
        this.line(line);
      } catch {
        this.findings.unread(line);
      }
    }
    return this.spec();
  }

  /* -------------------------------------------------------------- lines */

  private line(line: Line): void {
    const { text } = line;
    if (text.length > MAX_LINE) return this.findings.unread(line);

    const top = this.frames[this.frames.length - 1];
    if (text === "}") {
      this.frames.pop();
      return;
    }
    if (text === "{") {
      this.open(this.last);
      this.last = undefined;
      return;
    }
    if (top?.type === "skip") {
      if (text.endsWith("{")) this.frames.push({ type: "skip" });
      return;
    }
    if (top?.type === "body") return this.member(top.entity, text);

    const relation = RELATION.exec(text);
    if (relation) return this.relation(relation, line);

    const declaration = DECLARATION.exec(text);
    if (declaration && !/^(?:->|-->|\.\.|--)/.test(declaration[2])) return this.declaration(declaration[1].toLowerCase().replace(/\s+/g, " "), declaration[2], line);

    const inline = /^(:[^:]+:|\([^()]+\)|\[[^\]]+\]|\(\)\s*(?:"[^"]+"|[^\s"]+))(?:\s+as\s+("[^"]+"|[^\s"]+))?(?:\s*<<.*?>>)?(?:\s+#[\w#;|:,/\\-]+)?(\s*\{)?$/.exec(text);
    if (inline) {
      const entity = this.endpoint(inline[1], inline[2] ? unquote(inline[2]) : undefined);
      if (inline[3]) this.open({ entity, def: { shape: entity.shape, group: "uml/package" } });
      else this.last = { entity, def: { shape: entity.shape, group: "uml/package" } };
      return;
    }

    const memberOutside = /^("[^"]+"|[\w.$¡-￿]+(?:::[\w.$¡-￿]+)*)\s*:\s*(.+)$/.exec(text);
    if (memberOutside) {
      const entity = this.resolve(unquote(memberOutside[1]));
      this.member(entity, memberOutside[2]);
      return;
    }

    const label = ignoredLabel(text);
    if (label) {
      this.findings.skip(line.no, label);
      if (text.endsWith("{")) this.frames.push({ type: "skip" });
      return;
    }
    if (text.endsWith("{")) {
      this.findings.skip(line.no, /^\w+/.exec(text)?.[0].toLowerCase() ?? "block");
      this.frames.push({ type: "skip" });
      return;
    }
    this.findings.unread(line);
  }

  /* ---------------------------------------------------------- elements */

  private defaultShape(): string {
    return this.kind === "class" ? "uml/class" : this.kind === "usecase" ? "uml/actor" : "uml/component";
  }

  private create(key: string, title: string, shape: string, extra: Partial<Entity> = {}): Entity {
    const entity: Entity = {
      key,
      id: this.ids.next(key, shape.split("/").pop() ?? "node"),
      shape,
      title,
      attributes: [],
      operations: [],
      members: shape === "uml/class" || shape === "uml/interface" || shape === "uml/enum" || shape === "uml/object",
      abstract: false,
      container: false,
      parent: this.currentGroup(),
      ...extra,
    };
    this.entities.set(key, entity);
    this.ordered.push(entity);
    return entity;
  }

  private currentGroup(): Entity | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i];
      if (frame.type === "group" && frame.entity) return frame.entity;
    }
    return undefined;
  }

  /** The element a name refers to, created with the diagram's default shape on first mention. */
  private resolve(key: string, shape?: string, title = key): Entity {
    const existing = this.entities.get(key);
    if (existing) return existing;
    return this.create(key, title, shape ?? this.defaultShape());
  }

  /** `(use case)`, `:actor:`, `[component]`, `() interface`, `"quoted"` or a bare name. */
  private endpoint(token: string, alias?: string): Entity {
    let name = token;
    let shape: string | undefined;
    if (token.startsWith("(") && token !== "()" && !token.startsWith("()")) {
      name = token.slice(1, -1).trim();
      shape = "uml/use-case";
    } else if (token.startsWith("()")) {
      name = unquote(token.slice(2).trim());
      shape = "uml/interface";
    } else if (token.startsWith(":") && token.endsWith(":")) {
      name = token.slice(1, -1).trim();
      shape = "uml/actor";
    } else if (token.startsWith("[")) {
      name = token.slice(1, -1).trim();
      shape = "uml/component";
    } else if (token.startsWith('"')) name = unquote(token);
    const key = alias ?? name;
    const existing = this.entities.get(key) ?? this.entities.get(name);
    if (existing) {
      if (alias) this.entities.set(alias, existing);
      return existing;
    }
    const entity = this.create(key, labelText(name), shape ?? this.defaultShape());
    if (alias) this.entities.set(name, entity);
    return entity;
  }

  private declaration(keyword: string, rest: string, line: Line): void {
    const def = KEYWORDS[keyword];
    if (!def) return this.findings.unread(line);
    const declared = readDeclared(rest);
    if (keyword === "together") {
      if (rest.trim().endsWith("{")) this.frames.push({ type: "group" });
      return;
    }
    if (!declared) return this.findings.unread(line);

    let shape = def.shape;
    if (this.kind === "usecase" && (keyword === "rectangle" || keyword === "package" || keyword === "frame")) shape = def.group ?? shape;
    if (keyword === "entity" && this.kind !== "class") shape = "uml/entity";
    // `usecase (Pay)`, `component [API]` and `actor :Admin:` carry their delimiters in the name.
    const name = declared.name.replace(/^\(([^()]+)\)$|^\[([^[\]]+)\]$|^:([^:]+):$/, (_all, a?: string, b?: string, c?: string) => a ?? b ?? c ?? "");
    const key = declared.alias ?? name;
    const existing = this.entities.get(key);
    const entity = existing ?? this.create(key, labelText(name), shape);
    if (existing) {
      existing.shape = shape;
      existing.title = labelText(name);
    }
    if (declared.alias) this.entities.set(name, entity);
    entity.members = def.members ?? entity.members;
    entity.abstract = def.abstract ?? entity.abstract;
    entity.stereotype = declared.stereotype ?? def.stereotype ?? entity.stereotype;
    entity.color = declared.color ?? entity.color;

    for (const parent of declared.extendsNames) this.relations.push({ from: entity, to: this.resolve(parent), kind: "inheritance" });
    for (const contract of declared.implementsNames) this.relations.push({ from: entity, to: this.resolve(contract), kind: "implementation" });

    const lineEndsOpen = declared.opens;
    if (lineEndsOpen) this.open({ entity, def });
    else this.last = { entity, def };
  }

  private open(target: { entity: Entity; def: KeywordDef } | undefined): void {
    if (!target) {
      this.frames.push({ type: "skip" });
      return;
    }
    const { entity, def } = target;
    if (def.members) this.frames.push({ type: "body", entity });
    else if (def.group || def.shape === "") {
      if (def.group && entity.shape !== def.group && this.kind !== "usecase") entity.shape = def.group;
      if (this.kind === "usecase" && /^(?:basic\/rect|uml\/package)$/.test(entity.shape)) entity.shape = "uml/system-boundary";
      entity.container = true;
      this.frames.push({ type: "group", entity });
    } else this.frames.push({ type: "skip" });
  }

  private member(entity: Entity, raw: string): void {
    const member = readMember(raw);
    if (!member) return;
    entity.members = true;
    (member.method ? entity.operations : entity.attributes).push(member.text);
  }

  /* --------------------------------------------------------- relations */

  private relation(found: RegExpExecArray, line: Line): void {
    const [, leftToken, leftMultiplicity, arrow, rightMultiplicity, rightToken, rawLabel] = found;
    const parts = ARROW_PARTS.exec(arrow);
    if (!parts) return this.findings.unread(line);
    const [, leftDecoration, body, rightDecoration] = parts;

    const names = [leftToken, rightToken].map((token) => unquote(token));
    if (names.some((name) => this.noteNames.has(name))) return this.findings.skip(line.no, "note link");
    if (/hidden/i.test(body)) {
      this.hiddenLinks++;
      return;
    }

    const left = this.endpoint(leftToken);
    const right = this.endpoint(rightToken);
    const dashed = body.includes(".");
    let from = left;
    let to = right;
    let kind: string;

    const inheritance = leftDecoration === "<|" || leftDecoration === "^" ? "left" : rightDecoration === "|>" || rightDecoration === "^" ? "right" : undefined;
    const composition = leftDecoration === "*" ? "left" : rightDecoration === "*" ? "right" : undefined;
    const aggregation = leftDecoration === "o" ? "left" : rightDecoration === "o" ? "right" : undefined;
    if (inheritance) {
      // The decorated end is the parent; the edge runs child → parent.
      [from, to] = inheritance === "left" ? [right, left] : [left, right];
      kind = dashed ? "implementation" : "inheritance";
    } else if (composition || aggregation) {
      const wholeOnLeft = (composition ?? aggregation) === "left";
      [from, to] = wholeOnLeft ? [left, right] : [right, left];
      kind = composition ? "composition" : "aggregation";
    } else if (leftDecoration === "<" && rightDecoration === ">") {
      kind = "bidirectional";
    } else if (leftDecoration === "<") {
      [from, to] = [right, left];
      kind = dashed ? "dependency" : "association";
    } else if (rightDecoration === ">") {
      kind = dashed ? "dependency" : "association";
    } else {
      kind = dashed ? "dotted" : "line";
    }

    let text = rawLabel === undefined ? undefined : labelText(rawLabel.replace(/^\s*[<>]\s+|\s+[<>]\s*$/g, ""));
    if (this.kind === "usecase" && kind === "dependency") {
      const stereotype = /^(?:«|<<)?\s*(include|extend)s?\s*(?:»|>>)?$/i.exec(text ?? "");
      if (stereotype) {
        kind = "include";
        text = `«${stereotype[1].toLowerCase()}»`;
      }
    }

    const swapped = from !== left;
    const startText = (swapped ? rightMultiplicity : leftMultiplicity) || undefined;
    const endText = (swapped ? leftMultiplicity : rightMultiplicity) || undefined;
    this.relations.push({
      from,
      to,
      kind,
      ...(text ? { text } : {}),
      ...(startText ? { startText } : {}),
      ...(endText ? { endText } : {}),
    });
  }

  /* -------------------------------------------------------------- output */

  private nodeText(entity: Entity): string {
    const head = [entity.stereotype && entity.shape !== "uml/interface" && entity.shape !== "uml/enum" ? `«${entity.stereotype}»` : "", entity.title]
      .filter(Boolean)
      .join("\n");
    if (entity.shape === "uml/interface" || entity.shape === "uml/enum") {
      const body = [...entity.attributes, ...entity.operations];
      return body.length ? `${entity.title}\n---\n${body.join("\n")}` : entity.title;
    }
    if (entity.shape === "uml/class" || entity.shape === "uml/object") {
      if (!entity.attributes.length && !entity.operations.length) return head;
      return `${head}\n---\n${entity.attributes.join("\n")}${entity.operations.length ? `\n---\n${entity.operations.join("\n")}` : ""}`;
    }
    return entity.stereotype ? `«${entity.stereotype}»\n${entity.title}` : entity.title;
  }

  private spec(): ElementsSpec {
    // A container never contains itself, however the source nests blocks.
    const nodes: NodeSpec[] = this.ordered.map((entity) => ({
      id: entity.id,
      shape: entity.shape,
      text: this.nodeText(entity),
      ...(entity.parent && entity.parent !== entity ? { parent: entity.parent.id } : {}),
      ...(entity.color ? { color: entity.color } : {}),
      ...(entity.abstract ? { data: { abstract: true } } : {}),
    }));
    const edges: EdgeSpec[] = this.relations.map((relation) => ({
      from: relation.from.id,
      to: relation.to.id,
      kind: relation.kind,
      ...(relation.text ? { text: relation.text } : {}),
      ...(relation.startText ? { startText: relation.startText } : {}),
      ...(relation.endText ? { endText: relation.endText } : {}),
    }));
    return { nodes, edges };
  }
}

/* ================================================================== activity */

interface Tail {
  from: string;
  label?: string;
}

type ActivityFrame =
  | { type: "if"; decision: string; collected: Tail[]; hasElse: boolean; fromElseif: boolean }
  | { type: "while"; decision: string; exit?: string }
  | { type: "repeat"; start: string }
  | { type: "fork"; bar: string; branches: Tail[] }
  | { type: "block" };

const ACTION_END = /[;|<>/\]}]$/;

class ActivityParser {
  private readonly nodes: NodeSpec[] = [];
  private readonly edges: EdgeSpec[] = [];
  private readonly ids = new IdMint();
  private readonly frames: ActivityFrame[] = [];
  /** Where the flow continues: the nodes whose next step is the next node created. */
  private tails: Tail[] = [];
  /** The `' @id` name of the line being read, until the node it creates takes it. */
  private forced: string | undefined;

  constructor(private readonly findings: Findings) {}

  parse(lines: Line[]): ElementsSpec {
    // Named elements keep their ids; everything else is numbered around them.
    for (const line of lines) if (line.id) this.ids.reserve(line.id);
    let action: { no: number; parts: string[]; color?: string } | undefined;
    for (const line of lines) {
      if (!action) this.forced = line.id;
      try {
        if (action) {
          action.parts.push(line.text);
          if (ACTION_END.test(line.text)) {
            this.action(action.parts.join("\n"), action.color);
            action = undefined;
          }
          continue;
        }
        const started = /^(?:#(\w+))?:([\s\S]*)$/.exec(line.text);
        if (started) {
          if (ACTION_END.test(started[2]) && started[2].length > 0) this.action(started[2], started[1]);
          else action = { no: line.no, parts: [started[2]], color: started[1] };
          continue;
        }
        this.statement(line);
      } catch {
        this.findings.unread(line);
      }
    }
    return { nodes: this.nodes, edges: this.edges };
  }

  private add(shape: string, text: string | undefined, idHint: string, extra: Partial<NodeSpec> = {}): string {
    const fallback = shape.split("/").pop() ?? "node";
    const id = this.forced ? this.ids.claim(this.forced, fallback) : this.ids.next(idHint, fallback);
    this.forced = undefined;
    this.nodes.push({ id, shape, ...(text ? { text } : {}), ...extra });
    for (const tail of this.tails) {
      if (tail.from === id) continue;
      this.edges.push({ from: tail.from, to: id, ...(tail.label ? { text: tail.label } : {}) });
    }
    this.tails = [{ from: id }];
    return id;
  }

  /** A decision with its condition inside the diamond, so the text never collides with the branches leaving it. */
  private decision(condition: string): string {
    return condition ? this.add("flowchart/decision", condition, `d-${condition}`) : this.add("uml/choice", undefined, "merge");
  }

  private action(raw: string, color?: string): void {
    const text = labelText(raw.replace(ACTION_END, ""));
    const paletteColor = color ? colorOf(`#${color}`) : undefined;
    this.add("uml/action", text, `a-${text.split("\n")[0]}`, paletteColor ? { color: paletteColor } : {});
  }

  private statement(line: Line): void {
    const { text } = line;
    const lower = text.toLowerCase().replace(/\s+/g, " ");

    if (lower === "start") return void this.add("uml/initial-state", undefined, "start");
    if (lower === "stop") {
      this.add("uml/activity-final", undefined, "stop");
      this.tails = [];
      return;
    }
    if (lower === "end") {
      this.add("uml/flow-final", undefined, "end");
      this.tails = [];
      return;
    }
    if (lower === "detach" || lower === "kill") {
      this.tails = [];
      return;
    }

    const branch = /^(if|elseif|else|while|repeat while|repeat|endif|endwhile|end ?fork|end ?merge|fork again|fork|split again|split|end ?split)\b\s*(.*)$/i.exec(text);
    if (branch) {
      const word = branch[1].toLowerCase().replace(/\s+/g, " ");
      const rest = branch[2].trim();
      switch (word) {
        case "if":
          return this.openIf(rest, false);
        case "elseif":
          return this.elseIf(rest);
        case "else":
          return this.elseBranch(rest);
        case "endif":
          return this.closeIf();
        case "while":
          return this.openWhile(rest);
        case "endwhile":
          return this.closeWhile(rest);
        case "repeat":
          return this.openRepeat();
        case "repeat while":
          return this.closeRepeat(rest);
        case "fork":
        case "split":
          return this.openFork();
        case "fork again":
        case "split again":
          return this.forkAgain();
        default:
          return this.closeFork();
      }
    }

    if (/^partition\b|^group\b|^rectangle\b|^card\b/i.test(text) && text.endsWith("{")) {
      this.findings.skip(line.no, "partition");
      this.frames.push({ type: "block" });
      return;
    }
    if (text === "}") {
      if (this.frames[this.frames.length - 1]?.type === "block") this.frames.pop();
      return;
    }
    const label = ignoredLabel(text);
    if (label) return this.findings.skip(line.no, label);
    if (/^\|[^|]+\|$/.test(text)) return this.findings.skip(line.no, "swimlane");
    this.findings.unread(line);
  }

  /** `(label)` at the start of `text`, and what follows it. */
  private static parenthesised(text: string): { inner: string; rest: string } | undefined {
    if (!text.startsWith("(")) return undefined;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) return { inner: text.slice(1, i).trim(), rest: text.slice(i + 1).trim() };
    }
    return undefined;
  }

  private condition(rest: string): { cond: string; after: string } {
    const found = ActivityParser.parenthesised(rest);
    return found ? { cond: labelText(unquote(found.inner)), after: found.rest } : { cond: labelText(rest), after: "" };
  }

  private static branchLabel(text: string): string | undefined {
    const found = ActivityParser.parenthesised(text.replace(/^(?:then|is|equals|not)\s*/i, ""));
    return found ? labelText(found.inner) || undefined : undefined;
  }

  /* ----------------------------------------------------------- branches */

  private openIf(rest: string, fromElseif: boolean): void {
    const { cond, after } = this.condition(rest);
    const decision = this.decision(cond);
    this.frames.push({ type: "if", decision, collected: [], hasElse: false, fromElseif });
    this.tails = [{ from: decision, label: ActivityParser.branchLabel(after) }];
  }

  private elseIf(rest: string): void {
    const frame = this.frames[this.frames.length - 1];
    if (frame?.type !== "if") return;
    frame.collected.push(...this.tails);
    frame.hasElse = true;
    this.tails = [{ from: frame.decision }];
    this.openIf(rest, true);
  }

  private elseBranch(rest: string): void {
    const frame = this.frames[this.frames.length - 1];
    if (frame?.type !== "if") return;
    frame.collected.push(...this.tails);
    frame.hasElse = true;
    this.tails = [{ from: frame.decision, label: ActivityParser.branchLabel(rest) }];
  }

  private closeIf(): void {
    let frame = this.frames.pop();
    while (frame?.type === "if") {
      const merged = [...frame.collected, ...this.tails];
      if (!frame.hasElse) merged.push({ from: frame.decision });
      this.tails = merged;
      if (!frame.fromElseif) return;
      frame = this.frames.pop();
    }
  }

  private openWhile(rest: string): void {
    const { cond, after } = this.condition(rest);
    const decision = this.decision(cond);
    this.frames.push({ type: "while", decision });
    this.tails = [{ from: decision, label: ActivityParser.branchLabel(after) }];
  }

  private closeWhile(rest: string): void {
    const frame = this.frames.pop();
    if (frame?.type !== "while") return;
    for (const tail of this.tails) {
      if (tail.from !== frame.decision) this.edges.push({ from: tail.from, to: frame.decision, ...(tail.label ? { text: tail.label } : {}) });
    }
    this.tails = [{ from: frame.decision, label: ActivityParser.branchLabel(rest) }];
  }

  private openRepeat(): void {
    const start = this.add("uml/choice", undefined, "repeat");
    this.frames.push({ type: "repeat", start });
  }

  private closeRepeat(rest: string): void {
    const frame = this.frames.pop();
    if (frame?.type !== "repeat") return;
    const { cond, after } = this.condition(rest);
    const decision = this.decision(cond);
    const repeatLabel = /^is\s*(\(.*?\))/i.exec(after);
    const exitLabel = /\bnot\s*(\(.*?\))/i.exec(after);
    this.edges.push({ from: decision, to: frame.start, ...(repeatLabel ? { text: ActivityParser.branchLabel(repeatLabel[1]) } : {}) });
    this.tails = [{ from: decision, label: exitLabel ? ActivityParser.branchLabel(exitLabel[1]) : undefined }];
  }

  private openFork(): void {
    const bar = this.add("uml/fork-join", undefined, "fork", { w: 160, h: 8 });
    this.frames.push({ type: "fork", bar, branches: [] });
  }

  private forkAgain(): void {
    const frame = this.frames[this.frames.length - 1];
    if (frame?.type !== "fork") return;
    frame.branches.push(...this.tails);
    this.tails = [{ from: frame.bar }];
  }

  private closeFork(): void {
    const frame = this.frames.pop();
    if (frame?.type !== "fork") return;
    this.tails = [...frame.branches, ...this.tails];
    this.add("uml/fork-join", undefined, "join", { w: 160, h: 8 });
  }
}

/* ====================================================================== entry */

const empty = (message: string, findings?: Findings): PlantUmlImport => ({
  kind: "unknown",
  spec: { nodes: [], edges: [] },
  warnings: [...(findings?.warnings() ?? []), message],
  diagnostics: findings?.diagnostics ?? [],
});

/** What the text looks like when it is another language or an unsupported PlantUML diagram. */
function foreignHint(lines: Line[]): string | undefined {
  const first = lines[0]?.text ?? "";
  if (/^(?:flowchart|graph)\b/i.test(first) || /^sequenceDiagram\b/.test(first) || /^(?:classDiagram|erDiagram|stateDiagram|gantt|pie|journey)\b/.test(first)) {
    return "This looks like Mermaid, not PlantUML. Switch the language above.";
  }
  if (lines.some((line) => /\[\*\]/.test(line.text))) return "PlantUML state diagrams are not supported yet.";
  if (lines.some((line) => /^\(\*\)/.test(line.text) || /-->\s*\(\*\)/.test(line.text))) {
    return "The old activity syntax ((*) --> …) is not supported. Use the new syntax: start, :action;, if (…) then, stop.";
  }
  return undefined;
}

/**
 * Reads PlantUML text. The diagram type is inferred from what the text
 * contains, like PlantUML does. Never throws: problems come back as
 * `warnings` and `diagnostics`.
 */
export function importPlantUml(source: string): PlantUmlImport {
  try {
    const findings = new Findings();
    const prepared = prepare(typeof source === "string" ? source : "", findings);

    if (prepared.type !== "uml") {
      return empty(`PlantUML @start${prepared.type} diagrams are not supported. ${SUPPORTED}`);
    }
    if (prepared.lines.length === 0) return empty(`The PlantUML source is empty. ${SUPPORTED}`);
    if (prepared.extraDiagrams > 0) {
      findings.extra.push(`Only the first diagram was read; ${plural(prepared.extraDiagrams, "further diagram")} ignored.`);
    }

    const foreign = foreignHint(prepared.lines);
    if (foreign) return empty(foreign, findings);

    const kind = detectKind(prepared.lines);
    if (!kind) return empty(`No supported PlantUML elements were found. ${SUPPORTED}`, findings);

    const result: PlantUmlImport = { kind, spec: { nodes: [], edges: [] }, warnings: [], diagnostics: [] };
    if (kind === "sequence") result.sequence = parseSequence(prepared.lines, findings);
    else if (kind === "activity") result.spec = new ActivityParser(findings).parse(prepared.lines);
    else result.spec = new StructureParser(kind, findings, prepared.noteNames).parse(prepared.lines);
    if (prepared.direction && kind !== "sequence") result.direction = prepared.direction;

    result.warnings = findings.warnings();
    result.diagnostics = findings.diagnostics;
    const nothing = kind === "sequence" ? !result.sequence?.participants.length : !result.spec.nodes?.length;
    if (nothing) {
      result.kind = "unknown";
      result.warnings.push(`No elements could be read. ${SUPPORTED}`);
    }
    return result;
  } catch (error) {
    return empty(`The PlantUML source could not be read. ${error instanceof Error ? error.message : String(error)}`);
  }
}
