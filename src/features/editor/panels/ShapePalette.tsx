"use client";

import { ChevronRight, PanelLeftClose, Search, X } from "lucide-react";
import { Fragment, useDeferredValue, useMemo, useState } from "react";

import { getDiagramType } from "@/core/catalog";
import { isRuntimeLibrary, listLibraries, searchShapes } from "@/core/shapes/registry";
import type { ShapeDef, ShapeLibrary } from "@/core/shapes/types";
import { IconButton } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { createNode } from "../actions/elements";
import { shortcutOf } from "../commands/commands";
import { useRegistryVersion } from "../packs/use-packs";
import { useEditor, useEditorStore } from "../store/context";
import { ShapeThumb } from "./ShapeThumb";

export const SHAPE_DRAG_TYPE = "application/x-diagram-ai-shape";

function ShapeButton({ shape }: { shape: ShapeDef }) {
  const store = useEditorStore();
  const armed = useEditor((state) => state.toolShape === shape.id);

  /** Click drops the shape in the middle of the view, nudged so repeated clicks do not stack. */
  const add = () => {
    const state = store.getState();
    const count = state.doc ? Object.keys(state.doc.nodes).length : 0;
    const centre = state.toWorld({ x: state.canvasSize.w / 2, y: state.canvasSize.h / 2 });
    const jitter = (count % 6) * 20;
    createNode(store, shape.id, { at: { x: centre.x + jitter, y: centre.y + jitter } });
    state.setTool("select");
  };

  return (
    <Tip label={shape.name} side="right">
      <button
        type="button"
        draggable
        aria-label={`Add ${shape.name}`}
        onClick={add}
        onDragStart={(event) => {
          event.dataTransfer.setData(SHAPE_DRAG_TYPE, shape.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        className={cn(
          "flex aspect-square items-center justify-center rounded-lg border transition-colors",
          armed ? "border-accent bg-accent-soft" : "border-transparent hover:border-line-strong hover:bg-raised",
        )}
      >
        <ShapeThumb shapeId={shape.id} size={38} />
      </button>
    </Tip>
  );
}

function LibrarySection({ library, defaultOpen }: { library: ShapeLibrary; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // An imported pack can be replaced under the same ids, so its thumbnails are rebuilt on every change.
  const version = useRegistryVersion();
  const imported = isRuntimeLibrary(library.id);
  if (library.shapes.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] font-semibold text-ink-2 hover:bg-sunken"
      >
        <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-90")} />
        <span className="flex-1 truncate">{library.name}</span>
        <span className="font-mono text-[10.5px] font-normal text-ink-4">{library.shapes.length}</span>
      </button>
      {open ? (
        <div className="grid grid-cols-4 gap-1 px-0.5 pt-1 pb-2">
          {library.shapes.map((shape) => (
            <ShapeButton key={imported ? `${shape.id}:${version}` : shape.id} shape={shape} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Shape library. Libraries relevant to the diagram type come first and start
 * open; click a shape to add it, or drag it onto the canvas.
 */
export function ShapePalette() {
  const store = useEditorStore();
  const type = useEditor((state) => state.doc!.type);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  // Imported icon packs come and go while the editor is open.
  const registry = useRegistryVersion();

  const libraries = useMemo(() => {
    const pinned = getDiagramType(type).libraries;
    const all = listLibraries();
    const first = pinned.map((id) => all.find((l) => l.id === id)).filter((l): l is ShapeLibrary => Boolean(l));
    const ordered = [...first, ...all.filter((l) => !pinned.includes(l.id))];
    return { pinned: new Set(first.map((l) => l.id)), ordered, firstPack: ordered.find((l) => isRuntimeLibrary(l.id))?.id };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `registry` changes when an icon pack is added or removed
  }, [type, registry]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `registry` changes when an icon pack is added or removed
  const results = useMemo(() => (deferred ? searchShapes(deferred, 60) : null), [deferred, registry]);

  return (
    <aside aria-label="Shape library" className="flex h-full w-[232px] flex-col rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-panel)]">
      <header className="flex items-center gap-1 px-2 pt-2">
        <label className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-raised px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <Search className="size-3.5 shrink-0 text-ink-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shapes"
            aria-label="Search shapes"
            className="w-full min-w-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-4"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-ink-3 hover:text-ink">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        <IconButton label="Hide shape library" shortcut={shortcutOf("view.palette")} size="sm" onClick={() => store.setState({ paletteOpen: false })}>
          <PanelLeftClose className="size-4" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {results ? (
          results.length ? (
            <div className="grid grid-cols-4 gap-1 px-0.5">
              {results.map((shape) => (
                <ShapeButton key={isRuntimeLibrary(shape.id.split("/")[0]) ? `${shape.id}:${registry}` : shape.id} shape={shape} />
              ))}
            </div>
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-ink-3">No shape matches “{deferred}”.</p>
          )
        ) : (
          libraries.ordered.map((library) => (
            <Fragment key={`${type}:${library.id}`}>
              {library.id === libraries.firstPack ? (
                <p className="px-1.5 pt-3 pb-1 text-[10.5px] font-semibold tracking-wide text-ink-4 uppercase">Icon packs</p>
              ) : null}
              <LibrarySection library={library} defaultOpen={libraries.pinned.has(library.id)} />
            </Fragment>
          ))
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-3">
        <span>Click to add · drag to place</span>
        <button type="button" onClick={() => store.setState({ dialog: "packs" })} className="shrink-0 font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Icon packs…
        </button>
      </footer>
    </aside>
  );
}
