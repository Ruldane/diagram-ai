"use client";

import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowUpToLine, CopyPlus, Trash2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { IconButton } from "@/components/ui/button";

import { runCommand, shortcutOf } from "../../commands/commands";
import { useEditor, useEditorStore } from "../../store/context";
import { Section } from "./controls";
import { DocInspector } from "./DocInspector";
import { EdgeInspector } from "./EdgeInspector";
import { NodeInspector } from "./NodeInspector";

function Action({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const store = useEditorStore();
  return (
    <IconButton size="sm" label={label} shortcut={shortcutOf(id)} onClick={() => runCommand(store, id)}>
      {children}
    </IconButton>
  );
}

function ArrangeBar({ multiple }: { multiple: boolean }) {
  return (
    <Section title="Arrange">
      <div className="flex flex-wrap items-center gap-0.5">
        {multiple ? (
          <>
            <Action id="arrange.align-left" label="Align left"><AlignStartVertical className="size-4" /></Action>
            <Action id="arrange.align-center" label="Align centre"><AlignCenterVertical className="size-4" /></Action>
            <Action id="arrange.align-right" label="Align right"><AlignEndVertical className="size-4" /></Action>
            <Action id="arrange.align-top" label="Align top"><AlignStartHorizontal className="size-4" /></Action>
            <Action id="arrange.align-middle" label="Align middle"><AlignCenterHorizontal className="size-4" /></Action>
            <Action id="arrange.align-bottom" label="Align bottom"><AlignEndHorizontal className="size-4" /></Action>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          </>
        ) : null}
        <Action id="arrange.front" label="Bring to front"><ArrowUpToLine className="size-4" /></Action>
        <Action id="arrange.back" label="Send to back"><ArrowDownToLine className="size-4" /></Action>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <Action id="edit.duplicate" label="Duplicate"><CopyPlus className="size-4" /></Action>
        <Action id="edit.delete" label="Delete"><Trash2 className="size-4" /></Action>
      </div>
    </Section>
  );
}

/** Contextual properties: the selection's, or the diagram's when nothing is selected. */
export function Inspector() {
  const selection = useEditor((state) => state.selection);
  const allNodes = useEditor((state) => state.doc!.nodes);
  const allEdges = useEditor((state) => state.doc!.edges);
  // Derived during render: selectors must return stable references.
  const nodes = useMemo(() => selection.map((id) => allNodes[id]).filter(Boolean), [selection, allNodes]);
  const edges = useMemo(() => selection.map((id) => allEdges[id]).filter(Boolean), [selection, allEdges]);
  if (nodes.length === 0 && edges.length === 0) return <DocInspector />;
  return (
    <>
      {nodes.length ? <NodeInspector nodes={nodes} /> : null}
      {edges.length && !nodes.length ? <EdgeInspector edges={edges} /> : null}
      <ArrangeBar multiple={nodes.length > 1} />
    </>
  );
}
