"use client";

import { MessageSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { resolveEdgeStyle } from "@/core/model/defaults";
import type { DComment, Id } from "@/core/model/types";
import { fontOf } from "@/core/shapes/kit";
import { getShape, labelSpec, shapeContext } from "@/core/shapes/registry";
import { cssFontFamily, fontVariant, type FontSpec } from "@/core/text/fonts";
import { LINE_HEIGHT } from "@/core/text/layout";
import { Button } from "@/components/ui/button";
import { actorColor, initials } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { commentAnchor, postDraftComment } from "../actions/comments";
import { commitText } from "../actions/elements";
import { useEditor, useEditorStore } from "../store/context";
import type { useDisplay } from "./World";

type Display = ReturnType<typeof useDisplay>;

/** Children are positioned in world units but keep a constant on-screen size. */
const UNSCALED = { transform: "scale(calc(1 / var(--zoom)))", transformOrigin: "0 0" } as const;

/* ------------------------------------------------------------ text editor */

interface EditorBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  font: FontSpec;
  color: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  padding: number;
  initial: string;
  /** Edge labels get an opaque chip so they stay readable on the line. */
  chip: boolean;
}

function editorBox(id: Id, display: Display): EditorBox | null {
  const node = display.nodes[id];
  if (node) {
    const def = getShape(node.shape);
    const ctx = shapeContext(node, def);
    const label = labelSpec(ctx, def);
    // Shapes that draw their own text (classes, tables) are edited across the whole box.
    const box = label?.box ?? { x: 0, y: 0, w: node.w, h: node.h };
    return {
      x: node.x + box.x,
      y: node.y + box.y,
      w: box.w,
      h: box.h,
      rotation: node.rotation ?? 0,
      font: fontOf(ctx.style, label?.font),
      color: label?.color ?? ctx.style.textColor,
      align: label ? (label.align ?? ctx.style.align) : "left",
      valign: label ? (label.valign ?? ctx.style.valign) : "top",
      padding: label?.padding ?? 10,
      initial: node.text ?? "",
      chip: false,
    };
  }
  const edge = display.edges[id];
  const geometry = display.routes.get(id);
  if (!edge || !geometry) return null;
  const style = resolveEdgeStyle(edge.style);
  const w = 200;
  const h = 30;
  return {
    x: geometry.labelPoint.x - w / 2,
    y: geometry.labelPoint.y - h / 2,
    w,
    h,
    rotation: 0,
    font: { family: style.fontFamily, size: style.fontSize, bold: style.bold, italic: style.italic },
    color: style.textColor,
    align: "center",
    valign: "middle",
    padding: 4,
    initial: edge.text ?? "",
    chip: true,
  };
}

/**
 * In-place label editor. It is laid out exactly like the rendered label
 * (same font, alignment and box), so text does not jump when editing starts.
 */
