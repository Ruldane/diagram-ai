import { toast } from "sonner";

import { union } from "@/core/geometry/basics";
import { nodeBounds } from "@/core/model/queries";
import { isMac } from "@/lib/agents";

import {
  addConnectedNode,
  alignSelection,
  defaultShape,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  frameSelection,
  nudgeSelection,
  reorder,
  selectAll,
  selectedNodes,
  toggleLock,
  type Alignment,
} from "../actions/elements";
import { autoLayout } from "../actions/layout";
import { requestComposerFocus } from "../chat/focus";
import { startPresentation } from "../present/session";
import { selectedFrame } from "../present/slides";
import type { EditorState, EditorStore } from "../store/editor-store";

export type CommandGroup = "Tools" | "Edit" | "Arrange" | "View" | "Diagram";

/**
 * A command is one user-invocable action. The same registry drives keyboard
 * shortcuts, the command palette, the context menu and the shortcuts sheet,
 * so adding an entry here makes a feature reachable everywhere.
 */
export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** `mod` = Ctrl / ⌘. Several alternatives may be listed. */
  keys?: string[];
  /** Hidden from the palette (e.g. arrow-key nudges). */
  hidden?: boolean;
  enabled?: (state: EditorState) => boolean;
  run: (store: EditorStore) => void;
}

const hasSelection = (state: EditorState): boolean => state.selection.length > 0;
const hasAnyNode = (state: EditorState): boolean => Object.keys(state.doc?.nodes ?? {}).length > 0;
const hasNodes = (count: number) => (state: EditorState): boolean =>
  Boolean(state.doc) && selectedNodes(state.doc!, state.selection).length >= count;

const tool = (id: string, title: string, key: string, run: (store: EditorStore) => void): Command => ({
  id: `tool.${id}`,
  title,
  group: "Tools",
  keys: [key],
  run,
});

const align = (alignment: Alignment, title: string, key: string): Command => ({
  id: `arrange.align-${alignment}`,
  title,
  group: "Arrange",
  keys: [`alt+${key}`],
  enabled: hasNodes(2),
  run: (store) => alignSelection(store, alignment),
});

const nudge = (key: string, dx: number, dy: number): Command[] => [
  { id: `edit.nudge-${key}`, title: `Nudge ${key}`, group: "Edit", keys: [`arrow${key}`], hidden: true, enabled: hasSelection, run: (store) => nudgeSelection(store, dx, dy) },
  { id: `edit.nudge-${key}-far`, title: `Nudge ${key} ×10`, group: "Edit", keys: [`shift+arrow${key}`], hidden: true, enabled: hasSelection, run: (store) => nudgeSelection(store, dx * 10, dy * 10) },
];

/** Arrow keys move the view when nothing is selected; with a selection they nudge it instead. */
const pan = (key: string, dx: number, dy: number): Command[] => {
  const by = (amount: number) => (store: EditorStore) => {
    const { viewport, setViewport } = store.getState();
    setViewport({ ...viewport, x: viewport.x + dx * amount, y: viewport.y + dy * amount });
  };
  const idle = (state: EditorState) => state.selection.length === 0;
  return [
    { id: `view.pan-${key}`, title: `Pan ${key}`, group: "View", keys: [`arrow${key}`], hidden: true, enabled: idle, run: by(80) },
    { id: `view.pan-${key}-far`, title: `Pan ${key} further`, group: "View", keys: [`shift+arrow${key}`], hidden: true, enabled: idle, run: by(400) },
  ];
};

function zoomBy(store: EditorStore, factor: number) {
  const { canvasSize, zoomAt } = store.getState();
  zoomAt({ x: canvasSize.w / 2, y: canvasSize.h / 2 }, factor);
}

