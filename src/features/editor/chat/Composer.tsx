"use client";

import { ArrowUp, MousePointer2, Square } from "lucide-react";
import { useEffect, type KeyboardEvent, type RefObject } from "react";

import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { MAX_PROMPT_CHARS } from "./history";

const MAX_HEIGHT = 140;

export interface ComposerProps {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  onStop(): void;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  /** "Using 3 selected shapes", or null. */
  selectionNote: string | null;
  /** Owned by the panel so commands and suggestion chips can focus the box. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** Message box: Enter sends, Shift+Enter adds a line, Esc stops a running reply. */
export function Composer({ value, onChange, onSend, onStop, busy, disabled, placeholder, selectionNote, inputRef }: ComposerProps) {
  // Grow with the text up to a limit.
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, inputRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy) onSend();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (busy) onStop();
      else event.currentTarget.blur();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
      // Already here; keep the browser's own Ctrl+J (downloads) out of it.
      event.preventDefault();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="shrink-0 border-t border-line p-2.5">
      {selectionNote ? (
        <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11.5px] text-ink-3">
          <MousePointer2 className="size-3 shrink-0" />
          {selectionNote}
        </p>
      ) : null}
      <div className={cn("flex items-end gap-1.5 rounded-xl border bg-raised p-1.5", disabled ? "border-line opacity-70" : "border-line-strong focus-within:border-accent")}>
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          disabled={disabled}
          maxLength={MAX_PROMPT_CHARS}
          placeholder={placeholder}
          aria-label="Message the assistant"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-[140px] min-h-7 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] leading-snug text-ink outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
        />
        {busy ? (
          <IconButton label="Stop" shortcut="Esc" size="sm" side="top" onClick={onStop} className="bg-ink text-bg hover:bg-ink-2 hover:text-bg">
            <Square className="size-3 fill-current" />
          </IconButton>
        ) : (
          <IconButton
            label="Send"
            shortcut="↵"
            size="sm"
            side="top"
            disabled={!canSend}
            onClick={onSend}
            className={canSend ? "bg-accent text-accent-ink hover:bg-accent-hover hover:text-accent-ink" : undefined}
          >
            <ArrowUp className="size-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
