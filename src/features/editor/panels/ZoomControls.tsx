"use client";

import { Maximize, Minus, Plus } from "lucide-react";

import { IconButton } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";

import { runCommand, shortcutOf } from "../commands/commands";
import { useEditor, useEditorStore } from "../store/context";

const LEVELS = [0.5, 1, 1.5, 2];

export function ZoomControls() {
  const store = useEditorStore();
  const zoom = useEditor((state) => Math.round(state.viewport.zoom * 100));
  const run = (id: string) => runCommand(store, id);
  const setZoom = (level: number) => {
    const { viewport, canvasSize, zoomAt } = store.getState();
    zoomAt({ x: canvasSize.w / 2, y: canvasSize.h / 2 }, level / viewport.zoom);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-panel)]">
      <IconButton size="sm" side="top" label="Zoom out" shortcut={shortcutOf("view.zoom-out")} onClick={() => run("view.zoom-out")}>
        <Minus className="size-3.5" />
      </IconButton>
      <Menu
        side="top"
        align="center"
        trigger={
          <button type="button" aria-label={`Zoom ${zoom}%`} className="h-7 w-12 rounded-md font-mono text-[11.5px] text-ink-2 hover:bg-sunken hover:text-ink">
            {zoom}%
          </button>
        }
      >
        <MenuItem shortcut={shortcutOf("view.fit")} onSelect={() => run("view.fit")}>
          Zoom to fit
        </MenuItem>
        <MenuItem shortcut={shortcutOf("view.zoom-selection")} onSelect={() => run("view.zoom-selection")}>
          Zoom to selection
        </MenuItem>
        <MenuSeparator />
        {LEVELS.map((level) => (
          <MenuItem key={level} checked={zoom === level * 100} onSelect={() => setZoom(level)}>
            {level * 100}%
          </MenuItem>
        ))}
      </Menu>
      <IconButton size="sm" side="top" label="Zoom in" shortcut={shortcutOf("view.zoom-in")} onClick={() => run("view.zoom-in")}>
        <Plus className="size-3.5" />
      </IconButton>
      <IconButton size="sm" side="top" label="Zoom to fit" shortcut={shortcutOf("view.fit")} onClick={() => run("view.fit")}>
        <Maximize className="size-3.5" />
      </IconButton>
    </div>
  );
}
