import { computeLayout, type ElkLike } from "../layout/layout";
import { placeNear } from "../layout/place";
import { applyPatch, mergePatches } from "../model/patch";
import type { DiagramDoc, DNode, Id, LayoutOptions, Patch, Point } from "../model/types";
import type { CodePlan } from "./apply";

/**
 * Finishes a plan: decides where its new elements go and returns the
 * complete patch. Kept apart from `planCodeApply` because layout is
 * asynchronous (ELK), while planning is pure and synchronous.
 */

/** Lays out `ids` among themselves where they are, without touching the document's layout settings. */
async function layoutGroup(doc: DiagramDoc, ids: Id[], options: LayoutOptions, elk: ElkLike): Promise<Patch> {
  if (!ids.length) return {};
  const patch = await computeLayout(doc, options, elk, { ids: new Set(ids) });
  // A partial layout must not claim the whole diagram is machine-arranged.
  delete patch.doc;
  return patch;
}

/** New nodes that connect (directly or through other new nodes) to something already on the canvas. */
function attached(doc: DiagramDoc, ids: Id[]): Set<Id> {
  const pending = new Set(ids);
  const neighbours = new Map<Id, Id[]>();
  for (const edge of Object.values(doc.edges)) {
    const a = edge.from.node;
    const b = edge.to.node;
    if (!a || !b || a === b) continue;
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const reached = new Set<Id>();
  const queue = ids.filter((id) => (neighbours.get(id) ?? []).some((other) => !pending.has(other)));
  for (const id of queue) reached.add(id);
  while (queue.length) {
    for (const other of neighbours.get(queue.pop()!) ?? []) {
      if (pending.has(other) && !reached.has(other)) {
        reached.add(other);
        queue.push(other);
      }
    }
  }
  return reached;
}

/** The layout moved to start at `anchor`, with every node and route included (a shifted layout cannot skip "unchanged" nodes). */
function shifted(laid: DiagramDoc, meta: Patch["doc"], anchor: Point): Patch {
  const nodes: DNode[] = Object.values(laid.nodes).map((node) => ({ ...node, x: node.x + anchor.x, y: node.y + anchor.y }));
  const edges = Object.values(laid.edges)
    .filter((edge) => edge.waypoints?.length)
    .map((edge) => ({ ...edge, waypoints: edge.waypoints!.map((point) => ({ x: point.x + anchor.x, y: point.y + anchor.y })) }));
  return { nodes: { set: nodes }, ...(edges.length ? { edges: { set: edges } } : {}), ...(meta ? { doc: meta } : {}) };
}

/** The plan's patch with positions for everything it adds. Rejects when the layout engine fails. */
export async function placePlan(plan: CodePlan, elk: ElkLike): Promise<Patch> {
  const { placement, staged } = plan;
  switch (placement.strategy) {
    case "none":
      return plan.patch;

    case "full": {
      const patch = await computeLayout(staged, placement.layout, elk);
      if (!placement.anchor) return mergePatches(plan.patch, patch);
      return mergePatches(plan.patch, shifted(applyPatch(staged, patch).doc, patch.doc, placement.anchor));
    }

    case "cluster":
      return mergePatches(plan.patch, await layoutGroup(staged, placement.ids, placement.layout, elk));

    case "near": {
      const near = attached(staged, placement.ids);
      const nearPatch = placeNear(staged, [...near]);
      const placed = applyPatch(staged, nearPatch).doc;
      const islands = placement.ids.filter((id) => !near.has(id));
      return mergePatches(plan.patch, nearPatch, await layoutGroup(placed, islands, placement.layout, elk));
    }
  }
}
