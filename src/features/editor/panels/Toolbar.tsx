"use client";

import { Frame, Hand, LayoutGrid, MessageSquarePlus, MousePointer2, Shapes, Spline, StickyNote, Type } from "lucide-react";
import type { ReactNode } from "react";

import { getDiagramType } from "@/core/catalog";
import type { LayoutAlgorithm, LayoutDirection } from "@/core/model/types";
import { Button, IconButton } from "@/components/ui/button";
import { Popover } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/fields";

import { defaultShape } from "../actions/elements";
import { autoLayout } from "../actions/layout";
import { runCommand, shortcutOf } from "../commands/commands";
import { useEditor, useEditorStore } from "../store/context";
import type { Tool } from "../store/editor-store";
import { ShapeThumb } from "./ShapeThumb";

const QUICK_SHAPES = ["basic/rounded", "basic/rect", "basic/ellipse", "basic/diamond", "basic/cylinder", "basic/pill", "basic/hexagon", "basic/cloud"];

/** Shapes with their own toolbar button; the generic shape button is not lit for these. */
const DEDICATED_SHAPES = ["basic/note", "basic/frame"];

function ToolButton({ tool, command, label, shape, children }: { tool: Tool; command: string; label: string; shape?: string; children: ReactNode }) {
  const store = useEditorStore();
  const active = useEditor((state) => {
    if (state.tool !== tool) return false;
    if (tool !== "shape") return true;
    return shape ? state.toolShape === shape : !DEDICATED_SHAPES.includes(state.toolShape ?? "");
  });
  return (
    <IconButton label={label} shortcut={shortcutOf(command)} side="top" active={active} onClick={() => runCommand(store, command)}>
      {children}
    </IconButton>
  );
}

const ALGORITHMS: { value: LayoutAlgorithm; label: string }[] = [
  { value: "layered", label: "Flow" },
  { value: "tree", label: "Tree" },
  { value: "force", label: "Network" },
  { value: "radial", label: "Radial" },
  { value: "grid", label: "Grid" },
];
const DIRECTIONS: { value: LayoutDirection; label: string }[] = [
  { value: "down", label: "↓" },
  { value: "right", label: "→" },
  { value: "up", label: "↑" },
  { value: "left", label: "←" },
];

function LayoutMenu() {
  const store = useEditorStore();
  const layout = useEditor((state) => state.doc!.settings.layout);
  const hasSelection = useEditor((state) => state.selection.filter((id) => state.doc?.nodes[id]).length > 1);
  return (
    <Popover
      side="top"
      align="center"
      className="w-64"
      trigger={
        <IconButton label="Auto-arrange" shortcut={shortcutOf("arrange.layout")} side="top">
          <LayoutGrid className="size-[18px]" />
        </IconButton>
      }
    >
      <p className="mb-2 text-[12px] font-semibold text-ink-2">Auto-arrange</p>
      <div className="flex flex-col gap-2">
        <Segmented label="Layout" value={layout.algorithm} options={ALGORITHMS} onChange={(algorithm) => void autoLayout(store, { ...layout, algorithm })} />
        <Segmented label="Direction" value={layout.direction} options={DIRECTIONS} onChange={(direction) => void autoLayout(store, { ...layout, direction })} />
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="primary" className="flex-1" onClick={() => void autoLayout(store)}>
            Arrange all
          </Button>
          <Button size="sm" className="flex-1" disabled={!hasSelection} onClick={() => void autoLayout(store, undefined, true)}>
            Selection
          </Button>
        </div>
      </div>
    </Popover>
  );
}

/** More shapes, one click away from the main shape button. */
function ShapeMenu() {
  const store = useEditorStore();
  const typeShape = useEditor((state) => (state.doc ? defaultShape(state.doc) : "basic/rounded"));
  const typeName = useEditor((state) => getDiagramType(state.doc!.type).name);
  const shapes = [typeShape, ...QUICK_SHAPES.filter((id) => id !== typeShape)].slice(0, 8);
  return (
    <Popover
      side="top"
      align="center"
      className="w-[212px] p-2"
      trigger={
        <button type="button" aria-label="More shapes" className="-ml-1.5 flex h-8 w-4 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink">
          <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden>
            <path d="M1 4l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      }
    >
      <p className="px-1 pb-1.5 text-[11px] text-ink-3">Draw a shape · default for {typeName} first</p>
      <div className="grid grid-cols-4 gap-1">
        {shapes.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={`Draw ${id.split("/")[1]}`}
            onClick={() => store.getState().setTool("shape", id)}
            className="flex aspect-square items-center justify-center rounded-lg border border-transparent hover:border-line-strong hover:bg-sunken"
          >
            <ShapeThumb shapeId={id} size={34} />
          </button>
        ))}
      </div>
    </Popover>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px bg-line" aria-hidden />;

/** Main tool strip, bottom centre: the few things you reach for constantly. */
export function Toolbar() {
  return (
    <div role="toolbar" aria-label="Tools" className="flex items-center gap-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-lg)]">
      <ToolButton tool="select" command="tool.select" label="Select">
        <MousePointer2 className="size-[18px]" />
      </ToolButton>
      <ToolButton tool="pan" command="tool.pan" label="Hand">
        <Hand className="size-[18px]" />
      </ToolButton>
      <Divider />
      <ToolButton tool="shape" command="tool.shape" label="Shape">
        <Shapes className="size-[18px]" />
      </ToolButton>
      <ShapeMenu />
      <ToolButton tool="text" command="tool.text" label="Text">
        <Type className="size-[18px]" />
      </ToolButton>
      <ToolButton tool="connect" command="tool.connect" label="Connector">
        <Spline className="size-[18px]" />
      </ToolButton>
      <ToolButton tool="shape" shape="basic/note" command="tool.note" label="Sticky note">
        <StickyNote className="size-[18px]" />
      </ToolButton>
      <ToolButton tool="shape" shape="basic/frame" command="tool.frame" label="Frame">
        <Frame className="size-[18px]" />
      </ToolButton>
      <ToolButton tool="comment" command="tool.comment" label="Comment">
        <MessageSquarePlus className="size-[18px]" />
      </ToolButton>
      <Divider />
      <LayoutMenu />
    </div>
  );
}
