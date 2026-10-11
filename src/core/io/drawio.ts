import { resolveEdgeStyle, type ResolvedEdgeStyle, type ResolvedNodeStyle } from "../model/defaults";
import { normalizeColor } from "../model/palette";
import { nodesInOrder } from "../model/queries";
import type {
  Color,
  DashStyle,
  DEdge,
  DiagramDoc,
  DNode,
  EdgeEnd,
  EdgeRouting,
  EdgeStyle,
  FontFamily,
  HAlign,
  Id,
  MarkerKind,
  NodeStyle,
  Point,
  Rect,
  TextStyle,
  VAlign,
} from "../model/types";
import { containerInsets, getShape, nodeStyle, resolveShape } from "../shapes/registry";
import type { ShapeDef } from "../shapes/types";
import type { EdgeSpec, ElementsSpec, NodeSpec } from "../spec/apply";
import { childrenNamed, decodeEntities, findElement, firstChild, parseXml, serializeXml, xmlElement, type XmlElement } from "./xml";

/**
 * draw.io (diagrams.net) interchange.
 *
 * Export writes an uncompressed `<mxfile>` that opens directly in draw.io.
 * Import reads `.drawio` / `.xml` files (plain or compressed) and returns a
 * spec for `applySpec`. Both directions map shapes through the tables below;
 * anything without an entry degrades to a labelled rectangle instead of failing.
 */

/* ============================================================ style strings */

type StyleValue = string | number;

/** A draw.io style: `token;key=value;…`. Keeps insertion order so output is stable. */
class StyleBuilder {
  private readonly entries = new Map<string, string | null>();

