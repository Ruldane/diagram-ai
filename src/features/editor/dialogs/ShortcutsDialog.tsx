"use client";

import { Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/fields";
import { Kbd } from "@/components/ui/kbd";

import { COMMANDS, formatKeys, type Command, type CommandGroup } from "../commands/commands";

interface Shortcut {
  title: string;
  /** Formatted alternatives; any one of them triggers the action. */
  keys: string[];
  /** The keys are one per action named in the title, not alternatives. */
  respective?: boolean;
}

interface Section {
  name: string;
  shortcuts: Shortcut[];
}

const GROUP_ORDER: CommandGroup[] = ["Tools", "Edit", "Arrange", "View", "Diagram"];

/** Alternatives worth showing: `shift+?` is how `?` is typed, not a second shortcut. */
function alternatives(command: Command): string[] {
  const keys = command.keys ?? [];
  return keys.filter((combo) => !(combo.startsWith("shift+") && keys.includes(combo.slice(6)))).flatMap((combo) => formatKeys(combo) ?? []);
}

function commandSections(): Section[] {
  return GROUP_ORDER.map((group) => ({
    name: group,
    shortcuts: COMMANDS.filter((command) => command.group === group && !command.hidden && command.keys?.length).map((command) => ({
      title: command.title.replace(/…$/, ""),
      keys: alternatives(command),
    })),
  }));
}

/** Mouse and keyboard gestures that are not commands. */
function canvasSection(): Section {
  const mod = formatKeys("mod") ?? "Ctrl";
  const shift = formatKeys("shift") ?? "Shift";
  const alt = formatKeys("alt") ?? "Alt";
  const combo = (keys: string): string => formatKeys(keys) ?? keys;
  return {
    name: "Canvas",
    shortcuts: [
      { title: "Pan", keys: ["Space + drag", "Middle-drag"] },
      { title: "Zoom", keys: [`${mod} + wheel`] },
      { title: "Add a node or edit text", keys: ["Double-click"] },
      { title: "Connect two nodes", keys: ["Drag a + port"] },
      { title: "Add a connected node", keys: ["Click a + port"] },
      { title: "Add to or remove from the selection", keys: [`${shift} + click`] },
      { title: "Move without snapping", keys: [`${alt} while dragging`] },
      { title: "Resize keeping proportions", keys: [`${shift} while resizing`] },
      { title: "Copy, cut and paste", keys: [combo("mod+c"), combo("mod+x"), combo("mod+v")], respective: true },
      { title: "Finish editing text", keys: [combo("escape"), combo("mod+enter")] },
    ],
  };
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <li className="flex min-h-7 items-center justify-between gap-3 py-0.5">
      <span className="min-w-0 text-[13px] text-ink-2">{shortcut.title}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {shortcut.keys.map((keys, index) => (
          <Fragment key={keys}>
            {index > 0 && !shortcut.respective ? <span className="text-[11px] text-ink-4">or</span> : null}
            <Kbd className="whitespace-nowrap">{keys}</Kbd>
          </Fragment>
        ))}
      </span>
    </li>
  );
}

/** Searchable sheet of every keyboard shortcut and canvas gesture. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  // Key labels depend on the platform, so they are resolved in the browser when the sheet opens.
  const sections = useMemo(() => [...commandSections(), canvasSection()], []);

  const needle = query.trim().toLowerCase();
  const visible = sections
    .map((section) => ({
      ...section,
      shortcuts: section.shortcuts.filter(
        (shortcut) => !needle || shortcut.title.toLowerCase().includes(needle) || shortcut.keys.some((keys) => keys.toLowerCase().includes(needle)),
      ),
    }))
    .filter((section) => section.shortcuts.length > 0);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Keyboard shortcuts" width="max-w-3xl">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
        <TextInput
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
        />
      </div>

      {visible.length ? (
        <div className="mt-4 gap-8 sm:columns-2">
          {visible.map((section) => (
            <section key={section.name} aria-label={section.name} className="mb-5 break-inside-avoid">
              <h3 className="mb-1 border-b border-line pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{section.name}</h3>
              <ul>
                {section.shortcuts.map((shortcut) => (
                  <ShortcutRow key={shortcut.title} shortcut={shortcut} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-[13px] text-ink-3">No shortcut matches “{query.trim()}”.</p>
      )}
    </Dialog>
  );
}
