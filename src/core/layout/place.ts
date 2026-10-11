import { expand, intersects } from "../geometry/basics";
import { nodeBounds } from "../model/queries";
import type { DiagramDoc, DNode, Id, LayoutDirection, Patch, Rect } from "../model/types";

/**
 * Incremental placement: positions freshly added nodes next to the nodes they
 * connect to, without disturbing anything a person has already arranged.
 * Used instead of a full re-layout once a diagram has been hand-tuned.
 */
export function placeNear(doc: Pick<DiagramDoc, "nodes" | "edges" | "settings">, ids: Id[]): Patch {
  const pending = new Set(ids.filter((id) => id in doc.nodes));
  if (pending.size === 0) return {};

  const direction: LayoutDirection = doc.settings.layout.direction;
  const spacing = doc.settings.layout.spacing ?? 48;
  const rank = doc.settings.layout.rankSpacing ?? 72;
  const horizontal = direction === "right" || direction === "left";
  const sign = direction === "up" || direction === "left" ? -1 : 1;

  const neighbours = new Map<Id, Id[]>();
  for (const edge of Object.values(doc.edges)) {
    const a = edge.from.node;
    const b = edge.to.node;
    if (!a || !b || a === b) continue;
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }

  const placed = new Map<Id, DNode>();
  const occupied: Rect[] = Object.values(doc.nodes)
    .filter((n) => !pending.has(n.id) && !n.parent)
    .map(nodeBounds);
  const isFree = (rect: Rect) => !occupied.some((other) => intersects(expand(rect, spacing / 3), other));

  // Nodes attached to something already placed go first, then their own neighbours, and so on.
  const queue = [...pending];
  let progressed = true;
  while (queue.length && progressed) {
    progressed = false;
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      const node = doc.nodes[id];
      const anchor = (neighbours.get(id) ?? []).map((n) => placed.get(n) ?? (pending.has(n) ? undefined : doc.nodes[n])).find(Boolean);
      if (!anchor) continue;

      const base = horizontal
        ? { x: sign > 0 ? anchor.x + anchor.w + rank : anchor.x - rank - node.w, y: anchor.y + (anchor.h - node.h) / 2 }
        : { x: anchor.x + (anchor.w - node.w) / 2, y: sign > 0 ? anchor.y + anchor.h + rank : anchor.y - rank - node.h };
      // Slide sideways (alternating) until the spot is free.
      const step = (horizontal ? node.h : node.w) + spacing;
      let candidate: Rect = { ...base, w: node.w, h: node.h };
      for (let attempt = 1; attempt <= 40 && !isFree(candidate); attempt++) {
        const offset = Math.ceil(attempt / 2) * step * (attempt % 2 ? 1 : -1);
        candidate = horizontal ? { ...candidate, y: base.y + offset } : { ...candidate, x: base.x + offset };
      }
      const next = { ...node, x: Math.round(candidate.x), y: Math.round(candidate.y) };
      placed.set(id, next);
      occupied.push(nodeBounds(next));
      queue.splice(i--, 1);
      progressed = true;
    }
  }
  // Unconnected nodes keep the free spot they were given when created.
  return placed.size ? { nodes: { set: [...placed.values()] } } : {};
}
