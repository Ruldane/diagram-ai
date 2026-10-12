import type { Actor, DComment, DEdge, DiagramDoc, DNode, Patch } from "@/core/model/types";

/**
 * Browser patches carry authorship the client wrote itself ("You"). In team
 * mode the server stamps what it knows instead, so one editor cannot post a
 * comment or an element in somebody else's name:
 *
 *  - new nodes, edges, comments and replies are credited to `actor`;
 *  - elements that already exist keep the author they have, whatever the
 *    patch says.
 *
 * Returns the patch unchanged (same object) when nothing needed rewriting.
 */
export function attributePatch(doc: DiagramDoc, patch: Patch, actor: Actor): Patch {
  let changed = false;

  const element = <T extends DNode | DEdge>(item: T, known: T | undefined): T => {
    const wanted = known ? known.createdBy : actor;
    if (sameActor(item.createdBy, wanted)) return item;
    changed = true;
    const { createdBy: _dropped, ...rest } = item;
    void _dropped;
    return (wanted ? { ...rest, createdBy: wanted } : rest) as T;
  };

  const nodes = patch.nodes?.set?.map((node) => element(node, doc.nodes[node.id]));
  const edges = patch.edges?.set?.map((edge) => element(edge, doc.edges[edge.id]));

  const comments = patch.comments?.set?.map((comment): DComment => {
    const known = doc.comments[comment.id];
    const knownReplies = new Map((known?.replies ?? []).map((reply) => [reply.id, reply]));
    const incoming = comment.replies ?? [];
    const replies = incoming.map((reply) => knownReplies.get(reply.id) ?? (sameActor(reply.author, actor) ? reply : { ...reply, author: actor }));
    const author = known?.author ?? actor;
    if (sameActor(comment.author, author) && replies.every((reply, index) => reply === incoming[index])) return comment;
    changed = true;
    return { ...comment, author, replies };
  });

  if (!changed) return patch;
  return {
    ...patch,
    ...(nodes ? { nodes: { ...patch.nodes, set: nodes } } : {}),
    ...(edges ? { edges: { ...patch.edges, set: edges } } : {}),
    ...(comments ? { comments: { ...patch.comments, set: comments } } : {}),
  };
}

function sameActor(a: Actor | undefined, b: Actor | undefined): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id && a.name === b.name;
}
