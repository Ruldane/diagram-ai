import { rotatedBounds, union } from "../geometry/basics";
import type { DEdge, DiagramDoc, DNode, Id, Rect } from "./types";

type Graph = Pick<DiagramDoc, "nodes" | "edges">;

export const isNodeId = (id: Id, doc: Graph): boolean => id in doc.nodes;
export const isEdgeId = (id: Id, doc: Graph): boolean => id in doc.edges;

/** Nodes sorted back-to-front. */
export function nodesInOrder(nodes: Record<Id, DNode>): DNode[] {
  return Object.values(nodes).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export function maxZ(nodes: Record<Id, DNode>): number {
  let max = 0;
  for (const node of Object.values(nodes)) if (node.z > max) max = node.z;
  return max;
}

export function minZ(nodes: Record<Id, DNode>): number {
  let min = 0;
  for (const node of Object.values(nodes)) if (node.z < min) min = node.z;
  return min;
}

export function childrenOf(nodes: Record<Id, DNode>, parentId: Id): DNode[] {
  return Object.values(nodes).filter((node) => node.parent === parentId);
}

/** All nodes nested under the given ones (excluding the roots themselves). */
export function descendantsOf(nodes: Record<Id, DNode>, rootIds: Iterable<Id>): DNode[] {
  const byParent = new Map<Id, DNode[]>();
  for (const node of Object.values(nodes)) {
    if (!node.parent) continue;
    const list = byParent.get(node.parent);
    if (list) list.push(node);
    else byParent.set(node.parent, [node]);
  }
  const out: DNode[] = [];
  const seen = new Set<Id>(rootIds);
  const queue = [...seen];
  while (queue.length) {
    for (const child of byParent.get(queue.pop()!) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

/** True when `ancestorId` contains `nodeId`, directly or transitively. */
export function isDescendant(nodes: Record<Id, DNode>, nodeId: Id, ancestorId: Id): boolean {
  const seen = new Set<Id>();
  let current = nodes[nodeId]?.parent;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = nodes[current]?.parent;
  }
  return false;
}

export function edgesOfNodes(edges: Record<Id, DEdge>, nodeIds: Set<Id>): DEdge[] {
  return Object.values(edges).filter(
    (edge) => (edge.from.node && nodeIds.has(edge.from.node)) || (edge.to.node && nodeIds.has(edge.to.node)),
  );
}

/** Edges whose two ends are both inside the given node set. */
export function edgesWithin(edges: Record<Id, DEdge>, nodeIds: Set<Id>): DEdge[] {
  return Object.values(edges).filter(
    (edge) => edge.from.node && edge.to.node && nodeIds.has(edge.from.node) && nodeIds.has(edge.to.node),
  );
}

export function nodeBounds(node: DNode): Rect {
  return rotatedBounds(node, node.rotation);
}

export function boundsOfNodes(nodes: DNode[]): Rect | null {
  return union(nodes.map(nodeBounds));
}

/** Short human/agent readable label for an element. */
export function nodeLabel(node: DNode): string {
  const first = (node.text ?? "").split("\n").find((l) => l.trim() && !/^-{3,}$/.test(l.trim()));
  return first?.trim() || node.shape.split("/").pop() || node.id;
}
