"use client";

import { Hand, MousePointer2 } from "lucide-react";

import { IconButton } from "@/components/ui/button";

import { runCommand, shortcutOf } from "../commands/commands";
import { useEditor, useEditorStore } from "../store/context";

const ISLAND = "pointer-events-auto flex h-11 items-center gap-0.5 rounded-[var(--radius-panel)] border border-line bg-surface px-1.5 shadow-[var(--shadow-panel)]";

/** What is left of the toolbar for someone who can only look: pointing and panning. */
export function ViewerToolbar() {
  const store = useEditorStore();
  const tool = useEditor((state) => state.tool);
  return (
    <div className={ISLAND} role="toolbar" aria-label="View tools">
      <IconButton label="Select" shortcut={shortcutOf("tool.select")} side="top" active={tool === "select"} onClick={() => runCommand(store, "tool.select")}>
        <MousePointer2 className="size-[18px]" />
      </IconButton>
      <IconButton label="Hand (pan)" shortcut={shortcutOf("tool.pan")} side="top" active={tool === "pan"} onClick={() => runCommand(store, "tool.pan")}>
        <Hand className="size-[18px]" />
      </IconButton>
    </div>
  );
}
