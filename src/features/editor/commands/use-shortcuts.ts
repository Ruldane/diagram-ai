"use client";

import { useEffect } from "react";

import { copyPayload, cutPayload, pasteText } from "../actions/clipboard";
import { useEditorStore } from "../store/context";
import { commandsForEvent, isEnabled } from "./commands";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/**
 * Global keyboard shortcuts and clipboard handling for the editor. Listeners
 * are attached in an effect, so they are released while the route is hidden.
 */
export function useShortcuts(): void {
  const store = useEditorStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = store.getState();
      if (state.status !== "ready" || isTyping(event.target)) return;
      // Open dialogs and menus own the keyboard.
      if (state.dialog) return;
      if ((event.target as HTMLElement | null)?.closest?.("[role='menu'], [role='dialog']")) return;

      if (event.code === "Space" && !event.repeat && !state.editing) {
        event.preventDefault();
        store.setState({ spaceHeld: true });
        return;
      }
      for (const command of commandsForEvent(event)) {
        if (!isEnabled(command, state)) continue;
        event.preventDefault();
        command.run(store);
        return;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && store.getState().spaceHeld) store.setState({ spaceHeld: false });
    };
    const onBlur = () => store.setState({ spaceHeld: false });

    const onCopy = (event: ClipboardEvent) => {
      const { doc, selection, editing } = store.getState();
      if (!doc || editing || isTyping(event.target) || !selection.length) return;
      const payload = copyPayload(doc, selection);
      if (!payload) return;
      event.clipboardData?.setData("text/plain", payload);
      event.preventDefault();
    };
    const onCut = (event: ClipboardEvent) => {
      if (store.getState().editing || isTyping(event.target)) return;
      const payload = cutPayload(store);
      if (!payload) return;
      event.clipboardData?.setData("text/plain", payload);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      const state = store.getState();
      if (state.status !== "ready" || state.editing || state.dialog || isTyping(event.target)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      pasteText(store, text, state.toWorld({ x: state.canvasSize.w / 2, y: state.canvasSize.h / 2 }));
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [store]);
}
