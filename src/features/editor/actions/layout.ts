import { toast } from "sonner";

import type { LayoutOptions, Patch } from "@/core/model/types";

import type { EditorStore } from "../store/editor-store";
import { playRemotePatch } from "../sync/playback";

const SELF = { kind: "human", id: "browser", name: "You" } as const;

/**
 * Arranges the diagram (or the selected nodes) automatically. The layout is
 * computed on the server, applied as a normal undoable edit and animated.
 */
export async function autoLayout(store: EditorStore, options?: LayoutOptions, onlySelection = false): Promise<void> {
  const { doc, diagramId, selection } = store.getState();
  if (!doc) return;
  const ids = onlySelection ? selection.filter((id) => doc.nodes[id]) : undefined;
  if (Object.keys(doc.nodes).length === 0) return;
  try {
    const response = await fetch(`/api/diagrams/${diagramId}/layout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options, ...(ids?.length ? { ids } : {}) }),
    });
    if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Layout failed");
    const { patch } = (await response.json()) as { patch: Patch };
    const before = store.getState().doc;
    if (!before) return;
    store.getState().apply(patch);
    playRemotePatch(store, before, patch, SELF, "layout");
    if (!ids?.length) window.setTimeout(() => store.getState().fit(), 560);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not arrange the diagram.");
  }
}