export const COMMANDS: Command[] = [
  tool("select", "Select", "v", (store) => store.getState().setTool("select")),
  tool("pan", "Hand (pan)", "h", (store) => store.getState().setTool("pan")),
  tool("shape", "Shape", "r", (store) => {
    const { doc, setTool } = store.getState();
    if (doc) setTool("shape", defaultShape(doc));
  }),
  tool("ellipse", "Ellipse", "o", (store) => store.getState().setTool("shape", "basic/ellipse")),
  tool("diamond", "Diamond", "d", (store) => store.getState().setTool("shape", "basic/diamond")),
  tool("text", "Text", "t", (store) => store.getState().setTool("text")),
  tool("connect", "Connector", "l", (store) => store.getState().setTool("connect")),
  tool("note", "Sticky note", "n", (store) => store.getState().setTool("shape", "basic/note")),
  tool("frame", "Frame", "f", (store) => store.getState().setTool("shape", "basic/frame")),
  tool("comment", "Comment", "c", (store) => store.getState().setTool("comment")),

  { id: "edit.undo", title: "Undo", group: "Edit", keys: ["mod+z"], enabled: (s) => s.undoStack.length > 0, run: (store) => store.getState().undo() },
  { id: "edit.redo", title: "Redo", group: "Edit", keys: ["mod+shift+z", "mod+y"], enabled: (s) => s.redoStack.length > 0, run: (store) => store.getState().redo() },
  { id: "edit.duplicate", title: "Duplicate", group: "Edit", keys: ["mod+d"], enabled: hasNodes(1), run: (store) => duplicateSelection(store) },
  { id: "edit.delete", title: "Delete", group: "Edit", keys: ["delete", "backspace"], enabled: hasSelection, run: deleteSelection },
  { id: "edit.select-all", title: "Select all", group: "Edit", keys: ["mod+a"], run: selectAll },
  {
    id: "edit.text",
    title: "Edit text",
    group: "Edit",
    keys: ["enter", "f2"],
    enabled: (s) => s.selection.length === 1,
    run: (store) => store.setState({ editing: store.getState().selection[0] }),
  },
  {
    id: "edit.add-connected",
    title: "Add connected node",
    group: "Edit",
    keys: ["tab"],
    enabled: (s) => hasNodes(1)(s) && s.selection.length === 1,
    run: (store) => {
      const { doc, selection } = store.getState();
      if (!doc) return;
      const direction = { down: "bottom", up: "top", right: "right", left: "left" } as const;
      addConnectedNode(store, selection[0], direction[doc.settings.layout.direction]);
    },
  },
  {
    id: "edit.escape",
    title: "Deselect / cancel",
    group: "Edit",
    keys: ["escape"],
    hidden: true,
    run: (store) => {
      const state = store.getState();
      if (state.gestureBase) state.cancelGesture();
      else if (state.draftComment) store.setState({ draftComment: null });
      else if (state.tool !== "select") state.setTool("select");
      else state.select([]);
    },
  },
  ...pan("left", 1, 0),
  ...pan("right", -1, 0),
  ...pan("up", 0, 1),
  ...pan("down", 0, -1),
  ...nudge("left", -1, 0),
  ...nudge("right", 1, 0),
  ...nudge("up", 0, -1),
  ...nudge("down", 0, 1),

  { id: "arrange.layout", title: "Auto-arrange diagram", group: "Arrange", keys: ["shift+a"], run: (store) => void autoLayout(store) },
  { id: "arrange.layout-selection", title: "Auto-arrange selection", group: "Arrange", enabled: hasNodes(2), run: (store) => void autoLayout(store, undefined, true) },
  { id: "arrange.front", title: "Bring to front", group: "Arrange", keys: ["mod+]"], enabled: hasSelection, run: (store) => reorder(store, "front") },
  { id: "arrange.back", title: "Send to back", group: "Arrange", keys: ["mod+["], enabled: hasSelection, run: (store) => reorder(store, "back") },
  align("left", "Align left", "a"),
  align("center", "Align centre", "h"),
  align("right", "Align right", "d"),
  align("top", "Align top", "w"),
  align("middle", "Align middle", "v"),
  align("bottom", "Align bottom", "s"),
  { id: "arrange.distribute-h", title: "Distribute horizontally", group: "Arrange", enabled: hasNodes(3), run: (store) => distributeSelection(store, "horizontal") },
  { id: "arrange.distribute-v", title: "Distribute vertically", group: "Arrange", enabled: hasNodes(3), run: (store) => distributeSelection(store, "vertical") },
  { id: "arrange.frame", title: "Frame selection", group: "Arrange", keys: ["mod+g"], enabled: hasNodes(1), run: frameSelection },
  { id: "arrange.lock", title: "Lock / unlock", group: "Arrange", keys: ["mod+shift+l"], enabled: hasNodes(1), run: toggleLock },

  { id: "view.zoom-in", title: "Zoom in", group: "View", keys: ["mod+=", "="], run: (store) => zoomBy(store, 1.25) },
  { id: "view.zoom-out", title: "Zoom out", group: "View", keys: ["mod+-", "-"], run: (store) => zoomBy(store, 0.8) },
  {
    id: "view.zoom-100",
    title: "Zoom to 100%",
    group: "View",
    keys: ["mod+0", "shift+0"],
    run: (store) => {
      const { viewport } = store.getState();
      zoomBy(store, 1 / viewport.zoom);
    },
  },
  { id: "view.fit", title: "Zoom to fit", group: "View", keys: ["shift+1"], run: (store) => store.getState().fit() },
  {
    id: "view.zoom-selection",
    title: "Zoom to selection",
    group: "View",
    keys: ["shift+2"],
    enabled: hasNodes(1),
    run: (store) => {
      const { doc, selection, zoomTo } = store.getState();
      const bounds = doc ? union(selectedNodes(doc, selection).map(nodeBounds)) : null;
      if (bounds) zoomTo(bounds, 120, 2);
    },
  },
  {
    id: "view.grid",
    title: "Toggle grid",
    group: "View",
    keys: ["mod+'"],
    run: (store) => {
      const { doc, apply } = store.getState();
      if (!doc) return;
      const next = doc.settings.grid === "dots" ? "lines" : doc.settings.grid === "lines" ? "none" : "dots";
      apply({ doc: { settings: { grid: next } } });
    },
  },
  {
    id: "view.snap",
    title: "Toggle snapping",
    group: "View",
    keys: ["mod+shift+'"],
    run: (store) => {
      const { doc, apply } = store.getState();
      if (!doc) return;
      apply({ doc: { settings: { snap: !doc.settings.snap } } });
      toast(doc.settings.snap ? "Snapping off" : "Snapping on");
    },
  },
  { id: "view.palette", title: "Toggle shape library", group: "View", keys: ["mod+\\"], run: (store) => store.setState({ paletteOpen: !store.getState().paletteOpen }) },
  {
    id: "view.inspector",
    title: "Toggle side panel",
    group: "View",
    keys: ["mod+."],
    run: (store) => store.setState({ panel: store.getState().panel ? null : "design" }),
  },
  { id: "view.comments", title: "Show comments", group: "View", run: (store) => store.setState({ panel: "comments" }) },
  { id: "view.activity", title: "Show agent activity", group: "View", run: (store) => store.setState({ panel: "activity" }) },
  { id: "review.open", title: "Review agent changes", group: "View", run: (store) => store.setState({ panel: "review" }) },
  { id: "view.code", title: "Diagram as code (Mermaid, PlantUML)", group: "View", run: (store) => store.setState({ panel: "code" }) },
  {
    id: "view.present",
    title: "Present",
    group: "View",
    keys: ["mod+alt+p"],
    enabled: (s) => !s.presenting && hasAnyNode(s),
    run: (store) => void startPresentation(store),
  },
  {
    id: "view.present-frame",
    title: "Present from this frame",
    group: "View",
    enabled: (s) => !s.presenting && Boolean(s.doc) && selectedFrame(s.doc!, s.selection) !== undefined,
    run: (store) => {
      const { doc, selection } = store.getState();
      const frame = doc ? selectedFrame(doc, selection) : undefined;
      if (frame !== undefined) startPresentation(store, frame);
    },
  },

  { id: "diagram.command", title: "Command palette", group: "Diagram", keys: ["mod+k"], hidden: true, run: (store) => store.setState({ dialog: "command" }) },
  { id: "diagram.export", title: "Export…", group: "Diagram", keys: ["mod+e"], run: (store) => store.setState({ dialog: "export" }) },
  { id: "diagram.history", title: "Checkpoints…", group: "Diagram", keys: ["mod+shift+h"], run: (store) => store.setState({ dialog: "history" }) },
  {
    id: "assistant.open",
    title: "Ask the assistant",
    group: "Diagram",
    keys: ["mod+j"],
    run: (store) => {
      store.setState({ panel: "ask" });
      requestComposerFocus();
    },
  },
  { id: "diagram.agent", title: "Connect an AI agent…", group: "Diagram", run: (store) => store.setState({ dialog: "agent" }) },
  { id: "packs.open", title: "Icon packs…", group: "Diagram", run: (store) => store.setState({ dialog: "packs" }) },
  { id: "diagram.shortcuts", title: "Keyboard shortcuts", group: "Diagram", keys: ["?", "shift+?"], run: (store) => store.setState({ dialog: "shortcuts" }) },
];

