"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  Frame,
  LayoutGrid,
  Lock,
  Maximize,
  MessageSquarePlus,
  Pencil,
  Presentation,
  Scissors,
  Trash2,
  CopyPlus,
} from "lucide-react";
import type { ReactNode } from "react";

import { ContextItem, ContextSeparator } from "@/components/ui/menu";

import { copyPayload, cutPayload, pasteText } from "../actions/clipboard";
import { formatKeys, getCommand, isEnabled, shortcutOf } from "../commands/commands";
import { selectedFrame } from "../present/slides";
import { useEditor, useEditorStore } from "../store/context";

function CommandItem({ id, icon, danger }: { id: string; icon: ReactNode; danger?: boolean }) {
  const store = useEditorStore();
  const command = getCommand(id);
  const enabled = useEditor((state) => (command ? isEnabled(command, state) : false));
  if (!command) return null;
  return (
    <ContextItem icon={icon} shortcut={shortcutOf(id)} disabled={!enabled} danger={danger} onSelect={() => command.run(store)}>
      {command.title}
    </ContextItem>
  );
}

/** Right-click menu of the canvas. Adapts to whether anything is selected. */
export function CanvasMenu() {
  const store = useEditorStore();
  const count = useEditor((state) => state.selection.length);
  const nodeCount = useEditor((state) => state.selection.filter((id) => state.doc?.nodes[id]).length);
  const frameSelected = useEditor((state) => (state.doc ? selectedFrame(state.doc, state.selection) !== undefined : false));

  const copy = () => {
    const { doc, selection } = store.getState();
    const payload = doc ? copyPayload(doc, selection) : null;
    if (payload) void navigator.clipboard.writeText(payload);
  };
  const cut = () => {
    const payload = cutPayload(store);
    if (payload) void navigator.clipboard.writeText(payload);
  };
  const paste = async () => {
    try {
      const state = store.getState();
      pasteText(store, await navigator.clipboard.readText(), state.toWorld({ x: state.canvasSize.w / 2, y: state.canvasSize.h / 2 }));
    } catch {
      // Clipboard permission denied: Ctrl+V still works.
    }
  };
  const comment = () => {
    const { doc, selection, toWorld, canvasSize } = store.getState();
    const node = doc?.nodes[selection[0]];
    const at = node ? { x: node.x + node.w, y: node.y } : toWorld({ x: canvasSize.w / 2, y: canvasSize.h / 2 });
    store.setState({ draftComment: { ...at, target: node?.id }, panel: "comments" });
  };

  if (count === 0) {
    return (
      <>
        <ContextItem icon={<ClipboardPaste />} shortcut={formatKeys("mod+v")} onSelect={() => void paste()}>
          Paste
        </ContextItem>
        <ContextItem icon={<MessageSquarePlus />} onSelect={comment}>
          Add comment here
        </ContextItem>
        <ContextSeparator />
        <CommandItem id="edit.select-all" icon={null} />
        <CommandItem id="arrange.layout" icon={<LayoutGrid />} />
        <CommandItem id="view.fit" icon={<Maximize />} />
      </>
    );
  }

  return (
    <>
      {count === 1 ? <CommandItem id="edit.text" icon={<Pencil />} /> : null}
      <ContextItem icon={<Scissors />} shortcut={formatKeys("mod+x")} disabled={!nodeCount} onSelect={cut}>
        Cut
      </ContextItem>
      <ContextItem icon={<Copy />} shortcut={formatKeys("mod+c")} disabled={!nodeCount} onSelect={copy}>
        Copy
      </ContextItem>
      <CommandItem id="edit.duplicate" icon={<CopyPlus />} />
      <ContextItem icon={<MessageSquarePlus />} onSelect={comment}>
        Comment
      </ContextItem>
      <ContextSeparator />
      <CommandItem id="arrange.front" icon={<ArrowUpToLine />} />
      <CommandItem id="arrange.back" icon={<ArrowDownToLine />} />
      {nodeCount > 1 ? (
        <>
          <ContextSeparator />
          <CommandItem id="arrange.align-left" icon={<AlignStartVertical />} />
          <CommandItem id="arrange.align-center" icon={<AlignCenterVertical />} />
          <CommandItem id="arrange.align-right" icon={<AlignEndVertical />} />
          <CommandItem id="arrange.align-top" icon={<AlignStartHorizontal />} />
          <CommandItem id="arrange.align-middle" icon={<AlignCenterHorizontal />} />
          <CommandItem id="arrange.align-bottom" icon={<AlignEndHorizontal />} />
          <CommandItem id="arrange.layout-selection" icon={<LayoutGrid />} />
        </>
      ) : null}
      <ContextSeparator />
      <CommandItem id="arrange.frame" icon={<Frame />} />
      <CommandItem id="arrange.lock" icon={<Lock />} />
      {frameSelected ? <CommandItem id="view.present-frame" icon={<Presentation />} /> : null}
      <ContextSeparator />
      <CommandItem id="edit.delete" icon={<Trash2 />} danger />
    </>
  );
}
