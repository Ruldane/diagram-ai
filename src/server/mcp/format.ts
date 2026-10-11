import { getDiagramType } from "@/core/catalog";
import { matchEdgeKind } from "@/core/edges/kinds";
import { nodeLabel, nodesInOrder } from "@/core/model/queries";
import type { DComment, DEdge, DiagramDoc, DiagramSummary, DNode, Id } from "@/core/model/types";
import type { ReviewInfo } from "@/core/protocol";

/** Tool responses larger than this are truncated with a pointer to pagination. */
export const CHARACTER_LIMIT = 25_000;

const oneLine = (text: string | undefined, max = 80): string => {
  const flat = (text ?? "").replace(/\s*\n\s*/g, " ⏎ ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const diagramUrl = (baseUrl: string, id: Id): string => `${baseUrl}/d/${id}`;

export function summaryLine(summary: DiagramSummary, baseUrl: string): string {
  return `- **${summary.name}** (id: \`${summary.id}\`, type: ${summary.type}) — ${summary.nodeCount} nodes, ${summary.edgeCount} edges${
    summary.openComments ? `, ${summary.openComments} open comments` : ""
  }, updated ${summary.updatedAt.slice(0, 16).replace("T", " ")} — ${diagramUrl(baseUrl, summary.id)}`;
}

function nodeLine(node: DNode): string {
  const parts = [`- \`${node.id}\` [${node.shape}] "${oneLine(node.text)}"`, `@ (${Math.round(node.x)}, ${Math.round(node.y)}) ${Math.round(node.w)}×${Math.round(node.h)}`];
  if (node.parent) parts.push(`in \`${node.parent}\``);
  if (node.note) parts.push(`note: ${oneLine(node.note, 60)}`);
  return parts.join(" ");
}

function edgeLine(edge: DEdge, nodes: Record<Id, DNode>): string {
  const end = (id: Id | undefined) => (id ? `\`${id}\`${nodes[id] ? "" : " (missing)"}` : "(free end)");
  const kind = matchEdgeKind(edge.style ?? {});
  const parts = [`- \`${edge.id}\`: ${end(edge.from.node)} → ${end(edge.to.node)}`];
  if (edge.text) parts.push(`"${oneLine(edge.text, 60)}"`);
  if (kind && kind !== "flow") parts.push(`(${kind})`);
  if (edge.startText || edge.endText) parts.push(`[${edge.startText ?? ""} … ${edge.endText ?? ""}]`);
  return parts.join(" ");
}

export function commentBlock(comment: DComment, nodes: Record<Id, DNode>): string {
  const target = comment.target ? ` on \`${comment.target}\`${nodes[comment.target] ? ` (“${oneLine(nodeLabel(nodes[comment.target]), 40)}”)` : ""}` : "";
  const lines = [`- \`${comment.id}\`${comment.resolved ? " ✓ resolved" : ""}${target} — ${comment.author.name}: ${oneLine(comment.text, 400)}`];
  for (const reply of comment.replies) lines.push(`  - ${reply.author.name}: ${oneLine(reply.text, 400)}`);
  return lines.join("\n");
}

export interface ReadOptions {
  ids?: Id[];
  limit: number;
  offset: number;
  /** Agent changes awaiting the user's review, when there are any. */
  review?: ReviewInfo;
}

/** One line telling an agent its work is under review (and how to see what the user did with it). */
export function reviewLine(review: ReviewInfo): string {
  const since = review.since ? ` since ${review.since.slice(11, 16)} UTC` : "";
  const by = review.by ? ` (started by ${review.by.name})` : "";
  return `Review: agent changes${since}${by} are awaiting the user's review; they may accept or revert them. Call diagram_review_status to see what is pending.`;
}

/** Compact, readable outline of a diagram for an agent to reason about. */
export function describeDiagram(doc: DiagramDoc, baseUrl: string, options: ReadOptions): string {
  const type = getDiagramType(doc.type);
  const filter = options.ids?.length ? new Set(options.ids) : null;
  const nodes = nodesInOrder(doc.nodes).filter((n) => !filter || filter.has(n.id));
  const edges = Object.values(doc.edges).filter(
    (e) => !filter || filter.has(e.id) || (e.from.node && filter.has(e.from.node)) || (e.to.node && filter.has(e.to.node)),
  );
  const pageNodes = nodes.slice(options.offset, options.offset + options.limit);
  const pageEdges = edges.slice(options.offset, options.offset + options.limit);
  const openComments = Object.values(doc.comments).filter((c) => !c.resolved);

  const lines = [
    `# ${doc.name}`,
    `id: \`${doc.id}\` · type: ${type.id} (${type.name}) · version ${doc.version} · ${diagramUrl(baseUrl, doc.id)}`,
    ...(doc.description ? [`description: ${oneLine(doc.description, 300)}`] : []),
    `layout: ${doc.settings.layout.algorithm}/${doc.settings.layout.direction} · auto-layout ${doc.settings.autoLayout ? "on (new nodes re-flow the diagram)" : "off (a person arranged it; new nodes are placed near their neighbours)"}`,
    ...(options.review?.active ? [reviewLine(options.review)] : []),
    "",
    `## Nodes (${nodes.length}${pageNodes.length < nodes.length ? `, showing ${options.offset + 1}–${options.offset + pageNodes.length}` : ""})`,
    ...(pageNodes.length ? pageNodes.map(nodeLine) : ["(none)"]),
    "",
    `## Edges (${edges.length}${pageEdges.length < edges.length ? `, showing ${options.offset + 1}–${options.offset + pageEdges.length}` : ""})`,
    ...(pageEdges.length ? pageEdges.map((e) => edgeLine(e, doc.nodes)) : ["(none)"]),
  ];
  if (openComments.length) {
    lines.push("", `## Open comments (${openComments.length})`, ...openComments.map((c) => commentBlock(c, doc.nodes)));
  }
  const more = Math.max(nodes.length, edges.length) > options.offset + options.limit;
  if (more) lines.push("", `More elements available: call again with offset=${options.offset + options.limit}.`);
  return lines.join("\n");
}

/** Hard cap on response size, with a message telling the agent how to get the rest. */
export function limitText(text: string, hint = "Narrow the request (filters, ids, limit/offset) to see the rest."): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n…truncated (${text.length - CHARACTER_LIMIT} more characters). ${hint}`;
}
