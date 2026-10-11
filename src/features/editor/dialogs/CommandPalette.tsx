"use client";

import { Command } from "cmdk";
import { Eye, FileText, LayoutGrid, MousePointer2, Pencil, Search, type LucideIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { nodeBounds, nodeLabel } from "@/core/model/queries";
import type { DNode, Id } from "@/core/model/types";
import { getShape, libraryOfShape, searchShapes } from "@/core/shapes/registry";
import type { ShapeDef } from "@/core/shapes/types";
import { Kbd } from "@/components/ui/kbd";

import { COMMANDS, formatKeys, isEnabled, type Command as EditorCommand, type CommandGroup } from "../commands/commands";
import { ShapeThumb } from "../panels/ShapeThumb";
import { useEditor, useEditorShallow, useEditorStore } from "../store/context";
import { rank } from "./palette-search";

const PALETTE_COMMANDS = COMMANDS.filter((command) => !command.hidden);
const GROUPS: { name: CommandGroup; icon: LucideIcon }[] = [
  { name: "Tools", icon: MousePointer2 },
  { name: "Edit", icon: Pencil },
  { name: "Arrange", icon: LayoutGrid },
  { name: "View", icon: Eye },
  { name: "Diagram", icon: FileText },
];
/** Large diagrams can match hundreds of elements; only the best are listed. */
const MAX_ELEMENTS = 50;
const MAX_SHAPES = 12;

/*
 * cmdk's own filtering is switched off: the sections match differently
 * (command titles and element labels by word, shapes through the registry's
 * search), so everything is filtered here, in step with the input, and cmdk
 * only handles the keyboard and the selection.
 */

interface PaletteCommand {
  command: EditorCommand;
  /** Index in `PALETTE_COMMANDS`, to look up whether it is enabled. */
  index: number;
}

interface CommandSection {
  group: CommandGroup;
  icon: LucideIcon;
  items: PaletteCommand[];
}

const INDEXED_COMMANDS: PaletteCommand[] = PALETTE_COMMANDS.map((command, index) => ({ command, index }));

/** Commands matching the search, by group; the group holding the best match comes first. */
function matchCommands(search: string): CommandSection[] {
  const ranked = rank(
    INDEXED_COMMANDS,
    search,
    ({ command }) => command.title,
    ({ command }) => [command.group],
  );
  return GROUPS.map(({ name, icon }) => {
    const matches = ranked.filter(({ item }) => item.command.group === name);
    return { group: name, icon, items: matches.map(({ item }) => item), best: matches[0]?.score ?? 0 };
  })
    .filter((section) => section.items.length > 0)
    .sort((a, b) => b.best - a.best);
}

function matchElements(nodes: Record<Id, DNode>, search: string): { node: DNode; label: string }[] {
  const labelled = Object.values(nodes).map((node) => ({ node, label: nodeLabel(node) }));
  return rank(labelled, search, ({ label }) => label)
    .slice(0, MAX_ELEMENTS)
    .map(({ item }) => item);
}

const ITEM =
  "flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-ink select-none data-[selected=true]:bg-sunken data-[disabled=true]:opacity-40";
const GROUP =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:uppercase";

function Row({ value, icon, detail, disabled, onSelect, children }: {
  value: string;
  icon: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Command.Item value={value} disabled={disabled} onSelect={onSelect} className={ITEM}>
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-ink-3">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail}
    </Command.Item>
  );
}

const Detail = ({ children }: { children: ReactNode }) => <span className="max-w-[40%] shrink-0 truncate text-[12px] text-ink-3">{children}</span>;

/** Ctrl/⌘+K palette: run a command, jump to an element, or pick a shape to insert. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const store = useEditorStore();
  const nodes = useEditor((state) => state.doc?.nodes);
  const enabled = useEditorShallow((state) => PALETTE_COMMANDS.map((command) => isEnabled(command, state)));
  const [query, setQuery] = useState("");
  const search = query.trim();

  // Matched in the same render as the input, so cmdk always highlights the first row of the final list.
  const sections = useMemo(() => matchCommands(search), [search]);
  const elements = useMemo(() => (nodes && search ? matchElements(nodes, search) : []), [nodes, search]);
  const shapes = useMemo(() => (search ? searchShapes(search, MAX_SHAPES) : []), [search]);

  /** The palette closes first, so an action that opens a dialog or starts editing is not undone by it. */
  const run = (action: () => void) => {
    onClose();
    action();
  };
  const goTo = (node: DNode) =>
    run(() => {
      const state = store.getState();
      state.select([node.id]);
      state.zoomTo(nodeBounds(node), 160, 1.5);
    });
  const insert = (shape: ShapeDef) =>
    run(() => {
      store.getState().setTool("shape", shape.id);
      toast(`${shape.name}: click or drag on the canvas to place it`);
    });

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/25 backdrop-blur-[2px] dark:bg-black/55" />
        <Dialog.Content
          className="fixed top-[12vh] left-1/2 z-[61] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 animate-pop overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)] outline-none"
          onKeyDown={(event) => {
            // The shortcut that opens the palette also closes it.
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
              event.preventDefault();
              onClose();
            }
          }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search commands, elements on the canvas and shapes to insert.</Dialog.Description>

          <Command label="Command palette" shouldFilter={false} vimBindings={false} loop>
            <div className="flex h-12 items-center gap-2.5 border-b border-line px-3.5">
              <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Run a command, find an element, insert a shape…"
                className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
              />
              <Kbd>Esc</Kbd>
            </div>

            <Command.List className="max-h-[min(56vh,420px)] scroll-py-1.5 overflow-y-auto p-1.5">
              <Command.Empty className="px-4 py-9 text-center">
                <p className="text-[13px] text-ink-2">Nothing matches “{search}”.</p>
                <p className="mt-1 text-[12px] text-ink-3">Try a command name, the label of an element, or a shape such as “database”.</p>
              </Command.Empty>

              {sections.map(({ group, icon: Icon, items }) => (
                <Command.Group key={group} heading={group} className={GROUP}>
                  {items.map(({ command, index }) => (
                    <Row
                      key={command.id}
                      value={`command:${command.id}`}
                      icon={<Icon className="size-4" />}
                      disabled={!enabled[index]}
                      detail={command.keys?.length ? <Kbd>{formatKeys(command.keys[0])}</Kbd> : null}
                      onSelect={() => run(() => command.run(store))}
                    >
                      {command.title}
                    </Row>
                  ))}
                </Command.Group>
              ))}

              {elements.length ? (
                <Command.Group heading="Go to element" className={GROUP}>
                  {elements.map(({ node, label }) => (
                    <Row
                      key={node.id}
                      value={`element:${node.id}`}
                      icon={<ShapeThumb shapeId={node.shape} size={20} />}
                      detail={<Detail>{getShape(node.shape).name}</Detail>}
                      onSelect={() => goTo(node)}
                    >
                      {label}
                    </Row>
                  ))}
                </Command.Group>
              ) : null}

              {shapes.length ? (
                <Command.Group heading="Insert shape" className={GROUP}>
                  {shapes.map((shape) => (
                    <Row
                      key={shape.id}
                      value={`shape:${shape.id}`}
                      icon={<ShapeThumb shapeId={shape.id} size={20} />}
                      detail={<Detail>{libraryOfShape(shape.id)?.name}</Detail>}
                      onSelect={() => insert(shape)}
                    >
                      {shape.name}
                    </Row>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>

            <div className="flex h-9 items-center gap-3 border-t border-line px-3.5 text-[11.5px] text-ink-3">
              <span className="min-w-0 flex-1 truncate">{search ? "" : "Type to find elements on the canvas and shapes to insert."}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                navigate
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Kbd>↵</Kbd>
                run
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
