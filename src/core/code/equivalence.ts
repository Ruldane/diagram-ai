import { createDoc } from "../model/defaults";
import type { DEdge, DiagramDoc, DNode, EdgeStyle, Id, LayoutDirection } from "../model/types";
import { exportMermaid, importMermaid } from "../io/mermaid";

/**
 * Helpers that tell "the text says something different" from "the text
 * cannot say what the canvas has". Mermaid has no notion of most shapes or
 * markers, so applying generated text back must not flatten them.
 */

/** Deep equality that ignores key order and `undefined` members. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = (value: Record<string, unknown>): string[] => Object.keys(value).filter((key) => value[key] !== undefined);
  const leftKeys = keys(left);
  return leftKeys.length === keys(right).length && leftKeys.every((key) => sameValue(left[key], right[key]));
}

const probe = (): DiagramDoc => createDoc({ name: "probe" }, new Date(0));

const shapeCache = new Map<string, string | undefined>();

/** The shape a node of `shape` comes back as after a trip through Mermaid text. */
export function mermaidShapeOf(shape: string): string | undefined {
  if (shapeCache.has(shape)) return shapeCache.get(shape);
  const node: DNode = { id: "a", shape, x: 0, y: 0, w: 120, h: 60, z: 1, text: "a" };
  const result = importMermaid(exportMermaid({ ...probe(), nodes: { a: node } })).spec.nodes?.[0]?.shape;
  shapeCache.set(shape, result);
  return result;
}

export interface MermaidLink {
  kind?: string;
  style?: EdgeStyle;
}

const linkCache = new Map<string, MermaidLink>();

/** The kind and style a connector comes back with after a trip through Mermaid text. */
export function mermaidLinkOf(style: EdgeStyle | undefined): MermaidLink {
  const key = [style?.startMarker, style?.endMarker, style?.dash, (style?.strokeWidth ?? 0) >= 3 ? "thick" : ""].join("|");
  const cached = linkCache.get(key);
  if (cached) return cached;
  const nodes: Record<Id, DNode> = {
    a: { id: "a", shape: "flowchart/process", x: 0, y: 0, w: 100, h: 50, z: 1, text: "a" },
    b: { id: "b", shape: "flowchart/process", x: 0, y: 200, w: 100, h: 50, z: 2, text: "b" },
  };
  const edge: DEdge = { id: "e", from: { node: "a" }, to: { node: "b" }, routing: "straight", ...(style ? { style } : {}) };
  const imported = importMermaid(exportMermaid({ ...probe(), nodes, edges: { e: edge } })).spec.edges?.[0];
  const link: MermaidLink = { ...(imported?.kind ? { kind: imported.kind } : {}), ...(imported?.style ? { style: imported.style } : {}) };
  linkCache.set(key, link);
  return link;
}

/* ------------------------------------------------------------------ ids */

/** Words `exportMermaid` appends an underscore to, because Mermaid would read them as syntax. */
const RESERVED_IDS = new Set(["end", "subgraph", "graph", "flowchart", "style", "class", "classdef", "click", "linkstyle", "direction", "default", "participant", "actor"]);

/**
 * The ids `exportMermaid` writes for the nodes of a flowchart, mapped back to
 * node ids. Text generated from the canvas uses these, so applying it again
 * can recognise the nodes it came from.
 */
export function exportedFlowIds(doc: Pick<DiagramDoc, "nodes" | "settings">): Map<string, Id> {
  const direction: LayoutDirection = doc.settings.layout.direction;
  const horizontal = direction === "right" || direction === "left";
  const sign = direction === "up" || direction === "left" ? -1 : 1;
  const main = (node: DNode): number => sign * (horizontal ? node.x + node.w / 2 : node.y + node.h / 2);
  const cross = (node: DNode): number => (horizontal ? node.y + node.h / 2 : node.x + node.w / 2);
  const ordered = Object.values(doc.nodes).sort((a, b) => main(a) - main(b) || cross(a) - cross(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const out = new Map<string, Id>();
  for (const node of ordered) {
    const base = node.id.replace(/[^A-Za-z0-9_]+/g, "_") || "n";
    let candidate = RESERVED_IDS.has(base.toLowerCase()) ? `${base}_` : base;
    for (let i = 2; out.has(candidate); i++) candidate = `${base}_${i}`;
    out.set(candidate, node.id);
  }
  return out;
}