const byId = new Map(COMMANDS.map((command) => [command.id, command]));

export function getCommand(id: string): Command | undefined {
  return byId.get(id);
}

export function isEnabled(command: Command, state: EditorState): boolean {
  return state.status === "ready" && (command.enabled?.(state) ?? true);
}

export function runCommand(store: EditorStore, id: string): boolean {
  const command = byId.get(id);
  if (!command || !isEnabled(command, store.getState())) return false;
  command.run(store);
  return true;
}

/** Canonical key string for an event, e.g. `mod+shift+z`. */
export function eventKeys(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
}

const byKeys = new Map<string, Command[]>();
for (const command of COMMANDS) {
  for (const keys of command.keys ?? []) byKeys.set(keys, [...(byKeys.get(keys) ?? []), command]);
}

export function commandsForEvent(event: KeyboardEvent): Command[] {
  const exact = byKeys.get(eventKeys(event));
  if (exact) return exact;
  // Alt-based shortcuts must match the physical key: Alt+letter types a symbol on macOS.
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) {
    const parts = [event.ctrlKey || event.metaKey ? "mod" : "", "alt", event.shiftKey ? "shift" : "", event.code.slice(3).toLowerCase()];
    return byKeys.get(parts.filter(Boolean).join("+")) ?? [];
  }
  return [];
}

const KEY_LABELS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  delete: "Del",
  backspace: "⌫",
  enter: "↵",
  escape: "Esc",
  tab: "Tab",
};

/** Human-readable shortcut for the current platform (`⌘D` / `Ctrl+D`). */
export function formatKeys(keys: string | undefined): string | undefined {
  if (!keys) return undefined;
  const mac = isMac();
  const labels = keys.split("+").map((part) => {
    if (part === "mod") return mac ? "⌘" : "Ctrl";
    if (part === "shift") return mac ? "⇧" : "Shift";
    if (part === "alt") return mac ? "⌥" : "Alt";
    return KEY_LABELS[part] ?? (part.length === 1 || /^f\d{1,2}$/.test(part) ? part.toUpperCase() : part);
  });
  return mac ? labels.join("") : labels.join("+");
}

export function shortcutOf(id: string): string | undefined {
  return formatKeys(byId.get(id)?.keys?.[0]);
}
