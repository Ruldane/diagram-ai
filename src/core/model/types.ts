/**
 * The diagram document model.
 *
 * Everything in `src/core` is framework-agnostic and free of DOM / Node APIs so
 * the exact same code runs in the browser editor, in the server (REST + MCP)
 * and in unit tests.
 */

export type Id = string;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Point, Size {}

/* ------------------------------------------------------------------ styles */

export type FontFamily = "sans" | "serif" | "mono" | "hand";
export type DashStyle = "solid" | "dashed" | "dotted";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

/** Colors are `#rrggbb` hex strings or `"none"`. */
export type Color = string;

export interface TextStyle {
  fontFamily?: FontFamily;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  textColor?: Color;
  align?: HAlign;
  valign?: VAlign;
}

export interface NodeStyle extends TextStyle {
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  dash?: DashStyle;
  opacity?: number;
  /** Corner radius for shapes that support it. */
  radius?: number;
  shadow?: boolean;
}

export type MarkerKind =
  | "none"
  | "arrow"
  | "open-arrow"
  | "triangle"
  | "triangle-open"
  | "diamond"
  | "diamond-open"
  | "circle"
  | "circle-open"
  | "bar"
  | "cross"
  | "crow-one"
  | "crow-many"
  | "crow-zero-one"
  | "crow-one-many"
  | "crow-zero-many";

export type EdgeRouting = "straight" | "orthogonal" | "curved";

export interface EdgeStyle extends TextStyle {
  stroke?: Color;
  strokeWidth?: number;
  dash?: DashStyle;
  opacity?: number;
  startMarker?: MarkerKind;
  endMarker?: MarkerKind;
  /** Animated dash flow in the editor (rendered as a plain dash in exports). */
  animated?: boolean;
}

/* ------------------------------------------------------------------ actors */

export type ActorKind = "human" | "agent" | "system";

export interface Actor {
  kind: ActorKind;
  /** Stable identifier, e.g. `claude-code`, `codex`, or a browser client id. */
  id: string;
  name: string;
}

/* ---------------------------------------------------------------- elements */

export interface DNode {
  id: Id;
  /** Shape registry id, e.g. `flowchart/decision`. */
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the node centre. */
  rotation?: number;
  /** Stacking order; higher renders on top. */
  z: number;
  /** Containing node (frame, swimlane, group…). Coordinates stay absolute. */
  parent?: Id;
  /** Main label. Structured shapes split it into compartments on `---` lines. */
  text?: string;
  /** Shape-specific parameters (icon name, stereotype, header colour…). */
  data?: Record<string, unknown>;
  style?: NodeStyle;
  locked?: boolean;
  /** Optional hyperlink opened from the editor and kept in exports. */
  link?: string;
  /** Free-form note for collaborators / agents (not rendered on canvas). */
  note?: string;
  createdBy?: Actor;
}

/** Where an edge end sits on its node, relative to the node box (0..1). */
export type Anchor = "auto" | Point;

export interface EdgeEnd {
  /** Attached node. When absent the end is free and `point` is used. */
  node?: Id;
  anchor?: Anchor;
  point?: Point;
}

export interface DEdge {
  id: Id;
  from: EdgeEnd;
  to: EdgeEnd;
  routing: EdgeRouting;
  /** Manual or layout-computed bend points, in absolute coordinates. */
  waypoints?: Point[];
  /**
   * True when the anchors and bend points were computed by auto-layout. Such a
   * route is discarded (and recomputed on the fly) as soon as an end moves.
   */
  autoRoute?: boolean;
  /** Label at the middle of the edge. */
  text?: string;
  /** Label near the source end (multiplicity, role…). */
  startText?: string;
  /** Label near the target end. */
  endText?: string;
  style?: EdgeStyle;
  z?: number;
  note?: string;
  createdBy?: Actor;
}

export interface CommentReply {
  id: Id;
  author: Actor;
  text: string;
  createdAt: string;
}

export interface DComment {
  id: Id;
  /** Element the comment is pinned to. Free-floating when absent. */
  target?: Id;
  /** Pin position (absolute). For pinned comments it is the fallback position. */
  x: number;
  y: number;
  author: Actor;
  text: string;
  createdAt: string;
  resolved?: boolean;
  replies: CommentReply[];
}

/* ---------------------------------------------------------------- document */

export type LayoutAlgorithm = "layered" | "tree" | "force" | "radial" | "grid";
export type LayoutDirection = "down" | "right" | "up" | "left";

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  direction: LayoutDirection;
  /** Gap between sibling nodes. */
  spacing?: number;
  /** Gap between ranks / layers. */
  rankSpacing?: number;
}

export interface DocSettings {
  background: Color;
  grid: "dots" | "lines" | "none";
  gridSize: number;
  snap: boolean;
  /** Routing applied to newly created edges. */
  routing: EdgeRouting;
  /** Layout used by "auto layout" for this diagram. */
  layout: LayoutOptions;
  /**
   * True while positions are still machine-computed. Cleared as soon as a
   * human moves something, so agents stop re-flowing a hand-tuned diagram.
   */
  autoLayout: boolean;
}

export const SCHEMA_VERSION = 1;

export interface DiagramDoc {
  schema: typeof SCHEMA_VERSION;
  id: Id;
  name: string;
  /** Diagram type id from the catalog, e.g. `uml-class`. */
  type: string;
  description?: string;
  nodes: Record<Id, DNode>;
  edges: Record<Id, DEdge>;
  comments: Record<Id, DComment>;
  settings: DocSettings;
  createdAt: string;
  updatedAt: string;
  /** Monotonic revision, incremented by the server on every change. */
  version: number;
}

export interface DiagramSummary {
  id: Id;
  name: string;
  type: string;
  description?: string;
  nodeCount: number;
  edgeCount: number;
  openComments: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/* ------------------------------------------------------------------- patch */

export interface ElementPatch<T> {
  /** Upsert whole elements (last writer wins per element). */
  set?: T[];
  remove?: Id[];
}

export type DocMeta = Partial<Pick<DiagramDoc, "name" | "type" | "description">> & {
  settings?: Partial<DocSettings>;
};

/**
 * The single unit of change. Used for local edits, undo/redo, the REST API,
 * server-sent events and MCP tools alike.
 */
export interface Patch {
  nodes?: ElementPatch<DNode>;
  edges?: ElementPatch<DEdge>;
  comments?: ElementPatch<DComment>;
  doc?: DocMeta;
}

export type ElementKind = "node" | "edge" | "comment";
