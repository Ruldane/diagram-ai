import { newDiagramId } from "./ids";
import { INK, PAPER } from "./palette";
import {
  SCHEMA_VERSION,
  type DiagramDoc,
  type DiagramSummary,
  type DocSettings,
  type EdgeStyle,
  type LayoutOptions,
  type NodeStyle,
} from "./types";

export type ResolvedNodeStyle = Required<NodeStyle>;
export type ResolvedEdgeStyle = Required<EdgeStyle>;

export const DEFAULT_NODE_STYLE: ResolvedNodeStyle = {
  fill: PAPER,
  stroke: INK,
  strokeWidth: 1.5,
  dash: "solid",
  opacity: 1,
  radius: 0,
  shadow: false,
  fontFamily: "sans",
  fontSize: 14,
  bold: false,
  italic: false,
  underline: false,
  textColor: INK,
  align: "center",
  valign: "middle",
};

export const DEFAULT_EDGE_STYLE: ResolvedEdgeStyle = {
  stroke: INK,
  strokeWidth: 1.5,
  dash: "solid",
  opacity: 1,
  startMarker: "none",
  endMarker: "arrow",
  animated: false,
  fontFamily: "sans",
  fontSize: 12,
  bold: false,
  italic: false,
  underline: false,
  textColor: INK,
  align: "center",
  valign: "middle",
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  algorithm: "layered",
  direction: "down",
  spacing: 48,
  rankSpacing: 72,
};

export const DEFAULT_SETTINGS: DocSettings = {
  background: PAPER,
  grid: "dots",
  gridSize: 10,
  snap: true,
  routing: "orthogonal",
  layout: DEFAULT_LAYOUT,
  autoLayout: true,
};

export function resolveNodeStyle(...layers: (NodeStyle | undefined)[]): ResolvedNodeStyle {
  return Object.assign({}, DEFAULT_NODE_STYLE, ...layers.map(stripUndefined));
}

export function resolveEdgeStyle(...layers: (EdgeStyle | undefined)[]): ResolvedEdgeStyle {
  return Object.assign({}, DEFAULT_EDGE_STYLE, ...layers.map(stripUndefined));
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

export interface NewDiagramInput {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  settings?: Partial<DocSettings>;
}

export function createDoc(input: NewDiagramInput = {}, now = new Date()): DiagramDoc {
  const timestamp = now.toISOString();
  return {
    schema: SCHEMA_VERSION,
    id: input.id ?? newDiagramId(),
    name: input.name?.trim() || "Untitled diagram",
    type: input.type ?? "flowchart",
    description: input.description,
    nodes: {},
    edges: {},
    comments: {},
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 0,
  };
}

export function summarize(doc: DiagramDoc): DiagramSummary {
  return {
    id: doc.id,
    name: doc.name,
    type: doc.type,
    description: doc.description,
    nodeCount: Object.keys(doc.nodes).length,
    edgeCount: Object.keys(doc.edges).length,
    openComments: Object.values(doc.comments).filter((c) => !c.resolved).length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    version: doc.version,
  };
}
