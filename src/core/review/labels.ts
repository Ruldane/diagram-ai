import { nodeLabel } from "../model/queries";
import type { DEdge, Id } from "../model/types";
import type { ReviewChange, ReviewContent } from "./diff";

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function edgeLabel(edge: DEdge, nodes: ReviewContent["nodes"]): string {
  if (edge.text?.trim()) return oneLine(edge.text, 48);
  const end = (id: Id | undefined) => (id && nodes[id] ? oneLine(nodeLabel(nodes[id]), 24) : "…");
  return `${end(edge.from.node)} → ${end(edge.to.node)}`;
}

/**
 * Short label of a changed element. Removed elements are only in `base`,
 * everything else is read from `current`; the other document fills in the
 * names of connector ends.
 */
export function changeLabel(change: Pick<ReviewChange, "id" | "element" | "kind">, base: ReviewContent, current: ReviewContent): string {
  const primary = change.kind === "removed" ? base : current;
  const secondary = change.kind === "removed" ? current : base;
  const nodes = { ...secondary.nodes, ...primary.nodes };
  if (change.element === "node") {
    const node = primary.nodes[change.id] ?? secondary.nodes[change.id];
    return node ? oneLine(nodeLabel(node), 48) : change.id;
  }
  if (change.element === "edge") {
    const edge = primary.edges[change.id] ?? secondary.edges[change.id];
    return edge ? edgeLabel(edge, nodes) : change.id;
  }
  const comment = primary.comments[change.id] ?? secondary.comments[change.id];
  return comment ? oneLine(comment.text, 48) : change.id;
}

const FIELD_NAMES: Record<string, string> = {
  text: "text",
  shape: "shape",
  data: "properties",
  parent: "container",
  z: "stacking order",
  locked: "lock",
  link: "link",
  note: "note",
  routing: "routing",
  startText: "start label",
  endText: "end label",
  resolved: "resolved",
  replies: "replies",
  target: "pin",
  createdBy: "author",
  "from.node": "start",
  "to.node": "end",
  "from.anchor": "start side",
  "to.anchor": "end side",
  "from.point": "start point",
  "to.point": "end point",
  "style.fill": "fill",
  "style.stroke": "outline",
  "style.strokeWidth": "line width",
  "style.dash": "line style",
  "style.opacity": "opacity",
  "style.radius": "corners",
  "style.shadow": "shadow",
  "style.textColor": "text colour",
  "style.fontFamily": "font",
  "style.fontSize": "text size",
  "style.bold": "bold",
  "style.italic": "italic",
  "style.underline": "underline",
  "style.align": "text alignment",
  "style.valign": "text alignment",
  "style.startMarker": "start marker",
  "style.endMarker": "end marker",
  "style.animated": "animation",
  x: "position",
  y: "position",
  w: "size",
  h: "size",
  rotation: "rotation",
  waypoints: "route",
  autoRoute: "route",
};

/** "text, fill, outline" — readable names for the fields that changed, without repeats. */
export function describeFields(fields: readonly string[], max = 3): string {
  const names: string[] = [];
  for (const field of fields) {
    const name = FIELD_NAMES[field] ?? field.replace(/^style\./, "");
    if (!names.includes(name)) names.push(name);
  }
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}
