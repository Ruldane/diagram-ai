"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { DiagramDoc } from "@/core/model/types";

import type { EditorState, EditorStore } from "./editor-store";

const EditorContext = createContext<EditorStore | null>(null);

export function EditorProvider({ store, children }: { store: EditorStore; children: ReactNode }) {
  return <EditorContext.Provider value={store}>{children}</EditorContext.Provider>;
}

/** The raw store, for event handlers and imperative code (`store.getState()`). */
export function useEditorStore(): EditorStore {
  const store = useContext(EditorContext);
  if (!store) throw new Error("useEditorStore must be used inside <EditorProvider>.");
  return store;
}

/** Subscribes a component to a slice of editor state. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}

/** Like `useEditor`, for selectors that build a new array/object each time. */
export function useEditorShallow<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStore(), useShallow(selector));
}

/** The loaded document. Only call from components rendered once the editor is ready. */
export function useDoc(): DiagramDoc {
  const doc = useEditor((state) => state.doc);
  if (!doc) throw new Error("useDoc was called before the diagram finished loading.");
  return doc;
}
