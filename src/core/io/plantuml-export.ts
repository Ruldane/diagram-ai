import { resolveEdgeStyle, type ResolvedEdgeStyle } from "../model/defaults";
import type { DEdge, DiagramDoc, DNode, EdgeStyle, Id, LayoutDirection, MarkerKind } from "../model/types";
import { getShape } from "../shapes/registry";
import { importPlantUml, type PlantUmlKind } from "./plantuml";

/**
 * PlantUML export: the inverse of `importPlantUml` for the subset it reads
 * (sequence, class, use case, component and structured activity diagrams).
 *
 * The text names every element by its document id (`class "Order" as order`),
 * so reading it back (and applying it) finds the same elements. Positions,
 * sizes and colours are not part of the text. A diagram that uses shapes or
 * connections this subset cannot say returns `ok: false` with the reason,
 * rather than text that would silently lose them.
 */

export type PlantUmlExport =
  | { ok: true; text: string; kind: PlantUmlKind; notes: string[] }
  | { ok: false; reason: string; example: string };

const SEQUENCE_EXAMPLE = `@startuml
actor User
participant "Web app" as Web
User -> Web : open the page
Web --> User : 200 OK
@enduml`;

const CLASS_EXAMPLE = `@startuml
class Order {
  +id: int
  +total(): Money
}
class Customer
Customer "1" --> "0..*" Order : places
@enduml`;

const ACTIVITY_EXAMPLE = `@startuml
start
:Receive order;
if (In stock?) then (yes)
  :Ship;
else (no)
  :Back-order;
endif
stop
@enduml`;

/* ------------------------------------------------------------------ helpers */

