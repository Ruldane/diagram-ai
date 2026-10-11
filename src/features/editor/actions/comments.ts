import { newId, randomId } from "@/core/model/ids";
import type { Actor, DComment, Id } from "@/core/model/types";

import type { EditorStore } from "../store/editor-store";

const author = (store: EditorStore): Actor => ({ kind: "human", id: store.getState().clientId, name: "You" });

/** Posts the comment currently being drafted on the canvas. */
export function postDraftComment(store: EditorStore, text: string): void {
  const { draftComment, doc } = store.getState();
  const body = text.trim();
  if (!draftComment || !doc || !body) return;
  const comment: DComment = {
    id: newId("comment"),
    ...(draftComment.target ? { target: draftComment.target } : {}),
    x: Math.round(draftComment.x),
    y: Math.round(draftComment.y),
    author: author(store),
    text: body,
    createdAt: new Date().toISOString(),
    replies: [],
  };
  store.getState().apply({ comments: { set: [comment] } });
  store.setState({ draftComment: null, activeComment: comment.id, panel: "comments", tool: "select" });
}

export function replyToComment(store: EditorStore, id: Id, text: string): void {
  const comment = store.getState().doc?.comments[id];
  const body = text.trim();
  if (!comment || !body) return;
  store.getState().apply({
    comments: {
      set: [{ ...comment, replies: [...comment.replies, { id: randomId("r"), author: author(store), text: body, createdAt: new Date().toISOString() }] }],
    },
  });
}

export function setCommentResolved(store: EditorStore, id: Id, resolved: boolean): void {
  const comment = store.getState().doc?.comments[id];
  if (comment) store.getState().apply({ comments: { set: [{ ...comment, resolved }] } });
}

export function deleteComment(store: EditorStore, id: Id): void {
  if (store.getState().doc?.comments[id]) store.getState().apply({ comments: { remove: [id] } });
}

/** Where a comment's pin sits: on its element's corner, or at its own position. */
export function commentAnchor(comment: DComment, nodes: Record<Id, { x: number; y: number; w: number; h: number }>): { x: number; y: number } {
  const node = comment.target ? nodes[comment.target] : undefined;
  return node ? { x: node.x + node.w, y: node.y } : { x: comment.x, y: comment.y };
}