  constructor(base = "") {
    for (const part of base.split(";")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq < 0) this.entries.set(part, null);
      else this.entries.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Adds a value unless the style already decided this key (shape presets win over generic styling). */
  add(key: string, value: StyleValue | undefined): this {
    if (value !== undefined && !this.entries.has(key)) this.entries.set(key, String(value));
    return this;
  }

  toString(): string {
    return [...this.entries].map(([key, value]) => (value === null ? `${key};` : `${key}=${value};`)).join("");
  }
}

interface DrawioStyle {
  /** Bare tokens, in order (`ellipse`, `swimlane`, `text`…). */
  tokens: string[];
  props: Record<string, string>;
}

function parseStyle(style: string | undefined): DrawioStyle {
  const out: DrawioStyle = { tokens: [], props: {} };
  for (const part of (style ?? "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) out.tokens.push(trimmed);
    else out.props[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const isOn = (style: DrawioStyle, key: string): boolean => style.props[key] === "1";

function numberOf(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
/** Anchors are fractions of a node, so they need more digits than pixel values. */
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/* ------------------------------------------------------------ shared tables */

const FONT_FAMILIES: Record<FontFamily, string> = {
  sans: "IBM Plex Sans",
  serif: "IBM Plex Serif",
  mono: "IBM Plex Mono",
  hand: "Kalam",
};

/** Substrings that identify a font family we can represent, checked in order. */
const FONT_HINTS: [RegExp, FontFamily][] = [
  [/mono|courier|consolas|menlo|code/, "mono"],
  [/kalam|comic|hand|caveat|marker|script/, "hand"],
  [/sans|arial|helvetica|verdana|tahoma|roboto|inter|segoe/, "sans"],
  [/serif|times|georgia|garamond|palatino/, "serif"],
];

const FONT_BOLD = 1;
const FONT_ITALIC = 2;
const FONT_UNDERLINE = 4;

/** draw.io's defaults, needed where they differ from ours and affect layout. */
const DRAWIO_FONT_SIZE = 12;
const DRAWIO_ARC_PERCENT = 15;
const DRAWIO_LIFELINE_HEADER = 40;

/** Dash pattern written for dotted lines; on import any pattern starting with a dot-sized dash reads back as dotted. */
const DOTTED_PATTERN = "1 3";
const DOT_MAX_LENGTH = 2;

interface DrawioArrow {
  name: string;
  filled: boolean;
  /** Marker size (draw.io's default of 6 is too small for hollow UML and ER heads). */
  size?: number;
}

const ARROWS: Record<MarkerKind, DrawioArrow> = {
  none: { name: "none", filled: false },
  arrow: { name: "classic", filled: true },
  "open-arrow": { name: "open", filled: false },
  triangle: { name: "block", filled: true, size: 10 },
  "triangle-open": { name: "block", filled: false, size: 12 },
  diamond: { name: "diamond", filled: true, size: 12 },
  "diamond-open": { name: "diamond", filled: false, size: 12 },
  circle: { name: "oval", filled: true },
  "circle-open": { name: "oval", filled: false },
  bar: { name: "baseDash", filled: false, size: 10 },
  cross: { name: "cross", filled: false, size: 8 },
  // draw.io's "ERone" is a single bar; ours is the double-bar "one and only one".
  "crow-one": { name: "ERmandOne", filled: false, size: 10 },
  "crow-many": { name: "ERmany", filled: false, size: 10 },
  "crow-zero-one": { name: "ERzeroToOne", filled: false, size: 10 },
  "crow-one-many": { name: "ERoneToMany", filled: false, size: 10 },
  "crow-zero-many": { name: "ERzeroToMany", filled: false, size: 10 },
};

/** draw.io arrow name → our marker when filled / hollow. */
const MARKERS: Record<string, { filled: MarkerKind; hollow: MarkerKind }> = {
  none: { filled: "none", hollow: "none" },
  classic: { filled: "arrow", hollow: "triangle-open" },
  classicThin: { filled: "arrow", hollow: "triangle-open" },
  block: { filled: "triangle", hollow: "triangle-open" },
  blockThin: { filled: "triangle", hollow: "triangle-open" },
  doubleBlock: { filled: "triangle", hollow: "triangle-open" },
  open: { filled: "open-arrow", hollow: "open-arrow" },
  openThin: { filled: "open-arrow", hollow: "open-arrow" },
  openAsync: { filled: "open-arrow", hollow: "open-arrow" },
  async: { filled: "arrow", hollow: "open-arrow" },
  oval: { filled: "circle", hollow: "circle-open" },
  circle: { filled: "circle-open", hollow: "circle-open" },
  circlePlus: { filled: "circle-open", hollow: "circle-open" },
  halfCircle: { filled: "circle-open", hollow: "circle-open" },
  box: { filled: "circle", hollow: "circle-open" },
  diamond: { filled: "diamond", hollow: "diamond-open" },
  diamondThin: { filled: "diamond", hollow: "diamond-open" },
  dash: { filled: "bar", hollow: "bar" },
  baseDash: { filled: "bar", hollow: "bar" },
  cross: { filled: "cross", hollow: "cross" },
  ERone: { filled: "crow-one", hollow: "crow-one" },
  ERmandOne: { filled: "crow-one", hollow: "crow-one" },
  ERmany: { filled: "crow-many", hollow: "crow-many" },
  ERoneToMany: { filled: "crow-one-many", hollow: "crow-one-many" },
  ERzeroToOne: { filled: "crow-zero-one", hollow: "crow-zero-one" },
  ERzeroToMany: { filled: "crow-zero-many", hollow: "crow-zero-many" },
  manyOptional: { filled: "crow-zero-many", hollow: "crow-zero-many" },
};

const ROUTING_STYLES: Record<EdgeRouting, string> = {
  orthogonal: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto",
  straight: "edgeStyle=none;rounded=0",
  curved: "edgeStyle=orthogonalEdgeStyle;curved=1;rounded=0",
};

const SECTION_LINE = /^[ \t]*-{3,}[ \t]*$/;

/* =================================================================== export */

interface DrawioShape {
  /** Style prefix selecting the draw.io shape. */
  style: string | ((node: DNode, def: ShapeDef) => string);
  /** The shape is a box whose corners follow `style.radius`. */
  corners?: boolean;
}

const box = (style: DrawioShape["style"] = ""): DrawioShape => ({ style, corners: true });
const fixed = (style: DrawioShape["style"]): DrawioShape => ({ style });

const LIFELINE = "shape=umlLifeline;perimeter=lifelinePerimeter;container=1;collapsible=0;recursiveResize=0;outlineConnect=0";

/** A sequence lifeline; `size` is the height of its header (`data.header` on our side). */
const lifeline = (fallbackHeader: number, participant = ""): DrawioShape["style"] => (node, def) => {
  const header = { ...def.data, ...node.data }.header;
  const size = typeof header === "number" && Number.isFinite(header) ? header : fallbackHeader;
  return `${LIFELINE};${participant}size=${round2(size)}`;
};

/** A titled container. Ours draw no rule under the header, and centre the title in it. */
const swimlane = (header: number): string => `swimlane;startSize=${round2(header)};swimlaneLine=0;container=1;collapsible=0;verticalAlign=middle;spacingLeft=12`;

/** A shape whose `size` parameter (in pixels) is computed the way our own shape derives it from the node box. */
const sized = (style: string, size: (node: DNode) => number): DrawioShape => fixed((node) => `${style};size=${round2(size(node))}`);
/** Horizontal run of a slanted side: a fraction of the width, capped at half the height. */
const slant = (fraction: number) => (node: DNode): number => Math.min(node.w * fraction, node.h * 0.5);

const PARALLELOGRAM = "shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1";
const HEXAGON = "shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1";
const TRAPEZOID = "shape=trapezoid;perimeter=trapezoidPerimeter;fixedSize=1";
const SINGLE_ARROW = "shape=singleArrow;arrowWidth=0.52;arrowSize=0.42";

/**
 * Our shape id → draw.io style. Shapes not listed export as a plain rectangle
 * (rounded when `style.radius > 0`; containers as a swimlane), keeping label,
 * colours and geometry.
 */
const SHAPE_STYLES: Record<string, DrawioShape> = {
  "basic/rect": box(),
  "basic/rounded": box(),
  "basic/pill": fixed("rounded=1;arcSize=50"),
  "basic/ellipse": fixed("ellipse"),
  "basic/circle": fixed("ellipse;aspect=fixed"),
  "basic/diamond": fixed("rhombus"),
  "basic/triangle": fixed("triangle;direction=north"),
  "basic/pentagon": fixed("shape=mxgraph.basic.pentagon"),
  "basic/hexagon": sized(HEXAGON, slant(0.22)),
  "basic/octagon": fixed("shape=mxgraph.basic.octagon2;dx=15"),
  "basic/parallelogram": sized(PARALLELOGRAM, slant(0.18)),
  "basic/trapezoid": sized(TRAPEZOID, slant(0.16)),
  "basic/star": fixed("shape=mxgraph.basic.star"),
  "basic/cross": fixed("shape=cross;size=0.33"),
  "basic/cloud": fixed("ellipse;shape=cloud"),
  "basic/cylinder": sized("shape=cylinder3;boundedLbl=1;backgroundOutline=1", (node) => Math.min(node.h * 0.14, node.w * 0.2, 18)),
  "basic/callout": fixed("shape=callout;perimeter=calloutPerimeter;rounded=1;size=18;position=0.22;position2=0.18;base=24"),
  "basic/note": fixed("shape=note;backgroundOutline=1;size=18;darkOpacity=0.05"),
  "basic/text": box("text"),
  "basic/arrow-right": fixed(SINGLE_ARROW),
  "basic/arrow-left": fixed(`${SINGLE_ARROW};direction=west`),
  "basic/arrow-up": fixed(`${SINGLE_ARROW};direction=north`),
  "basic/arrow-down": fixed(`${SINGLE_ARROW};direction=south`),
  "basic/chevron": sized("shape=step;perimeter=stepPerimeter;fixedSize=1", (node) => Math.min(node.h / 2, node.w * 0.25)),
  "basic/cube": sized("shape=cube;boundedLbl=1;backgroundOutline=1;darkOpacity=0.05;darkOpacity2=0.1", (node) => Math.min(node.w, node.h) * 0.18),
  "basic/divider": fixed("line"),
  // The label is an HTML table (see `htmlTable`), stretched over the whole cell.
  "basic/table": box("text;overflow=fill"),
  "basic/frame": box((_node, def) => swimlane(containerInsets(def).header)),
  "basic/group": box("container=1;collapsible=0;dashed=1;spacingLeft=12;spacingTop=6"),

  "flowchart/process": box(),
  "flowchart/decision": fixed("rhombus"),
  "flowchart/terminator": fixed("rounded=1;arcSize=50"),
  "flowchart/data": sized(PARALLELOGRAM, slant(0.16)),
  "flowchart/document": fixed("shape=document;boundedLbl=1"),
  "flowchart/multi-document": fixed("shape=mxgraph.flowchart.multi-document"),
  "flowchart/predefined-process": fixed("shape=process;backgroundOutline=1"),
  "flowchart/manual-input": fixed("shape=manualInput;boundedLbl=1"),
  "flowchart/manual-operation": sized(`${TRAPEZOID};flipV=1`, slant(0.16)),
  "flowchart/preparation": sized(HEXAGON, slant(0.16)),
  "flowchart/delay": fixed("shape=delay"),
  "flowchart/display": fixed("shape=display"),
  "flowchart/stored-data": fixed("shape=dataStorage;fixedSize=1"),
  "flowchart/internal-storage": fixed("shape=internalStorage;backgroundOutline=1;dx=14;dy=14"),
  "flowchart/connector": fixed("ellipse;aspect=fixed"),
  "flowchart/off-page": fixed("shape=offPageConnector"),
  "flowchart/merge": fixed("triangle;direction=south"),
  "flowchart/extract": fixed("triangle;direction=north"),
  "flowchart/or": fixed("shape=orEllipse;perimeter=ellipsePerimeter;backgroundOutline=1"),
  "flowchart/summing-junction": fixed("shape=sumEllipse;perimeter=ellipsePerimeter;backgroundOutline=1"),
  "flowchart/collate": fixed("shape=collate"),
  "flowchart/sort": fixed("shape=sortShape;perimeter=rhombusPerimeter"),
  "flowchart/card": fixed("shape=card;size=16"),
  "flowchart/loop-limit": fixed("shape=loopLimit;size=16"),

  // Shapes from other libraries with an obvious draw.io twin. Matched by id only, so a missing library is harmless.
  "uml/actor": fixed("shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;outlineConnect=0"),
  "uml/use-case": fixed("ellipse"),
  "uml/note": fixed("shape=note;backgroundOutline=1;size=14;darkOpacity=0.05"),
  "uml/choice": fixed("rhombus"),
  "uml/lifeline": fixed(lifeline(40)),
  "uml/actor-lifeline": fixed(lifeline(64, "participant=umlActor;")),
  "er/relationship": fixed("rhombus"),
  "er/attribute": fixed("ellipse"),
  "bpmn/gateway": fixed("rhombus"),
};

/** Ids of our shapes that export to a dedicated draw.io shape instead of the rectangle fallback. */
export const DRAWIO_MAPPED_SHAPES: readonly string[] = Object.keys(SHAPE_STYLES);

function baseStyle(node: DNode, def: ShapeDef, mapping: DrawioShape | undefined): string {
  if (mapping) return typeof mapping.style === "function" ? mapping.style(node, def) : mapping.style;
  if (!def.container) return "";
  const { header } = containerInsets(def);
  return header > 0 ? swimlane(header) : "container=1;collapsible=0";
}

function fontStyleBits(style: TextStyle): number {
  return (style.bold ? FONT_BOLD : 0) | (style.italic ? FONT_ITALIC : 0) | (style.underline ? FONT_UNDERLINE : 0);
}

function addDash(builder: StyleBuilder, dash: DashStyle): void {
  if (dash === "solid") {
    builder.add("dashed", 0);
    return;
  }
  builder.add("dashed", 1);
  if (dash === "dotted") builder.add("dashPattern", DOTTED_PATTERN);
}

function addTextStyle(builder: StyleBuilder, style: Required<TextStyle>): void {
  builder
    .add("fontFamily", FONT_FAMILIES[style.fontFamily])
    .add("fontSize", style.fontSize)
    .add("fontColor", style.textColor)
    .add("fontStyle", fontStyleBits(style))
    .add("align", style.align)
    .add("verticalAlign", style.valign);
}

function vertexStyle(node: DNode, def: ShapeDef, style: ResolvedNodeStyle): string {
  const mapping = SHAPE_STYLES[node.shape];
  const builder = new StyleBuilder(baseStyle(node, def, mapping));
  if (!mapping || mapping.corners) {
    // Absolute arc sizes are a diameter in draw.io.
    if (style.radius > 0) builder.add("rounded", 1).add("absoluteArcSize", 1).add("arcSize", round2(style.radius * 2));
    else builder.add("rounded", 0);
  }
  builder.add("whiteSpace", "wrap").add("html", 1).add("fillColor", style.fill).add("strokeColor", style.stroke);
  // A swimlane's fillColor only paints its header.
  if (builder.has("swimlane")) builder.add("swimlaneFillColor", style.fill);
  builder.add("strokeWidth", style.strokeWidth);
  addDash(builder, style.dash);
  addTextStyle(builder, style);
  if (style.opacity < 1) builder.add("opacity", Math.round(clamp01(style.opacity) * 100));
  if (style.shadow) builder.add("shadow", 1);
  if (node.rotation) builder.add("rotation", round2(node.rotation));
  return builder.toString();
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Label markup: lines separated by `<br>`, section breaks (`---` lines) as `<hr>`. */
function htmlLabel(text: string): string {
  let html = "";
  let needsBreak = false;
  for (const line of text.split("\n")) {
    if (SECTION_LINE.test(line)) {
      html += "<hr>";
      needsBreak = false;
      continue;
    }
    html += (needsBreak ? "<br>" : "") + escapeHtml(line);
    needsBreak = true;
  }
  return html;
}

/** `a | b` rows as an HTML table, the way draw.io's own "HTML table" shape stores them. */
function htmlTable(text: string): string {
  const rows = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.split("|").map((cell) => cell.trim()));
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const body = rows
    .map((row, index) => {
      const tag = index === 0 && rows.length > 1 ? "th" : "td";
      const cells = Array.from({ length: columns }, (_, column) => `<${tag}>${escapeHtml(row[column] ?? "")}</${tag}>`);
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return `<table border="1" cellpadding="4" style="width:100%;height:100%;border-collapse:collapse;">${body}</table>`;
}

const TABLE_SHAPE = "basic/table";

function labelMarkup(node: DNode): string {
  const text = node.text ?? "";
  return node.shape === TABLE_SHAPE && text.trim() ? htmlTable(text) : htmlLabel(text);
}

/** Container each node is exported under: the declared parent, unless it is missing or part of a cycle. */
function exportParents(nodes: Record<Id, DNode>): Map<Id, DNode> {
  const parents = new Map<Id, DNode>();
  for (const node of Object.values(nodes)) {
    const parent = node.parent ? nodes[node.parent] : undefined;
    if (!parent) continue;
    const seen = new Set<Id>([node.id]);
    let ancestor: DNode | undefined = parent;
    while (ancestor && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      ancestor = ancestor.parent ? nodes[ancestor.parent] : undefined;
    }
    if (ancestor?.id !== node.id) parents.set(node.id, parent);
  }
  return parents;
}

/** Back-to-front by z, with every container emitted before its children (draw.io needs both). */
function exportOrder(nodes: Record<Id, DNode>, parents: Map<Id, DNode>): DNode[] {
  const out: DNode[] = [];
  const emitted = new Set<Id>();
  const emit = (node: DNode): void => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    const parent = parents.get(node.id);
    if (parent) emit(parent);
    out.push(node);
  };
  for (const node of nodesInOrder(nodes)) emit(node);
  return out;
}

const ROOT_CELL = "0";
const LAYER_CELL = "1";

/** Hands out cell ids, keeping ours where they do not clash with draw.io's root cells or each other. */
class CellIds {
  private readonly taken = new Set<string>([ROOT_CELL, LAYER_CELL]);

  next(wanted: string): string {
    let candidate = wanted || "cell";
    for (let i = 2; this.taken.has(candidate); i++) candidate = `${wanted || "cell"}-${i}`;
    this.taken.add(candidate);
    return candidate;
  }
}

const pointElement = (point: Point, as?: string): XmlElement => xmlElement("mxPoint", { x: round2(point.x), y: round2(point.y), as });

/** Links and notes travel as draw.io metadata (`link`, `tooltip`), which requires a `UserObject` wrapper. */
function withMetadata(cell: XmlElement, node: DNode): XmlElement {
  if (!node.link && !node.note) return cell;
  const { id, value, ...rest } = cell.attrs;
  return xmlElement("UserObject", { label: value, link: node.link, tooltip: node.note, id }, [{ ...cell, attrs: rest }]);
}

function vertexCell(node: DNode, cellId: string, parent: DNode | undefined, parentCell: string): XmlElement {
  const def = getShape(node.shape);
  const geometry = xmlElement("mxGeometry", {
    x: round2(node.x - (parent?.x ?? 0)),
    y: round2(node.y - (parent?.y ?? 0)),
    width: round2(node.w),
    height: round2(node.h),
    as: "geometry",
  });
  const cell = xmlElement(
    "mxCell",
    { id: cellId, value: labelMarkup(node), style: vertexStyle(node, def, nodeStyle(node, def)), parent: parentCell, vertex: 1 },
    [geometry],
  );
  return withMetadata(cell, node);
}

function addArrow(builder: StyleBuilder, end: "start" | "end", marker: MarkerKind): void {
  const arrow = ARROWS[marker];
  builder.add(`${end}Arrow`, arrow.name);
  if (marker === "none") return;
  builder.add(`${end}Fill`, arrow.filled ? 1 : 0).add(`${end}Size`, arrow.size);
}

/** Fixed anchors become draw.io connection points; interior ones (lifelines) must not snap to the perimeter. */
function addAnchor(builder: StyleBuilder, prefix: "exit" | "entry", end: EdgeEnd, attached: boolean): void {
  if (!attached || typeof end.anchor !== "object") return;
  const { x, y } = end.anchor;
  builder.add(`${prefix}X`, round4(x)).add(`${prefix}Y`, round4(y)).add(`${prefix}Dx`, 0).add(`${prefix}Dy`, 0);
  const onBorder = x <= 0 || x >= 1 || y <= 0 || y >= 1;
  if (!onBorder) builder.add(`${prefix}Perimeter`, 0);
}

function edgeStyleString(edge: DEdge, style: ResolvedEdgeStyle, attached: { from: boolean; to: boolean }): string {
  const builder = new StyleBuilder(ROUTING_STYLES[edge.routing] ?? ROUTING_STYLES.orthogonal);
  builder.add("html", 1);
  addArrow(builder, "start", style.startMarker);
  addArrow(builder, "end", style.endMarker);
  builder.add("strokeColor", style.stroke).add("strokeWidth", style.strokeWidth);
  addDash(builder, style.dash);
  if (style.opacity < 1) builder.add("opacity", Math.round(clamp01(style.opacity) * 100));
  builder
    .add("fontFamily", FONT_FAMILIES[style.fontFamily])
    .add("fontSize", style.fontSize)
    .add("fontColor", style.textColor)
    .add("fontStyle", fontStyleBits(style));
  addAnchor(builder, "exit", edge.from, attached.from);
  addAnchor(builder, "entry", edge.to, attached.to);
  return builder.toString();
}

/** Relative position along the edge (-1 source … 1 target) of the labels near each end. */
const END_LABEL_POSITION = 0.8;

function endLabelCell(id: string, text: string, edgeCell: string, position: number, style: ResolvedEdgeStyle): XmlElement {
  const labelStyle = new StyleBuilder("edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[]")
    .add("fontFamily", FONT_FAMILIES[style.fontFamily])
    .add("fontSize", Math.max(9, style.fontSize - 1))
    .add("fontColor", style.textColor);
  const geometry = xmlElement("mxGeometry", { x: position, relative: 1, as: "geometry" }, [xmlElement("mxPoint", { as: "offset" })]);
  return xmlElement("mxCell", { id, value: htmlLabel(text), style: labelStyle.toString(), parent: edgeCell, vertex: 1, connectable: 0 }, [geometry]);
}

function edgeCells(edge: DEdge, cellId: string, nodeCells: Map<Id, string>, ids: CellIds): XmlElement[] {
  const style = resolveEdgeStyle(edge.style);
  const source = edge.from.node ? nodeCells.get(edge.from.node) : undefined;
  const target = edge.to.node ? nodeCells.get(edge.to.node) : undefined;
  const origin: Point = { x: 0, y: 0 };

  const geometry = xmlElement("mxGeometry", { relative: 1, as: "geometry" }, [
    ...(source ? [] : [pointElement(edge.from.point ?? origin, "sourcePoint")]),
    ...(target ? [] : [pointElement(edge.to.point ?? origin, "targetPoint")]),
    ...(edge.waypoints?.length ? [xmlElement("Array", { as: "points" }, edge.waypoints.map((point) => pointElement(point)))] : []),
  ]);
  const cell = xmlElement(
    "mxCell",
    {
      id: cellId,
      value: htmlLabel(edge.text ?? ""),
      style: edgeStyleString(edge, style, { from: Boolean(source), to: Boolean(target) }),
      parent: LAYER_CELL,
      source,
      target,
      edge: 1,
    },
    [geometry],
  );

  const labels: XmlElement[] = [];
  if (edge.startText?.trim()) labels.push(endLabelCell(ids.next(`${cellId}-start`), edge.startText, cellId, -END_LABEL_POSITION, style));
  if (edge.endText?.trim()) labels.push(endLabelCell(ids.next(`${cellId}-end`), edge.endText, cellId, END_LABEL_POSITION, style));
  return [cell, ...labels];
}

/** Edges in creation order, re-sorted only where an explicit `z` says so. */
function edgesInOrder(edges: Record<Id, DEdge>): DEdge[] {
  return Object.values(edges)
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => (a.edge.z ?? 0) - (b.edge.z ?? 0) || a.index - b.index)
    .map((entry) => entry.edge);
}

/**
 * Serialises a diagram as an uncompressed draw.io file (`<mxfile>` with one
 * page) that opens in draw.io / diagrams.net.
 *
 * Shapes listed in `DRAWIO_MAPPED_SHAPES` become the matching draw.io shape;
 * every other node is written as a rectangle (containers as swimlanes) with
 * its label, colours and geometry intact. Children of containers are nested
 * with parent-relative geometry. Not exported: comments, locked state, icons,
 * shape-specific `data`, and the internal layout of structured shapes (their
 * `---` sections become horizontal rules in the label).
 *
 * The output is deterministic for a given document.
 */
export function exportDrawio(doc: DiagramDoc): string {
  const ids = new CellIds();
  const parents = exportParents(doc.nodes);
  const ordered = exportOrder(doc.nodes, parents);
  const nodeCells = new Map<Id, string>(ordered.map((node) => [node.id, ids.next(node.id)]));

  const cells: XmlElement[] = [xmlElement("mxCell", { id: ROOT_CELL }), xmlElement("mxCell", { id: LAYER_CELL, parent: ROOT_CELL })];
  for (const node of ordered) {
    const parent = parents.get(node.id);
    cells.push(vertexCell(node, nodeCells.get(node.id)!, parent, parent ? nodeCells.get(parent.id)! : LAYER_CELL));
  }
  for (const edge of edgesInOrder(doc.edges)) cells.push(...edgeCells(edge, ids.next(edge.id), nodeCells, ids));

  const { settings } = doc;
  const model = xmlElement(
    "mxGraphModel",
    {
      dx: 0,
      dy: 0,
      grid: settings.grid === "none" ? 0 : 1,
      gridSize: settings.gridSize,
      guides: 1,
      tooltips: 1,
      connect: 1,
      arrows: 1,
      fold: 1,
      page: 0,
      pageScale: 1,
      pageWidth: 850,
      pageHeight: 1100,
      math: 0,
      shadow: 0,
      background: settings.background === "none" ? undefined : settings.background,
    },
    [xmlElement("root", {}, cells)],
  );
  const diagram = xmlElement("diagram", { id: doc.id, name: doc.name }, [model]);
  return serializeXml(xmlElement("mxfile", { host: "Diagram AI", agent: "Diagram AI", compressed: "false" }, [diagram]), { declaration: true });
}

/* =================================================================== import */

export interface DrawioImport {
  /** Name of the imported page, when the file has one. */
  name?: string;
  spec: ElementsSpec;
  /** Everything that was skipped, approximated or could not be read, phrased for the user. */
  warnings: string[];
}

interface Geometry extends Rect {
  /** Position is a fraction of the parent (edge labels, ports). */
  relative: boolean;
  offset?: Point;
}

interface Cell {
  id: string;
  value: string;
  style: DrawioStyle;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  geometry: Geometry;
  link?: string;
  tooltip?: string;
}

/* ------------------------------------------------------------ reading cells */

function readGeometry(cell: XmlElement): Geometry {
  const element = firstChild(cell, "mxGeometry");
  const attrs = element?.attrs ?? {};
  const offset = element?.children.find((child) => child.name === "mxPoint" && child.attrs.as === "offset");
  return {
    x: numberOf(attrs.x) ?? 0,
    y: numberOf(attrs.y) ?? 0,
    w: numberOf(attrs.width) ?? 0,
    h: numberOf(attrs.height) ?? 0,
    relative: attrs.relative === "1",
    offset: offset ? { x: numberOf(offset.attrs.x) ?? 0, y: numberOf(offset.attrs.y) ?? 0 } : undefined,
  };
}

/** Reads an `<mxCell>`, or an `<object>` / `<UserObject>` wrapper that carries the id, label and metadata. */
function readCell(element: XmlElement, fallbackId: string): Cell | undefined {
  const wrapper = element.name === "mxCell" ? undefined : element;
  const cell = wrapper ? firstChild(wrapper, "mxCell") : element;
  if (!cell) return undefined;
  return {
    id: (wrapper ?? element).attrs.id ?? cell.attrs.id ?? fallbackId,
    value: (wrapper ? wrapper.attrs.label : cell.attrs.value) ?? "",
    style: parseStyle(cell.attrs.style),
    vertex: cell.attrs.vertex === "1",
    edge: cell.attrs.edge === "1",
    parent: cell.attrs.parent,
    source: cell.attrs.source,
    target: cell.attrs.target,
    geometry: readGeometry(cell),
    link: wrapper?.attrs.link || undefined,
    tooltip: wrapper?.attrs.tooltip || undefined,
  };
}

/** Cells in document order. A missing or repeated id cannot be referenced, but the cell is still drawn. */
function readCells(model: XmlElement): Cell[] {
  const root = firstChild(model, "root") ?? model;
  const seen = new Set<string>();
  const cells: Cell[] = [];
  root.children.forEach((child, index) => {
    const cell = readCell(child, `cell-${index}`);
    if (!cell) return;
    while (seen.has(cell.id)) cell.id = `${cell.id}-${index}`;
    seen.add(cell.id);
    cells.push(cell);
  });
  return cells;
}

/* ------------------------------------------------------------------- labels */

const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  le: "≤",
  ge: "≥",
  ne: "≠",
};

/** Marks a block boundary while tags are being stripped; runs of them collapse to one line break. */
const BLOCK = "\u0001";
/** A `<br>` right before a block boundary ends that line; it does not add an empty one. */
const BLOCK_RUN = /\n?[ \t]*\u0001[ \t\u0001]*/g;
const BLOCK_TAG = /<\/?(?:div|p|li|ul|ol|h[1-6]|tr|table|tbody|thead|blockquote|pre|section|article|header|footer)\b[^>]*>/gi;

/**
 * Plain text of an HTML label: `<br>` and block elements become line breaks,
 * `<hr>` a `---` section line, table cells are joined with ` | `, all other
 * markup is dropped and entities are decoded.
 */
function htmlToText(html: string): string {
  if (!html.includes("<") && !html.includes("&")) return html.trim();
  const lines = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/[ \t\r\f]+/g, " ")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, `${BLOCK}---${BLOCK}`)
    .replace(/<\/t[dh]\s*>\s*<t[dh]\b[^>]*>/gi, " | ")
    .replace(BLOCK_TAG, BLOCK)
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(BLOCK_RUN, "\n")
    .split("\n")
    .map((line) => line.trim());
  // Entities are decoded last so escaped markup stays text and `&nbsp;` indentation survives the trimming above.
  return decodeEntities(lines.join("\n"), HTML_ENTITIES)
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function labelText(cell: Cell): string {
  if (isOn(cell.style, "noLabel")) return "";
  return isOn(cell.style, "html") ? htmlToText(cell.value) : cell.value.trim();
}

/* ------------------------------------------------------------------- shapes */

/** draw.io shape name → our shapes, most specific first. Only `basic/*` and `flowchart/*` are guaranteed to exist. */
const SHAPE_CANDIDATES: Record<string, string[]> = {
  ellipse: ["basic/ellipse"],
  doubleEllipse: ["basic/ellipse"],
  rhombus: ["flowchart/decision"],
  hexagon: ["basic/hexagon"],
  parallelogram: ["flowchart/data"],
  trapezoid: ["basic/trapezoid"],
  cylinder: ["basic/cylinder"],
  cylinder2: ["basic/cylinder"],
  cylinder3: ["basic/cylinder"],
  datastore: ["basic/cylinder"],
  cloud: ["basic/cloud"],
  document: ["flowchart/document"],
  process: ["flowchart/predefined-process"],
  note: ["uml/note", "basic/note"],
  note2: ["uml/note", "basic/note"],
  callout: ["basic/callout"],
  step: ["basic/chevron"],
  cross: ["basic/cross"],
  plus: ["basic/cross"],
  cube: ["basic/cube"],
  line: ["basic/divider"],
  card: ["flowchart/card"],
  internalStorage: ["flowchart/internal-storage"],
  manualInput: ["flowchart/manual-input"],
  delay: ["flowchart/delay"],
  display: ["flowchart/display"],
  dataStorage: ["flowchart/stored-data"],
  offPageConnector: ["flowchart/off-page"],
  orEllipse: ["flowchart/or"],
  sumEllipse: ["flowchart/summing-junction"],
  collate: ["flowchart/collate"],
  sortShape: ["flowchart/sort"],
  loopLimit: ["flowchart/loop-limit"],
  umlActor: ["uml/actor", "actor"],
  actor: ["uml/actor", "actor"],
  umlLifeline: ["uml/lifeline"],
  umlFrame: ["uml/fragment"],
  umlBoundary: ["uml/boundary"],
  umlControl: ["uml/control"],
  umlEntity: ["uml/entity"],
  umlDestroy: ["uml/destroy"],
  startState: ["uml/initial-state"],
  endState: ["uml/final-state"],
  folder: ["uml/package"],
  component: ["uml/component"],
  module: ["uml/component"],
  "mxgraph.basic.star": ["basic/star"],
  "mxgraph.basic.pentagon": ["basic/pentagon"],
  "mxgraph.basic.octagon2": ["basic/octagon"],
  "mxgraph.flowchart.decision": ["flowchart/decision"],
  "mxgraph.flowchart.terminator": ["flowchart/terminator"],
  "mxgraph.flowchart.start_1": ["flowchart/terminator"],
  "mxgraph.flowchart.start_2": ["flowchart/connector"],
  "mxgraph.flowchart.process": ["flowchart/process"],
  "mxgraph.flowchart.predefined_process": ["flowchart/predefined-process"],
  "mxgraph.flowchart.data": ["flowchart/data"],
  "mxgraph.flowchart.document": ["flowchart/document"],
  "mxgraph.flowchart.document2": ["flowchart/document"],
  "mxgraph.flowchart.multi-document": ["flowchart/multi-document"],
  "mxgraph.flowchart.database": ["basic/cylinder"],
  "mxgraph.flowchart.direct_data": ["basic/cylinder"],
  "mxgraph.flowchart.manual_input": ["flowchart/manual-input"],
  "mxgraph.flowchart.manual_operation": ["flowchart/manual-operation"],
  "mxgraph.flowchart.preparation": ["flowchart/preparation"],
  "mxgraph.flowchart.delay": ["flowchart/delay"],
  "mxgraph.flowchart.display": ["flowchart/display"],
  "mxgraph.flowchart.stored_data": ["flowchart/stored-data"],
  "mxgraph.flowchart.internal_storage": ["flowchart/internal-storage"],
  "mxgraph.flowchart.on-page_reference": ["flowchart/connector"],
  "mxgraph.flowchart.off-page_reference": ["flowchart/off-page"],
  "mxgraph.flowchart.merge_or_storage": ["flowchart/merge"],
  "mxgraph.flowchart.extract_or_measurement": ["flowchart/extract"],
  "mxgraph.flowchart.or": ["flowchart/or"],
  "mxgraph.flowchart.or_2": ["flowchart/or"],
  "mxgraph.flowchart.summing_function": ["flowchart/summing-junction"],
  "mxgraph.flowchart.summing_junction": ["flowchart/summing-junction"],
  "mxgraph.flowchart.collate": ["flowchart/collate"],
  "mxgraph.flowchart.sort": ["flowchart/sort"],
  "mxgraph.flowchart.card": ["flowchart/card"],
  "mxgraph.flowchart.loop_limit": ["flowchart/loop-limit"],
};

/** Shape names that mean "an ordinary box". */
const BOX_NAMES = new Set(["", "rectangle", "rect", "label", "mxgraph.basic.rect", "partialRectangle", "tableRow"]);

const ARROW_BY_DIRECTION: Record<string, string> = {
  east: "basic/arrow-right",
  west: "basic/arrow-left",
  north: "basic/arrow-up",
  south: "basic/arrow-down",
};

/** A stadium: percentage arc sizes from here up read as fully rounded ends. */
const PILL_ARC_PERCENT = 40;

interface ResolvedShape {
  shape: string;
  /** Extra clockwise rotation needed to match draw.io's `direction` (our triangle points up). */
  quarterTurns?: number;
}

/** The name draw.io draws the cell with: `shape=…`, else the first style token. Icon stencils name the icon separately. */
function drawioShapeName(style: DrawioStyle): string {
  const { props } = style;
  return props.resIcon ?? props.prIcon ?? props.grIcon ?? props.shape ?? style.tokens[0] ?? "";
}

function firstResolvable(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const def = resolveShape(candidate);
    if (def) return def.id;
  }
  return undefined;
}

function boxShape(style: DrawioStyle): string {
  if (!isOn(style, "rounded")) return "basic/rect";
  const percent = numberOf(style.props.arcSize) ?? DRAWIO_ARC_PERCENT;
  return !isOn(style, "absoluteArcSize") && percent >= PILL_ARC_PERCENT ? "flowchart/terminator" : "basic/rounded";
}

function triangleShape(direction: string | undefined): ResolvedShape {
  if (direction === "north") return { shape: "basic/triangle" };
  if (direction === "south") return { shape: "flowchart/merge" };
  return { shape: "basic/triangle", quarterTurns: direction === "west" ? 3 : 1 };
}

/**
 * Picks our shape for a draw.io vertex. Unmapped stencils (`mxgraph.aws4.lambda`…)
 * get one more chance by their last name segment, since many of our shapes
 * carry such names as aliases. Returns undefined when nothing fits.
 */
function resolveVertexShape(style: DrawioStyle, label: string): ResolvedShape | undefined {
  const name = drawioShapeName(style);
  if (name === "swimlane" || name === "table") return { shape: "basic/frame" };
  if (name === "group") return { shape: "basic/group" };
  if (name === "text") return { shape: /^\s*<table\b/i.test(label) ? TABLE_SHAPE : "basic/text" };
  if (name === "triangle") return triangleShape(style.props.direction);
  if (name === "singleArrow") return { shape: ARROW_BY_DIRECTION[style.props.direction ?? "east"] ?? "basic/arrow-right" };
  if (name === "umlLifeline" && style.props.participant === "umlActor") {
    const lifeline = firstResolvable(["uml/actor-lifeline", "uml/lifeline"]);
    if (lifeline) return { shape: lifeline };
  }
  if (name === "ellipse" && style.props.aspect === "fixed") return { shape: "basic/circle" };

  const mapped = SHAPE_CANDIDATES[name];
  const known = mapped && firstResolvable(mapped);
  if (known) return { shape: known };
  if (BOX_NAMES.has(name)) return { shape: isOn(style, "container") ? "basic/group" : boxShape(style) };
  if (mapped) return undefined;

  const lastSegment = name.split(".").pop() ?? "";
  const guess = name.includes(".") ? resolveShape(lastSegment.replace(/_/g, "-")) : undefined;
  if (guess) return { shape: guess.id };
  return isOn(style, "container") ? { shape: "basic/group" } : undefined;
}

/* ------------------------------------------------------------------- styles */

/** draw.io colours we can represent: hex, `none`, and the light half of `light-dark(a, b)`. */
function colorOf(value: string | undefined): Color | undefined {
  if (!value) return undefined;
  const themed = /^light-dark\(\s*([^,]+),/i.exec(value);
  return normalizeColor(themed ? themed[1] : value);
}

function fontFamilyOf(value: string | undefined): FontFamily | undefined {
  if (!value) return undefined;
  const name = value.toLowerCase();
  return FONT_HINTS.find(([pattern]) => pattern.test(name))?.[1];
}

function dashOf(style: DrawioStyle): DashStyle {
  if (!isOn(style, "dashed")) return "solid";
  const firstDash = numberOf(style.props.dashPattern?.split(/[\s,]+/)[0]);
  return firstDash !== undefined && firstDash <= DOT_MAX_LENGTH ? "dotted" : "dashed";
}

const H_ALIGNS: Record<string, HAlign> = { left: "left", center: "center", right: "right" };
const V_ALIGNS: Record<string, VAlign> = { top: "top", middle: "middle", bottom: "bottom" };

/** Drops keys whose value is undefined so specs stay minimal. */
function compact<T extends object>(value: T): T {
  const out = {} as T;
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

function textStyleOf(style: DrawioStyle): TextStyle {
  const { props } = style;
  const bits = numberOf(props.fontStyle);
  return compact<TextStyle>({
    fontFamily: fontFamilyOf(props.fontFamily),
    fontSize: numberOf(props.fontSize),
    textColor: colorOf(props.fontColor),
    bold: bits === undefined ? undefined : (bits & FONT_BOLD) !== 0,
    italic: bits === undefined ? undefined : (bits & FONT_ITALIC) !== 0,
    underline: bits === undefined ? undefined : (bits & FONT_UNDERLINE) !== 0,
  });
}

function opacityOf(style: DrawioStyle): number | undefined {
  const percent = numberOf(style.props.opacity);
  return percent === undefined || percent >= 100 ? undefined : clamp01(percent / 100);
}

function radiusOf(style: DrawioStyle, size: { w: number; h: number }): number | undefined {
  if (style.props.rounded === undefined) return undefined;
  if (!isOn(style, "rounded")) return 0;
  const arc = numberOf(style.props.arcSize);
  if (isOn(style, "absoluteArcSize")) return round2((arc ?? 20) / 2);
  return round2((Math.min(size.w, size.h) * (arc ?? DRAWIO_ARC_PERCENT)) / 100);
}

/**
 * Only values present in the draw.io style are carried over; the rest falls
 * back to our shape defaults. The exception is the font size, where draw.io's
 * smaller default decides whether labels still fit their boxes.
 */
function nodeStyleOf(style: DrawioStyle, shape: string, size: { w: number; h: number }): NodeStyle {
  const { props } = style;
  const isSwimlane = drawioShapeName(style) === "swimlane";
  const labelOutside = props.verticalLabelPosition === "bottom" || props.verticalLabelPosition === "top";
  return compact<NodeStyle>({
    fill: colorOf(isSwimlane ? props.swimlaneFillColor : props.fillColor),
    stroke: colorOf(props.strokeColor),
    strokeWidth: numberOf(props.strokeWidth),
    dash: props.dashed === undefined ? undefined : dashOf(style),
    opacity: opacityOf(style),
    radius: shape === "flowchart/terminator" ? undefined : radiusOf(style, size),
    shadow: props.shadow === undefined ? undefined : isOn(style, "shadow"),
    fontSize: DRAWIO_FONT_SIZE,
    ...textStyleOf(style),
    align: H_ALIGNS[props.align ?? ""],
    valign: labelOutside ? undefined : V_ALIGNS[props.verticalAlign ?? ""],
  });
}

function markerOf(style: DrawioStyle, end: "start" | "end"): MarkerKind {
  const name = style.props[`${end}Arrow`] ?? (end === "end" ? "classic" : "none");
  const marker = MARKERS[name] ?? MARKERS.classic;
  return style.props[`${end}Fill`] === "0" ? marker.hollow : marker.filled;
}

function routingOf(style: DrawioStyle): EdgeRouting {
  if (isOn(style, "curved")) return "curved";
  const edgeStyle = style.props.edgeStyle;
  return !edgeStyle || edgeStyle === "none" ? "straight" : "orthogonal";
}

function edgeStyleOf(style: DrawioStyle): EdgeStyle {
  return compact<EdgeStyle>({
    stroke: colorOf(style.props.strokeColor),
    strokeWidth: numberOf(style.props.strokeWidth),
    opacity: opacityOf(style),
    ...textStyleOf(style),
    dash: dashOf(style),
    startMarker: markerOf(style, "start"),
    endMarker: markerOf(style, "end"),
  });
}

function anchorOf(style: DrawioStyle, prefix: "exit" | "entry"): Point | undefined {
  const x = numberOf(style.props[`${prefix}X`]);
  const y = numberOf(style.props[`${prefix}Y`]);
  return x === undefined || y === undefined ? undefined : { x: clamp01(x), y: clamp01(y) };
}

/* ---------------------------------------------------------------------- ids */

const UNSAFE_ID_CHARS = /[^A-Za-z0-9_.:-]+/g;
const MAX_ID_LENGTH = 64;

/** Turns draw.io cell ids into ids `applySpec` accepts as-is: safe characters, readable, unique. */
class SafeIds {
  private readonly taken = new Set<string>();

  next(raw: string, prefix: string): string {
    const cleaned = raw.replace(UNSAFE_ID_CHARS, "-").replace(/^[^A-Za-z0-9]+/, "");
    // Bare numbers (draw.io's "2", "3"…) are legal but say nothing; prefix them like empty ids.
    const base = (/^[0-9]*$/.test(cleaned) ? `${prefix}${cleaned || "cell"}` : cleaned).slice(0, MAX_ID_LENGTH - 6);
    let candidate = base;
    for (let i = 2; this.taken.has(candidate); i++) candidate = `${base}-${i}`;
    this.taken.add(candidate);
    return candidate;
  }
}

/* ----------------------------------------------------------------- building */

/** Top-left corner in page coordinates: draw.io stores children relative to their parent cell. */
function absolutePosition(cell: Cell, byId: Map<string, Cell>, trail = new Set<string>()): Point {
  const { geometry } = cell;
  const parent = cell.parent === undefined ? undefined : byId.get(cell.parent);
  if (!parent?.vertex || trail.has(cell.id)) return { x: geometry.x, y: geometry.y };
  trail.add(cell.id);
  const base = absolutePosition(parent, byId, trail);
  if (!geometry.relative) return { x: base.x + geometry.x, y: base.y + geometry.y };
  return {
    x: base.x + geometry.x * parent.geometry.w + (geometry.offset?.x ?? 0),
    y: base.y + geometry.y * parent.geometry.h + (geometry.offset?.y ?? 0),
  };
}

/** Box of a node whose shape must be turned by quarter turns: same centre, sides swapped for odd turns. */
function turnedBox(rect: Rect, quarterTurns: number): Rect {
  if (quarterTurns % 2 === 0) return rect;
  return { x: rect.x + (rect.w - rect.h) / 2, y: rect.y + (rect.h - rect.w) / 2, w: rect.h, h: rect.w };
}

interface ImportContext {
  byId: Map<string, Cell>;
  ids: SafeIds;
  /** draw.io cell id → imported node id. */
  nodeIds: Map<string, string>;
  /** draw.io cell id → our shape id, for deciding which parents can hold children. */
  shapes: Map<string, string>;
  unknownShapes: Set<string>;
}

function nodeSpecOf(cell: Cell, context: ImportContext): NodeSpec {
  const resolved = resolveVertexShape(cell.style, cell.value);
  if (!resolved) context.unknownShapes.add(drawioShapeName(cell.style) || "(unnamed)");
  const shape = resolved?.shape ?? "basic/rect";
  const quarterTurns = resolved?.quarterTurns ?? 0;
  const position = absolutePosition(cell, context.byId);
  const rect = turnedBox({ ...position, w: cell.geometry.w, h: cell.geometry.h }, quarterTurns);
  const rotation = ((numberOf(cell.style.props.rotation) ?? 0) + quarterTurns * 90) % 360;
  const style = nodeStyleOf(cell.style, shape, rect);

  const isLifeline = drawioShapeName(cell.style) === "umlLifeline" && Boolean(resolved);

  context.shapes.set(cell.id, shape);
  return compact<NodeSpec>({
    id: context.nodeIds.get(cell.id),
    shape,
    text: labelText(cell),
    x: round2(rect.x),
    y: round2(rect.y),
    w: round2(rect.w),
    h: round2(rect.h),
    rotation: rotation ? round2(rotation) : undefined,
    style,
    data: isLifeline ? { header: numberOf(cell.style.props.size) ?? DRAWIO_LIFELINE_HEADER } : undefined,
    link: cell.link,
    note: cell.tooltip,
  });
}

/** Child labels of an edge (`edgeLabel` cells), sorted into start / middle / end by their relative position. */
function edgeLabels(edge: Cell, labels: Cell[]): Pick<EdgeSpec, "text" | "startText" | "endText"> {
  const slots: Record<"start" | "middle" | "end", string[]> = { start: [], middle: [labelText(edge)], end: [] };
  for (const label of labels) {
    const at = label.geometry.relative ? label.geometry.x : 0;
    slots[at <= -0.4 ? "start" : at >= 0.4 ? "end" : "middle"].push(labelText(label));
  }
  const join = (parts: string[]): string | undefined => parts.filter(Boolean).join("\n") || undefined;
  return { text: join(slots.middle), startText: join(slots.start), endText: join(slots.end) };
}

function edgeSpecOf(edge: Cell, labels: Cell[], from: string, to: string, context: ImportContext): EdgeSpec {
  return compact<EdgeSpec>({
    id: context.ids.next(edge.id, "e-"),
    from,
    to,
    ...edgeLabels(edge, labels),
    routing: routingOf(edge.style),
    style: edgeStyleOf(edge.style),
    fromAnchor: anchorOf(edge.style, "exit"),
    toAnchor: anchorOf(edge.style, "entry"),
  });
}

const MAX_LISTED_SHAPES = 12;

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED_SHAPES).join(", ");
  return names.length > MAX_LISTED_SHAPES ? `${shown} and ${names.length - MAX_LISTED_SHAPES} more` : shown;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

function buildSpec(cells: Cell[], warnings: string[]): ElementsSpec {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const isEdgeLabel = (cell: Cell): boolean => cell.vertex && cell.parent !== undefined && byId.get(cell.parent)?.edge === true;
  const vertices = cells.filter((cell) => cell.vertex && !isEdgeLabel(cell));
  const edgeCellsIn = cells.filter((cell) => cell.edge);

  const ids = new SafeIds();
  const context: ImportContext = {
    byId,
    ids,
    nodeIds: new Map(vertices.map((cell) => [cell.id, ids.next(cell.id, "n-")])),
    shapes: new Map(),
    unknownShapes: new Set(),
  };

  const nodes = vertices.map((cell) => nodeSpecOf(cell, context));
  // Any draw.io cell can hold children; ours must be a container shape. Positions are absolute either way.
  vertices.forEach((cell, index) => {
    const parentShape = cell.parent === undefined ? undefined : context.shapes.get(cell.parent);
    if (parentShape && getShape(parentShape).container) nodes[index].parent = context.nodeIds.get(cell.parent!);
  });

  const labelsByEdge = new Map<string, Cell[]>();
  for (const cell of cells) {
    if (!isEdgeLabel(cell)) continue;
    const labels = labelsByEdge.get(cell.parent!);
    if (labels) labels.push(cell);
    else labelsByEdge.set(cell.parent!, [cell]);
  }

  const edges: EdgeSpec[] = [];
  let floating = 0;
  for (const edge of edgeCellsIn) {
    const from = edge.source === undefined ? undefined : context.nodeIds.get(edge.source);
    const to = edge.target === undefined ? undefined : context.nodeIds.get(edge.target);
    if (!from || !to) {
      floating++;
      continue;
    }
    edges.push(edgeSpecOf(edge, labelsByEdge.get(edge.id) ?? [], from, to, context));
  }

  if (!nodes.length && !edgeCellsIn.length) warnings.push("The draw.io page contains no shapes or connectors.");
  if (context.unknownShapes.size) {
    const names = [...context.unknownShapes].sort();
    const one = names.length === 1;
    warnings.push(`${plural(names.length, "draw.io shape type")} ${one ? "has" : "have"} no equivalent and ${one ? "was" : "were"} imported as rectangles: ${listNames(names)}.`);
  }
  if (floating) {
    warnings.push(
      `${plural(floating, "connector")} skipped because ${floating === 1 ? "it is" : "they are"} not attached to a shape at both ends (free-floating ends cannot be imported).`,
    );
  }
  return { nodes, edges };
}

/* ---------------------------------------------------------- locating a page */

const COMPRESSION_HINT = "Save the file uncompressed in draw.io (File → Properties → uncheck Compressed) and import it again.";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function inflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // Corrupt data rejects both ends of the stream; the read below reports it.
  const written = writer.write(bytes).then(() => writer.close());
  written.catch(() => undefined);

  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await written;
  return text + decoder.decode();
}

/** A compressed page is base64 → raw deflate → URL-encoded XML. */
async function decompressPage(payload: string, warnings: string[]): Promise<XmlElement | undefined> {
  if (typeof DecompressionStream === "undefined" || typeof atob === "undefined") {
    warnings.push(`This draw.io file is compressed and this environment cannot decompress it. ${COMPRESSION_HINT}`);
    return undefined;
  }
  try {
    return parseXml(decodeURIComponent(await inflateRaw(base64ToBytes(payload))));
  } catch {
    warnings.push(`The compressed diagram data in this draw.io file could not be decoded. ${COMPRESSION_HINT}`);
    return undefined;
  }
}

async function pageModel(diagram: XmlElement, warnings: string[]): Promise<XmlElement | undefined> {
  const inline = firstChild(diagram, "mxGraphModel");
  if (inline) return inline;
  const payload = diagram.text.trim();
  if (!payload) {
    warnings.push("The draw.io page is empty.");
    return undefined;
  }
  if (payload.startsWith("<")) return findElement(parseXml(payload), "mxGraphModel");
  if (/^%3C/i.test(payload)) return findElement(parseXml(decodeURIComponent(payload)), "mxGraphModel");
  const model = await decompressPage(payload, warnings);
  return model && findElement(model, "mxGraphModel");
}

interface Page {
  name?: string;
  model: XmlElement;
}

/** Finds the graph model of the first page in an `<mxfile>`, a bare `<diagram>` / `<mxGraphModel>`, or an editable SVG export embedding one. */
async function locatePage(root: XmlElement, warnings: string[], depth = 0): Promise<Page | undefined> {
  if (root.name === "mxGraphModel") return { model: root };

  const diagrams = root.name === "diagram" ? [root] : root.name === "mxfile" ? childrenNamed(root, "diagram") : [];
  if (diagrams.length) {
    const [first, ...rest] = diagrams;
    if (rest.length) {
      const skipped = rest.map((diagram, index) => `"${diagram.attrs.name || `Page-${index + 2}`}"`).join(", ");
      warnings.push(`The file has ${diagrams.length} pages; only the first ("${first.attrs.name || "Page-1"}") was imported. Skipped ${plural(rest.length, "page")}: ${skipped}.`);
    }
    const model = await pageModel(first, warnings);
    return model && { name: first.attrs.name || undefined, model };
  }
  if (root.name === "mxfile") {
    warnings.push("The draw.io file contains no pages.");
    return undefined;
  }

  // draw.io's editable SVG export carries the whole file in its `content` attribute.
  const embedded = root.attrs.content;
  if (embedded?.includes("<") && depth < 2) return locatePage(parseXml(embedded), warnings, depth + 1);

  const nested = findElement(root, "mxGraphModel");
  if (nested) return { model: nested };
  warnings.push(`This is not a draw.io file: expected <mxfile> or <mxGraphModel> but found <${root.name}>.`);
  return undefined;
}

const emptyImport = (warnings: string[]): DrawioImport => ({ spec: { nodes: [], edges: [] }, warnings });

/**
 * Reads a draw.io / diagrams.net file into a spec for `applySpec`.
 *
 * Accepts an `<mxfile>` (first page only — further pages are reported in
 * `warnings`), a bare `<mxGraphModel>`, and compressed pages when the runtime
 * has `DecompressionStream` (browsers, Node 18+). Nodes come back with
 * explicit safe ids, absolute coordinates, sizes, container `parent`s and
 * rotation; edges with their endpoints, labels, routing, markers and fixed
 * anchors. Waypoints are dropped (routes are recomputed) and connectors with a
 * free end are skipped, because a spec edge must join two nodes. Shapes
 * without an equivalent become rectangles and are listed in one warning.
 *
 * Never throws: unreadable input yields an empty spec and a warning.
 */
export async function importDrawio(xml: string): Promise<DrawioImport> {
  const warnings: string[] = [];
  try {
    if (typeof xml !== "string" || !xml.trim()) return emptyImport(["The draw.io file is empty."]);
    const page = await locatePage(parseXml(xml), warnings);
    if (!page) return emptyImport(warnings.length ? warnings : ["No diagram was found in the draw.io file."]);
    return { name: page.name, spec: buildSpec(readCells(page.model), warnings), warnings };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return emptyImport([...warnings, `The draw.io file could not be read. ${reason}`]);
  }
}
