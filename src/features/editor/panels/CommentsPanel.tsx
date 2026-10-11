"use client";

import { Check, CornerDownRight, MessageSquarePlus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { nodeLabel } from "@/core/model/queries";
import type { Actor, DComment, DNode } from "@/core/model/types";
import { Button, IconButton } from "@/components/ui/button";
import { actorColor, initials, timeAgo } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { commentAnchor, deleteComment, replyToComment, setCommentResolved } from "../actions/comments";
import { useEditor, useEditorStore } from "../store/context";

function Avatar({ actor }: { actor: Actor }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: actor.kind === "human" ? "var(--ink-2)" : actorColor(actor) }}
    >
      {initials(actor.name)}
    </span>
  );
}

function Message({ author, text, at }: { author: Actor; text: string; at: string }) {
  return (
    <div className="flex gap-2">
      <Avatar actor={author} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-[12px]">
          <span className="font-semibold text-ink">{author.name}</span>
          <span className="text-[11px] text-ink-4">{timeAgo(at)}</span>
        </p>
        <p className="text-[13px] leading-snug break-words whitespace-pre-wrap text-ink-2 select-text">{text}</p>
      </div>
    </div>
  );
}

function Thread({ comment, target, active }: { comment: DComment; target: DNode | undefined; active: boolean }) {
  const store = useEditorStore();
  const ref = useRef<HTMLElement>(null);
  const [reply, setReply] = useState("");

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  /** Selecting a thread shows where it is pinned. */
  const focus = () => {
    const state = store.getState();
    if (!state.doc) return;
    const at = commentAnchor(comment, state.doc.nodes);
    store.setState({ activeComment: comment.id });
    if (target) state.select([target.id]);
    state.zoomTo(target ?? { x: at.x - 100, y: at.y - 80, w: 200, h: 160 }, 220, Math.max(state.viewport.zoom, 1));
  };
  const send = () => {
    replyToComment(store, comment.id, reply);
    setReply("");
  };

  return (
    <article
      ref={ref}
      onClick={focus}
      className={cn(
        "cursor-pointer rounded-xl border p-2.5 transition-colors",
        active ? "border-accent bg-accent-soft/40" : "border-line bg-raised hover:border-line-strong",
        comment.resolved && "opacity-60",
      )}
    >
      {target ? (
        <p className="mb-1.5 flex items-center gap-1 truncate text-[11px] text-ink-3">
          <CornerDownRight className="size-3 shrink-0" />
          on “{nodeLabel(target)}”
        </p>
      ) : null}
      <div className="flex flex-col gap-2.5">
        <Message author={comment.author} text={comment.text} at={comment.createdAt} />
        {comment.replies.map((item) => (
          <Message key={item.id} author={item.author} text={item.text} at={item.createdAt} />
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
        {comment.resolved ? null : (
          <input
            value={reply}
            placeholder="Reply…"
            aria-label="Reply"
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && reply.trim()) send();
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
          />
        )}
        {comment.resolved ? <span className="flex-1 text-[11.5px] text-ink-3">Resolved</span> : null}
        <IconButton size="sm" label={comment.resolved ? "Re-open" : "Resolve"} onClick={() => setCommentResolved(store, comment.id, !comment.resolved)}>
          {comment.resolved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
        </IconButton>
        <IconButton size="sm" label="Delete thread" onClick={() => deleteComment(store, comment.id)}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
    </article>
  );
}

/** Review threads. People and agents write in the same threads. */
export function CommentsPanel() {
  const store = useEditorStore();
  const comments = useEditor((state) => state.doc!.comments);
  const nodes = useEditor((state) => state.doc!.nodes);
  const active = useEditor((state) => state.activeComment);
  const [showResolved, setShowResolved] = useState(false);

  const { open, resolved } = useMemo(() => {
    const sorted = Object.values(comments).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { open: sorted.filter((c) => !c.resolved), resolved: sorted.filter((c) => c.resolved) };
  }, [comments]);
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <div className="flex flex-col gap-2 p-3">
      <Button size="sm" onClick={() => store.getState().setTool("comment")}>
        <MessageSquarePlus className="size-3.5" />
        Add a comment
      </Button>

      {shown.length === 0 ? (
        <div className="px-2 py-8 text-center">
          <p className="font-display text-[18px] text-ink-2">No open comments</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
            Pin a note to any shape. Your agent can read comments, act on them and answer in the thread.
          </p>
        </div>
      ) : (
        shown.map((comment) => (
          <Thread key={comment.id} comment={comment} target={comment.target ? nodes[comment.target] : undefined} active={active === comment.id} />
        ))
      )}

      {resolved.length ? (
        <button type="button" onClick={() => setShowResolved(!showResolved)} className="h-7 rounded-md text-[12px] text-ink-3 hover:bg-sunken hover:text-ink">
          {showResolved ? "Hide" : "Show"} {resolved.length} resolved
        </button>
      ) : null}
    </div>
  );
}
