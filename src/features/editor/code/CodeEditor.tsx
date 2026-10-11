"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ChangeEvent, type KeyboardEvent, type Ref } from "react";

import { cn } from "@/lib/cn";

/** Must match `leading-[18px]` and `py-2` below: the gutter and the line marks are positioned from these. */
const LINE_HEIGHT = 18;
const PAD_TOP = 8;
const INDENT = "  ";
/** Marks beyond this many are not drawn; a broken 50k character paste should not create thousands of elements. */
const MAX_MARKS = 200;

export interface LineMark {
  line: number;
  severity: "error" | "warning";
}

export interface CodeEditorHandle {
  /** Selects a line and scrolls it into view. Lines are 1-based. */
  focusLine(line: number): void;
  focus(): void;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  marks: LineMark[];
  placeholder?: string;
  /** Ctrl / Cmd + Enter. */
  onSubmit?: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
  ref?: Ref<CodeEditorHandle>;
}

/**
 * Replaces a range of the textarea through the browser's own editing command,
 * which keeps native undo / redo working; falls back to `setRangeText`.
 */
function replaceRange(field: HTMLTextAreaElement, start: number, end: number, text: string, selectFrom?: number, selectTo?: number): void {
  field.setSelectionRange(start, end);
  const done = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!done) {
    field.setRangeText(text, start, end, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (selectFrom !== undefined) field.setSelectionRange(selectFrom, selectTo ?? selectFrom);
}

/**
 * A plain textarea with a line-number gutter, error and warning bands behind
 * the lines, Tab / Shift+Tab indentation and auto-indent. No dependency: the
 * text, the gutter and the bands share one font and line height, and
 * scrolling the textarea moves the other two layers with it.
 */
export function CodeEditor({ value, onChange, marks, placeholder, onSubmit, disabled, label, className, ref }: CodeEditorProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const bands = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => {
    let lines = 1;
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) lines++;
    return lines;
  }, [value]);
  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"), [lineCount]);

  // Anything rendered after the last scroll event must sit where the text is, not at the top.
  const sync = useCallback(() => {
    const top = field.current?.scrollTop ?? 0;
    const transform = `translateY(${-top}px)`;
    if (gutter.current) gutter.current.style.transform = transform;
    if (bands.current) bands.current.style.transform = transform;
  }, []);
  useEffect(() => {
    sync();
  }, [sync, value, marks]);

  useImperativeHandle(ref, () => ({
    focus: () => field.current?.focus(),
    focusLine: (line) => {
      const element = field.current;
      if (!element) return;
      const lines = element.value.split("\n");
      const index = Math.min(Math.max(line, 1), lines.length) - 1;
      const start = lines.slice(0, index).reduce((sum, text) => sum + text.length + 1, 0);
      element.focus();
      element.setSelectionRange(start, start + lines[index].length);
      element.scrollTop = Math.max(0, index * LINE_HEIGHT - element.clientHeight / 2);
      sync();
    },
  }));

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const element = event.currentTarget;
    if (event.key === "Escape") {
      // Tab is taken by indentation, so Escape is how a keyboard user leaves the editor.
      event.preventDefault();
      element.blur();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit?.();
      return;
    }
    const { selectionStart: start, selectionEnd: end, value: text } = element;

    if (event.key === "Enter" && !event.shiftKey && !event.altKey && start === end) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const indent = /^[ \t]*/.exec(text.slice(lineStart, start))?.[0] ?? "";
      if (indent) {
        event.preventDefault();
        replaceRange(element, start, end, `\n${indent}`);
      }
      return;
    }

    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const multiline = text.slice(start, end).includes("\n");
      if (!multiline && !event.shiftKey) return replaceRange(element, start, end, INDENT);

      // Indent or outdent every line the selection touches.
      const blockEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
      const lineEnd = text.indexOf("\n", blockEnd);
      const to = lineEnd < 0 ? text.length : lineEnd;
      const block = text.slice(lineStart, to).split("\n");
      const changed = block.map((line) => (event.shiftKey ? line.replace(/^(?: {1,2}|\t)/, "") : INDENT + line)).join("\n");
      replaceRange(element, lineStart, to, changed, lineStart, lineStart + changed.length);
    }
  };

  const bandMarks = marks.slice(0, MAX_MARKS);

  return (
    <div
      className={cn(
        "relative flex min-h-0 overflow-hidden rounded-lg border border-line-strong bg-raised font-mono text-[12px] leading-[18px] text-ink",
        "focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
        disabled && "opacity-60",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div ref={bands} className="relative">
          {bandMarks.map((mark) => (
            <div
              key={`${mark.line}:${mark.severity}`}
              className={cn("absolute inset-x-0", mark.severity === "error" ? "bg-danger/12" : "bg-warn/14")}
              style={{ top: PAD_TOP + (mark.line - 1) * LINE_HEIGHT, height: LINE_HEIGHT }}
            />
          ))}
        </div>
      </div>

      <div aria-hidden className="relative w-10 shrink-0 overflow-hidden border-r border-line bg-sunken/55 text-right text-ink-4 select-none">
        <pre ref={gutter} className="m-0 pr-2 font-[inherit]" style={{ paddingTop: PAD_TOP }}>
          {numbers}
        </pre>
      </div>

      <textarea
        ref={field}
        value={value}
        disabled={disabled}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={sync}
        className="relative min-w-0 flex-1 resize-none overflow-auto bg-transparent px-2 text-[12px] leading-[18px] whitespace-pre outline-none placeholder:text-ink-4"
        style={{ paddingTop: PAD_TOP, paddingBottom: PAD_TOP, tabSize: 2 }}
      />
    </div>
  );
}
