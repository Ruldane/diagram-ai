import type { EdgeGeometry } from "@/core/edges/geometry";
import { edgePrims } from "@/core/edges/render";
import { pathToSvg } from "@/core/geometry/path";
import type { Color, DEdge, DNode } from "@/core/model/types";
import { nodePrims } from "@/core/render/scene";
import { primToSvg } from "@/core/render/svg";
import { registryVersion, shapeOutline } from "@/core/shapes/registry";

/**
 * The canvas draws elements with the very same SVG serializer the exporters
 * use, so what you see is exactly what gets exported. Each element also gets
 * an invisible, slightly fat hit area so thin shapes are easy to grab.
 */

let nodeCache = new WeakMap<DNode, string>();
let nodeCacheVersion = registryVersion();

export function nodeMarkup(node: DNode): string {
  // Icon packs come and go: what a shape id draws changes with them.
  if (nodeCacheVersion !== registryVersion()) {
    nodeCache = new WeakMap();
    nodeCacheVersion = registryVersion();
  }
  let markup = nodeCache.get(node);
  if (markup === undefined) {
    const hit = `<path d="${pathToSvg(shapeOutline(node))}" fill="transparent" stroke="transparent" stroke-width="10" pointer-events="all"/>`;
    markup = hit + nodePrims(node).map(primToSvg).join("");
    nodeCache.set(node, markup);
  }
  return markup;
}

export interface EdgeMarkup {
  line: string;
  labels: string;
}

export function edgeMarkup(edge: DEdge, geometry: EdgeGeometry, background: Color): EdgeMarkup {
  const prims = edgePrims(edge, geometry, background);
  const d = pathToSvg(geometry.path);
  const hit = `<path d="${d}" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke"/>`;
  let line = prims.line.map(primToSvg).join("");
  // The first path is the line itself; give it the flowing-dash class when animated.
  if (edge.style?.animated) line = line.replace("<path ", '<path class="edge-flow" ');
  return { line: hit + line, labels: prims.labels.map(primToSvg).join("") };
}
