import { expand } from "../geometry/basics";
import { descendantsOf, edgesWithin, nodeBounds } from "../model/queries";
import type { DiagramDoc, Id, Rect } from "../model/types";
import { buildScene, type Scene } from "../render/scene";

/** One exported page / slide / image. */
export interface ExportPage {
  name: string;
  scene: Scene;
  /** Region of the scene shown on the page (world coordinates, padding included). */
  view: Rect;
}

export type ExportScope =
  | { kind: "all" }
  /** Only these elements (the current selection). */
  | { kind: "selection"; ids: Id[] }
  /** One page per frame, in reading order. */
  | { kind: "frames" };

export const FRAME_SHAPE = "basic/frame";
const EMPTY_VIEW: Rect = { x: 0, y: 0, w: 480, h: 320 };

/** Frames sorted top-to-bottom then left-to-right, the order they become pages. */
export function framesInOrder(doc: Pick<DiagramDoc, "nodes">): { id: Id; name: string; bounds: Rect }[] {
  return Object.values(doc.nodes)
    .filter((node) => node.shape === FRAME_SHAPE && !node.parent)
    .sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x))
    .map((node) => ({ id: node.id, name: (node.text ?? "").split("\n")[0] || "Frame", bounds: nodeBounds(node) }));
}

/**
 * Splits a document into export pages. Every format (SVG, PNG, PDF, PPTX)
 * goes through this, so "what gets exported" is defined in one place.
 */
export function exportPages(doc: DiagramDoc, scope: ExportScope = { kind: "all" }, padding = 24): ExportPage[] {
  if (scope.kind === "frames") {
    const frames = framesInOrder(doc);
    if (frames.length) {
      return frames.map((frame) => {
        const members = new Set<Id>([frame.id, ...descendantsOf(doc.nodes, [frame.id]).map((n) => n.id)]);
        for (const edge of edgesWithin(doc.edges, members)) members.add(edge.id);
        return { name: frame.name, scene: buildScene(doc, { only: members }), view: frame.bounds };
      });
    }
  }

  if (scope.kind === "selection" && scope.ids.length) {
    const members = new Set<Id>(scope.ids);
    for (const node of descendantsOf(doc.nodes, scope.ids)) members.add(node.id);
    const nodeIds = new Set([...members].filter((id) => id in doc.nodes));
    for (const edge of edgesWithin(doc.edges, nodeIds)) members.add(edge.id);
    const scene = buildScene(doc, { only: members });
    return [{ name: doc.name, scene, view: scene.bounds ? expand(scene.bounds, padding) : EMPTY_VIEW }];
  }

  const scene = buildScene(doc);
  return [{ name: doc.name, scene, view: scene.bounds ? expand(scene.bounds, padding) : EMPTY_VIEW }];
}

export function safeFileName(name: string, fallback = "diagram"): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 _.-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return cleaned || fallback;
}