/** Label on one line: line breaks become `\n`, quotes would end the string. */
function oneLine(text: string | undefined): string {
  return (text ?? "").trim().replace(/\r\n?|\n/g, "\\n").replace(/"/g, "'");
}

const quoted = (text: string | undefined): string => `"${oneLine(text)}"`;

/** The alias an element is declared under. Its document id, so applying the text finds it again. */
const aliasOf = (id: Id): string => id.replace(/[\s"]+/g, "_");

/** An element reference inside a relation: always quoted, because ids may hold characters a bare name cannot. */
const ref = (id: Id): string => `"${aliasOf(id)}"`;

const EDGE_ORDER = (edges: Record<Id, DEdge>): DEdge[] =>
  Object.values(edges)
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => (a.edge.z ?? 0) - (b.edge.z ?? 0) || a.index - b.index)
    .map((entry) => entry.edge);

/** Reading order along the layout direction, so the text starts where the diagram starts. */
function readingOrder(nodes: DNode[], direction: LayoutDirection): DNode[] {
  const horizontal = direction === "right" || direction === "left";
  const sign = direction === "up" || direction === "left" ? -1 : 1;
  const main = (node: DNode): number => sign * (horizontal ? node.x + node.w / 2 : node.y + node.h / 2);
  const cross = (node: DNode): number => (horizontal ? node.y + node.h / 2 : node.x + node.w / 2);
  return [...nodes].sort((a, b) => main(a) - main(b) || cross(a) - cross(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const shapeName = (shape: string): string => getShape(shape).name.toLowerCase();

function listShapes(shapes: Iterable<string>): string {
  const names = [...new Set([...shapes].map(shapeName))];
  const shown = names.slice(0, 4).join(", ");
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

/* ----------------------------------------------------------------- arrows */

const HEAD_RIGHT: Partial<Record<MarkerKind, string>> = {
  arrow: ">",
  "open-arrow": ">",
  triangle: "|>",
  "triangle-open": "|>",
  diamond: "*",
  "diamond-open": "o",
  circle: "o",
  "circle-open": "o",
};

const HEAD_LEFT: Partial<Record<MarkerKind, string>> = {
  arrow: "<",
  "open-arrow": "<",
  triangle: "<|",
  "triangle-open": "<|",
  diamond: "*",
  "diamond-open": "o",
  circle: "o",
  "circle-open": "o",
};

/**
 * The relation operator closest to an edge style: `-->`, `..|>`, `*--`…
 * Two styles with the same operator read the same in text, which is how
 * applying text avoids restyling a connector whose look the text cannot say.
 */
export function plantUmlOperator(style: EdgeStyle | undefined): string {
  const resolved: ResolvedEdgeStyle = resolveEdgeStyle(style);
  const body = resolved.dash === "solid" ? "--" : "..";
  const left = HEAD_LEFT[resolved.startMarker] ?? "";
  const right = HEAD_RIGHT[resolved.endMarker] ?? "";
  return `${left}${body}${right}`;
}

/* --------------------------------------------------------------- sequence */

const LIFELINES = new Set(["uml/lifeline", "uml/actor-lifeline"]);

/** Vertical position of a message: where it leaves (or reaches) its lifeline. */
function messageY(edge: DEdge, nodes: Record<Id, DNode>): number {
  for (const end of [edge.from, edge.to]) {
    const node = end.node ? nodes[end.node] : undefined;
    if (node && typeof end.anchor === "object") return node.y + end.anchor.y * node.h;
  }
  return edge.waypoints?.[0]?.y ?? Number.POSITIVE_INFINITY;
}

/** `->` call, `->>` asynchronous, `-->` return: the three kinds `buildSequence` draws. */
function messageArrow(style: ResolvedEdgeStyle): string {
  if (style.dash !== "solid") return "-->";
  return style.endMarker === "open-arrow" ? "->>" : "->";
}

function sequenceLines(doc: DiagramDoc): string[] {
  const lines: string[] = [];
  const participants = Object.values(doc.nodes).sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  for (const node of participants) {
    const keyword = node.shape === "uml/actor-lifeline" ? "actor" : "participant";
    lines.push(`${keyword} ${quoted(node.text?.trim() || node.id)} as ${aliasOf(node.id)}`);
  }
  const messages = EDGE_ORDER(doc.edges)
    .map((edge, index) => ({ edge, index, y: messageY(edge, doc.nodes) }))
    .sort((a, b) => a.y - b.y || a.index - b.index);
  for (const { edge } of messages) {
    if (!edge.from.node || !edge.to.node) continue;
    const text = oneLine(edge.text);
    lines.push(`${ref(edge.from.node)} ${messageArrow(resolveEdgeStyle(edge.style))} ${ref(edge.to.node)}${text ? ` : ${text}` : ""}`);
  }
  return lines;
}

/* ------------------------------------------------------------- structures */

type StructureKind = "class" | "usecase" | "component";

interface Keyword {
  word: string;
  /** Written with a `{ … }` body of members. */
  members?: boolean;
  /** Written with a `{ … }` body of nested elements. */
  container?: boolean;
}

const CLASS_SHAPES: Record<string, Keyword> = {
  "uml/class": { word: "class", members: true },
  "uml/interface": { word: "interface", members: true },
  "uml/enum": { word: "enum", members: true },
  "uml/object": { word: "object", members: true },
  "uml/package": { word: "package", container: true },
};

const USECASE_SHAPES: Record<string, Keyword> = {
  "uml/actor": { word: "actor" },
  "uml/use-case": { word: "usecase" },
  "uml/system-boundary": { word: "rectangle", container: true },
};

const COMPONENT_SHAPES: Record<string, Keyword> = {
  "uml/component": { word: "component" },
  "uml/interface": { word: "interface" },
  "uml/actor": { word: "actor" },
  "uml/node": { word: "node", container: true },
  "uml/package": { word: "package", container: true },
  "uml/artifact": { word: "artifact" },
  "basic/cloud": { word: "cloud" },
  "basic/cylinder": { word: "database" },
  "basic/rect": { word: "rectangle" },
  "basic/pill": { word: "queue" },
  "basic/hexagon": { word: "hexagon" },
};

const STRUCTURES: Record<StructureKind, Record<string, Keyword>> = { class: CLASS_SHAPES, usecase: USECASE_SHAPES, component: COMPONENT_SHAPES };

const PREFERRED_BY_TYPE: Record<string, StructureKind> = { "uml-class": "class", "uml-use-case": "usecase", "uml-component": "component" };

function structureKind(doc: DiagramDoc, shapes: Set<string>): StructureKind | undefined {
  const preferred = PREFERRED_BY_TYPE[doc.type];
  const order: StructureKind[] = preferred ? [preferred, "class", "usecase", "component"] : ["class", "usecase", "component"];
  return order.find((kind) => [...shapes].every((shape) => shape in STRUCTURES[kind]));
}

/** `{field}` / `{method}` make the importer's attribute-or-operation guess agree with the section the text came from. */
function memberLine(text: string, method: boolean): string {
  const isMethod = text.includes("(");
  const clean = text.replace(/\s+/g, " ").trim();
  if (method && !isMethod) return `{method} ${clean}`;
  if (!method && isMethod) return `{field} ${clean}`;
  return clean;
}

interface ClassText {
  stereotype?: string;
  title: string;
  attributes: string[];
  operations: string[];
}

function splitClassText(node: DNode): ClassText {
  const sections: string[][] = [[]];
  for (const raw of (node.text ?? "").split("\n")) {
    if (raw.trim() === "---") sections.push([]);
    else sections[sections.length - 1].push(raw.trim());
  }
  const head = sections[0].filter(Boolean);
  const first = /^«\s*(.+?)\s*»$/.exec(head[0] ?? "");
  const lines = (section: string[] | undefined): string[] => (section ?? []).filter(Boolean);
  const body = [...lines(sections[1])];
  const operations = lines(sections[2]);
  // Interfaces and enums keep every member in one compartment.
  const flat = node.shape === "uml/interface" || node.shape === "uml/enum";
  return {
    ...(first ? { stereotype: first[1] } : {}),
    title: (first ? head.slice(1) : head).join("\n") || node.id,
    attributes: flat ? [] : body,
    operations: flat ? [...body, ...operations] : operations,
  };
}

function structureLines(doc: DiagramDoc, kind: StructureKind, notes: string[]): string[] | { reason: string } {
  const table = STRUCTURES[kind];
  const direction = doc.settings.layout.direction;
  const ordered = readingOrder(Object.values(doc.nodes), direction);

  const children = new Map<Id, DNode[]>();
  const roots: DNode[] = [];
  for (const node of ordered) {
    const parent = node.parent ? doc.nodes[node.parent] : undefined;
    if (parent && table[parent.shape]?.container) children.set(parent.id, [...(children.get(parent.id) ?? []), node]);
    else if (parent) return { reason: `A ${shapeName(node.shape)} sits inside a ${shapeName(parent.shape)}, which PlantUML text cannot nest.` };
    else roots.push(node);
  }

  const lines: string[] = [];
  const emit = (node: DNode, depth: number): void => {
    const pad = "  ".repeat(depth);
    const keyword = table[node.shape];
    const abstract = keyword.word === "class" && node.data?.abstract === true;
    const declare = (title: string, word = keyword.word): string => `${pad}${abstract ? "abstract class" : word} ${quoted(title)} as ${aliasOf(node.id)}`;

    if (keyword.container) {
      const members = children.get(node.id) ?? [];
      lines.push(`${declare(node.text?.split("\n")[0] || node.id)}${members.length ? " {" : ""}`);
      for (const member of members) emit(member, depth + 1);
      if (members.length) lines.push(`${pad}}`);
      return;
    }
    if (keyword.members) {
      const text = splitClassText(node);
      const head = declare(text.title) + (text.stereotype ? ` <<${text.stereotype}>>` : "");
      const body = [...text.attributes.map((line) => memberLine(line, false)), ...text.operations.map((line) => memberLine(line, true))];
      if (!body.length) lines.push(head);
      else lines.push(`${head} {`, ...body.map((line) => `${pad}  ${line}`), `${pad}}`);
      return;
    }
    lines.push(declare(node.text ?? node.id));
  };
  for (const node of roots) emit(node, 0);

  const alias = (endpoint: DEdge["from"]): string | undefined => (endpoint.node ? ref(endpoint.node) : undefined);
  let dropped = 0;
  for (const edge of EDGE_ORDER(doc.edges)) {
    const from = alias(edge.from);
    const to = alias(edge.to);
    if (!from || !to) {
      dropped++;
      continue;
    }
    const start = edge.startText?.trim() ? ` ${quoted(edge.startText)}` : "";
    const end = edge.endText?.trim() ? `${quoted(edge.endText)} ` : "";
    const label = oneLine(edge.text);
    lines.push(`${from}${start} ${plantUmlOperator(edge.style)} ${end}${to}${label ? ` : ${label}` : ""}`);
  }
  if (dropped) notes.push(`${dropped} connector${dropped === 1 ? "" : "s"} with a free end ${dropped === 1 ? "is" : "are"} not in the text.`);
  return lines;
}

/* --------------------------------------------------------------- activity */

const ACTIVITY_SHAPES = new Set([
  "uml/initial-state",
  "uml/action",
  "flowchart/decision",
  "uml/choice",
  "uml/activity-final",
  "uml/flow-final",
  "uml/fork-join",
]);

/** A statement that creates an element: the line it is written on and the id the document knows it by. */
interface Created {
  line: number;
  id: Id;
}

const NOT_STRUCTURED = "The activity flow cannot be written as structured PlantUML (start, :action;, if / while / repeat / fork).";

/**
 * Writes a flow graph as structured activity text by walking it from the
 * start: straight runs, `if … else … endif` (found by where the branches
 * meet again), `while` and `repeat` loops (found by their back edges) and
 * `fork`. Anything else (a jump into the middle of a branch, two starting
 * points) is reported instead of guessed at.
 */
function activityLines(doc: DiagramDoc, notes: string[]): { lines: string[]; order: Created[] } | { reason: string } {
  const nodes = doc.nodes;
  const edges = EDGE_ORDER(doc.edges);
  if (edges.some((edge) => !edge.from.node || !edge.to.node || !nodes[edge.from.node] || !nodes[edge.to.node])) {
    return { reason: "Some connectors have a free end. Attach every connector to a shape first." };
  }
  const incoming = new Map<Id, number>();
  for (const edge of edges) incoming.set(edge.to.node!, (incoming.get(edge.to.node!) ?? 0) + 1);
  const roots = Object.values(nodes).filter((node) => !incoming.get(node.id));
  if (roots.length !== 1) {
    return { reason: `${NOT_STRUCTURED} ${roots.length === 0 ? "It has no start (every shape has an incoming arrow)." : `It has ${roots.length} starting points; PlantUML text has one.`}` };
  }

  /* Back edges: edges that return to a step still on the path from the start. */
  const outgoing = new Map<Id, DEdge[]>();
  for (const edge of edges) outgoing.set(edge.from.node!, [...(outgoing.get(edge.from.node!) ?? []), edge]);
  const back = new Set<Id>();
  const state = new Map<Id, "open" | "done">();
  const walk = (id: Id): void => {
    state.set(id, "open");
    for (const edge of outgoing.get(id) ?? []) {
      const target = edge.to.node!;
      if (state.get(target) === "open") back.add(edge.id);
      else if (!state.has(target)) walk(target);
    }
    state.set(id, "done");
  };
  walk(roots[0].id);
  if (state.size !== Object.keys(nodes).length) return { reason: `${NOT_STRUCTURED} Some shapes cannot be reached from the start.` };

  const forward = (id: Id): DEdge[] => (outgoing.get(id) ?? []).filter((edge) => !back.has(edge.id));
  const backInto = new Map<Id, DEdge[]>();
  for (const edge of edges) if (back.has(edge.id)) backInto.set(edge.to.node!, [...(backInto.get(edge.to.node!) ?? []), edge]);

  const reach = (from: Id): Map<Id, number> => {
    const seen = new Map<Id, number>([[from, 0]]);
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      for (const edge of forward(queue[head])) {
        const next = edge.to.node!;
        if (!seen.has(next)) {
          seen.set(next, seen.get(queue[head])! + 1);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  /** The first step all branches reach (where an `if` or `fork` closes), if there is one. */
  const meeting = (targets: Id[]): Id | undefined => {
    const sets = targets.map(reach);
    return [...sets[0].entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).find((id) => sets.every((set) => set.has(id)));
  };

  const lines: string[] = [];
  const order: Created[] = [];
  /** Writes a statement that creates the element `id`. */
  const write = (id: Id, text: string): void => {
    order.push({ line: lines.length, id });
    lines.push(text);
  };
  const done = new Set<Id>();
  let failure: string | undefined;
  const fail = (reason: string): void => {
    failure ??= `${NOT_STRUCTURED} ${reason}`;
  };
  const label = (edge: DEdge | undefined): string => (edge?.text?.trim() ? ` (${oneLine(edge.text)})` : "");
  let merged = false;

  const flow = (start: Id | undefined, stop: ReadonlySet<Id>, depth: number): void => {
    const pad = "  ".repeat(depth);
    let current = start;
    while (current !== undefined && !stop.has(current) && !failure) {
      if (done.has(current)) return fail("A step is reached from two places without a decision or join in between.");
      done.add(current);
      const node = nodes[current];
      const next = forward(current);
      const single = (): Id | undefined => {
        if (next.length > 1) fail(`"${oneLine(node.text) || shapeName(node.shape)}" has more than one outgoing arrow but is not a decision.`);
        return next[0]?.to.node;
      };

      switch (node.shape) {
        case "uml/initial-state":
          write(node.id, `${pad}start`);
          current = single();
          break;
        case "uml/action":
          write(node.id, `${pad}:${oneLine(node.text)};`);
          current = single();
          break;
        case "uml/activity-final":
        case "uml/flow-final":
          write(node.id, `${pad}${node.shape === "uml/activity-final" ? "stop" : "end"}`);
          if (next.length) fail("A final node has an outgoing arrow.");
          current = undefined;
          break;

        case "uml/fork-join": {
          if (next.length < 2) return fail("A fork or join bar is used as a plain step.");
          const join = meeting(next.map((edge) => edge.to.node!));
          if (!join || nodes[join].shape !== "uml/fork-join") return fail("The branches of a fork do not meet at a join bar.");
          write(node.id, `${pad}fork`);
          next.forEach((edge, index) => {
            if (index > 0) lines.push(`${pad}fork again`);
            flow(edge.to.node, new Set([...stop, join]), depth + 1);
          });
          write(join, `${pad}end fork`);
          done.add(join);
          current = forward(join)[0]?.to.node;
          break;
        }

        case "flowchart/decision":
        case "uml/choice": {
          const heads = backInto.get(current) ?? [];
          const text = oneLine(node.text);
          if (node.shape === "uml/choice" && !text && next.length === 1 && heads.length === 0) {
            // A merge diamond: the `endif` that closes the branches draws it again.
            merged = true;
            current = next[0].to.node;
            break;
          }
          if (node.shape === "uml/choice" && heads.length) {
            // Loop head of a `repeat … repeat while (…)`.
            const closing = nodes[heads[0].from.node!];
            if (heads.length !== 1 || closing?.shape === undefined || !["flowchart/decision", "uml/choice"].includes(closing.shape)) {
              return fail("A loop returns to a step in a way `repeat` cannot say.");
            }
            const exit = forward(closing.id);
            if (next.length !== 1 || exit.length !== 1) return fail("A repeat loop needs exactly one way in and one way out.");
            write(node.id, `${pad}repeat`);
            flow(next[0].to.node, new Set([...stop, closing.id]), depth + 1);
            done.add(closing.id);
            write(closing.id, `${pad}repeat while (${oneLine(closing.text)})${heads[0].text?.trim() ? ` is (${oneLine(heads[0].text)})` : ""}${exit[0].text?.trim() ? ` not (${oneLine(exit[0].text)})` : ""}`);
            current = exit[0].to.node;
            break;
          }
          if (heads.length) {
            // `while (cond)`: the branch that comes back is the body, the other leaves.
            if (next.length !== 2) return fail("A loop decision needs one branch into the loop and one out of it.");
            const sources = new Set(heads.map((edge) => edge.from.node!));
            const bodyIndex = next.findIndex((edge) => [...reach(edge.to.node!).keys()].some((id) => sources.has(id)));
            const body = next[bodyIndex];
            const exit = next[1 - bodyIndex];
            if (!body) return fail("A loop decision has no branch that returns to it.");
            write(node.id, `${pad}while (${text})${label(body).replace(/^ \(/, " is (")}`);
            flow(body.to.node, new Set([...stop, current]), depth + 1);
            lines.push(`${pad}endwhile${label(exit)}`);
            current = exit.to.node;
            break;
          }
          if (next.length !== 2) return fail(`A decision "${text}" has ${next.length} outgoing arrows; PlantUML text has if / else (two).`);
          const join = meeting(next.map((edge) => edge.to.node!));
          const inner = new Set(join ? [...stop, join] : stop);
          write(node.id, `${pad}if (${text}) then${label(next[0])}`);
          flow(next[0].to.node, inner, depth + 1);
          const elseSays = next[1].to.node !== join || next[1].text?.trim();
          if (elseSays) {
            lines.push(`${pad}else${label(next[1])}`);
            flow(next[1].to.node, inner, depth + 1);
          }
          lines.push(`${pad}endif`);
          current = join;
          break;
        }

        default:
          fail(`${shapeName(node.shape)} is not part of the activity subset.`);
      }
    }
  };

  flow(roots[0].id, new Set(), 0);
  if (failure) return { reason: failure };
  if (done.size < Object.keys(nodes).length) {
    return { reason: `${NOT_STRUCTURED} ${Object.keys(nodes).length - done.size} shapes are only reachable by a jump the text cannot express.` };
  }
  if (merged) notes.push("Merge diamonds are implied by `endif`; the text does not list them.");
  return { lines, order };
}

/**
 * Activity elements have no names in PlantUML, so the importer numbers them
 * by what they say (`a-Ship`, `stop`, `stop-2`). Where that would not give a
 * shape the id it has now, a `' @id` comment (an ordinary PlantUML comment)
 * on the line before pins it, so applying the text finds the same shapes.
 */
function pinActivityIds(body: string[], order: Created[]): string[] {
  const pinned = new Set<number>();
  const render = (): string[] => {
    const out: string[] = [];
    const byLine = new Map(order.map((entry, index) => [entry.line, index]));
    body.forEach((line, index) => {
      const at = byLine.get(index);
      if (at !== undefined && pinned.has(at)) out.push(`${/^\s*/.exec(line)![0]}' @id ${order[at].id}`);
      out.push(line);
    });
    return out;
  };
  for (let round = 0; round < 4; round++) {
    const text = ["@startuml", ...render(), "@enduml"].join("\n");
    const ids = (importPlantUml(text).spec.nodes ?? []).map((node) => node.id);
    const wrong = order.map((entry, index) => (ids.length === order.length && ids[index] === entry.id ? -1 : index)).filter((index) => index >= 0);
    if (!wrong.length) break;
    // Counts differ or the rounds ran out: pin everything rather than risk renaming a shape.
    if (ids.length !== order.length || round === 3) order.forEach((_entry, index) => pinned.add(index));
    else wrong.forEach((index) => pinned.add(index));
  }
  return render();
}

/* ------------------------------------------------------------------ entry */

const KIND_LABEL: Record<PlantUmlKind, string> = {
  sequence: "sequence diagram",
  class: "class diagram",
  usecase: "use case diagram",
  component: "component diagram",
  activity: "activity diagram",
};

/** Writes the diagram as PlantUML text, or says why it cannot be written. */
export function exportPlantUml(doc: DiagramDoc): PlantUmlExport {
  const nodes = Object.values(doc.nodes);
  const notes: string[] = [];
  const title = doc.name.replace(/\s+/g, " ").trim();
  const wrap = (kind: PlantUmlKind, body: string[]): PlantUmlExport => {
    const direction = kind === "sequence" || kind === "activity" ? undefined : doc.settings.layout.direction;
    if (direction === "up" || direction === "left") notes.push("PlantUML text only says top-to-bottom or left-to-right; this diagram's direction is not kept.");
    const lines = ["@startuml", ...(title ? [`title ${title}`] : []), ...(direction === "right" ? ["left to right direction"] : []), ...body, "@enduml"];
    return { ok: true, text: `${lines.join("\n")}\n`, kind, notes };
  };

  if (!nodes.length) return wrap("sequence", []);
  const shapes = new Set(nodes.map((node) => node.shape));

  if ([...shapes].every((shape) => LIFELINES.has(shape))) {
    notes.push("Message order comes from their position on the canvas. Lifeline positions are rebuilt when you apply the text.");
    return wrap("sequence", sequenceLines(doc));
  }

  if ([...shapes].every((shape) => ACTIVITY_SHAPES.has(shape))) {
    const result = activityLines(doc, notes);
    if ("reason" in result) return { ok: false, reason: result.reason, example: ACTIVITY_EXAMPLE };
    return wrap("activity", pinActivityIds(result.lines, result.order));
  }

  const kind = structureKind(doc, shapes);
  if (!kind) {
    const known = new Set([...Object.keys(CLASS_SHAPES), ...Object.keys(USECASE_SHAPES), ...Object.keys(COMPONENT_SHAPES), ...ACTIVITY_SHAPES, ...LIFELINES]);
    const unknown = [...shapes].filter((shape) => !known.has(shape));
    const reason = unknown.length
      ? `PlantUML text covers sequence, class, use case, component and activity diagrams. This diagram uses ${listShapes(unknown)}, which it cannot express, so the text would lose them.`
      : "This diagram mixes shapes from different PlantUML diagram types (for example classes with use cases), which one PlantUML text cannot hold.";
    return { ok: false, reason, example: shapes.has("uml/class") ? CLASS_EXAMPLE : SEQUENCE_EXAMPLE };
  }
  const lines = structureLines(doc, kind, notes);
  if (!Array.isArray(lines)) return { ok: false, reason: lines.reason, example: CLASS_EXAMPLE };
  notes.push(`Written as a ${KIND_LABEL[kind]}. Positions, sizes and colours are not part of the text; applying it keeps them for every shape that is still there.`);
  return wrap(kind, lines);
}