function TextEditor({ id, display }: { id: Id; display: Display }) {
  const store = useEditorStore();
  const ref = useRef<HTMLDivElement>(null);
  // Geometry is captured when editing starts so remote updates do not move the caret box.
  const [box] = useState(() => editorBox(id, display));
  const done = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !box) return;
    element.innerText = box.initial;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [box]);

  // Blur is the single commit point: clicking away, Esc, Tab and Ctrl+Enter all blur the editor.
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const element = ref.current;
    if (save && element) commitText(store, id, element.innerText.replace(/ /g, " ").replace(/\n+$/, ""));
    if (store.getState().editing === id) store.setState({ editing: null });
  };

  if (!box) return null;
  const variant = fontVariant(box.font);
  return (
    <div
      data-canvas-ui
      className="absolute flex"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
        justifyContent: box.align === "left" ? "flex-start" : box.align === "right" ? "flex-end" : "center",
        alignItems: box.valign === "top" ? "flex-start" : box.valign === "bottom" ? "flex-end" : "center",
        padding: box.padding,
      }}
    >
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label="Label"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" || event.key === "Tab" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
            event.preventDefault();
            ref.current?.blur();
          }
        }}
        className={cn("min-w-[8px] max-w-full outline-none", box.chip && "rounded bg-[var(--raised)] px-1.5 shadow-[var(--shadow-md)] ring-1 ring-accent")}
        style={{
          fontFamily: cssFontFamily(box.font.family),
          fontSize: box.font.size,
          fontWeight: variant.weight,
          fontStyle: box.font.italic ? "italic" : "normal",
          lineHeight: LINE_HEIGHT,
          color: box.chip ? "var(--ink)" : box.color,
          textAlign: box.align,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          caretColor: "var(--accent)",
          minHeight: box.font.size * LINE_HEIGHT,
        }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- comments */

function CommentPin({ comment, display, active }: { comment: DComment; display: Display; active: boolean }) {
  const store = useEditorStore();
  const at = commentAnchor(comment, display.nodes);
  const count = comment.replies.length + 1;
  return (
    <button
      type="button"
      data-canvas-ui
      aria-label={`Comment by ${comment.author.name}: ${comment.text.slice(0, 60)}`}
      onClick={() => store.setState({ activeComment: comment.id, panel: "comments" })}
      className="absolute"
      style={{ left: at.x, top: at.y, ...UNSCALED }}
    >
      <span
        className={cn(
          "flex h-7 min-w-7 -translate-x-1/2 -translate-y-full items-center justify-center gap-1 rounded-full rounded-bl-[4px] border-2 px-1.5 text-[11px] font-semibold text-white shadow-[var(--shadow-md)] transition-transform hover:scale-110",
          active ? "scale-110 border-accent" : "border-white",
          comment.resolved && "opacity-45",
        )}
        style={{ background: comment.author.kind === "human" ? "#17150f" : actorColor(comment.author) }}
      >
        {initials(comment.author.name)}
        {count > 1 ? <span className="font-mono text-[10px] opacity-80">{count}</span> : null}
      </span>
    </button>
  );
}

function DraftComment({ x, y }: { x: number; y: number }) {
  const store = useEditorStore();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = () => postDraftComment(store, text);
  return (
    <div data-canvas-ui className="absolute z-10" style={{ left: x, top: y, ...UNSCALED }}>
      <div className="w-64 -translate-y-2 rounded-xl border border-line bg-raised p-2 shadow-[var(--shadow-lg)]">
        <textarea
          ref={ref}
          value={text}
          rows={3}
          placeholder="Add a comment — agents can read and answer it"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") store.setState({ draftComment: null });
          }}
          className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="px-1.5 text-[11px] text-ink-4">Enter to post</span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => store.setState({ draftComment: null })}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!text.trim()} onClick={submit}>
              <MessageSquare className="size-3.5" />
              Comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- agent cursor */

function AgentCursor() {
  const cursor = useEditor((state) => state.agentCursor);
  if (!cursor) return null;
  const color = actorColor(cursor.actor);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 transition-[left,top] duration-300 ease-out"
      style={{ left: cursor.x, top: cursor.y, ...UNSCALED }}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
        <path d="M1.5 1.5 16 9.2 9.4 11.1 6.6 18z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="absolute top-4 left-3.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-[var(--shadow-md)]" style={{ background: color }}>
        {cursor.actor.name}
      </span>
    </div>
  );
}

function HighlightNote({ display }: { display: Display }) {
  const highlight = useEditor((state) => state.highlight);
  const store = useEditorStore();
  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => {
      if (store.getState().highlight?.key === highlight.key) store.setState({ highlight: null });
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [highlight, store]);

  const node = highlight?.ids.map((id) => display.nodes[id]).find(Boolean);
  if (!highlight?.message || !node) return null;
  return (
    <div className="pointer-events-none absolute z-20" style={{ left: node.x + node.w / 2, top: node.y, ...UNSCALED }}>
      <div
        className="w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug font-medium text-white shadow-[var(--shadow-lg)]"
        style={{ background: actorColor(highlight.actor) }}
      >
        <span className="opacity-80">{highlight.actor.name}: </span>
        {highlight.message}
      </div>
    </div>
  );
}

/** HTML layered over the canvas in world coordinates: editor, comment pins, agent presence. */
export function HtmlOverlay({ display }: { display: Display }) {
  const editing = useEditor((state) => state.editing);
  const comments = useEditor((state) => state.doc!.comments);
  const activeComment = useEditor((state) => state.activeComment);
  const draft = useEditor((state) => state.draftComment);
  const showResolved = useEditor((state) => state.panel === "comments");

  return (
    <>
      {editing ? <TextEditor key={editing} id={editing} display={display} /> : null}
      {Object.values(comments).map((comment) =>
        comment.resolved && !showResolved ? null : (
          <CommentPin key={comment.id} comment={comment} display={display} active={activeComment === comment.id} />
        ),
      )}
      {draft ? <DraftComment key={`${draft.x}:${draft.y}`} x={draft.x} y={draft.y} /> : null}
      <HighlightNote display={display} />
      <AgentCursor />
    </>
  );
}
