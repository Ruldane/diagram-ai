import { createStore, type StoreApi } from "zustand/vanilla";

import type { PublicUser, Role } from "@/core/auth";
import { clamp, union } from "@/core/geometry/basics";
import { newClientId } from "@/core/model/ids";
import { withIntegrity } from "@/core/model/integrity";
import { applyPatch, diffDocs, isEmptyPatch } from "@/core/model/patch";
import { nodeBounds } from "@/core/model/queries";
import type { Actor, DiagramDoc, Id, Patch, Point, Rect, Size } from "@/core/model/types";
import type { ActivityEntry, AgentInfo, ChatMessage, PeerInfo, ReviewInfo } from "@/core/protocol";

export type Tool = "select" | "pan" | "shape" | "connect" | "text" | "comment";
export type SidePanel = "design" | "comments" | "activity" | "review" | "ask" | "code";
export type DialogId = "export" | "import" | "shortcuts" | "agent" | "history" | "command" | "packs" | "share";

/** A second document drawn as a diff on top of the live one (review baseline or a checkpoint). */
export interface Comparison {
  base: DiagramDoc;
  label: string;
  source: "review" | "checkpoint";
}

/** State of the in-app assistant conversation. Lives in the store so it survives switching side-panel tabs. */
export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
}

/** screen = world × zoom + (x, y) */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface HistoryEntry {
  /** Patch that undoes the change. */
  inverse: Patch;
  /** Who made the change, so the UI can say "Undo Claude Code's edit". */
  actor: "you" | string;
}

/** Transient canvas decorations owned by the interaction controller. */
export interface CanvasOverlay {
  marquee?: Rect;
  guides?: { x1: number; y1: number; x2: number; y2: number }[];
  /** Rubber-band connector while dragging from a node. */
  connect?: { from: Id; to: Point; target?: Id };
  /** Outline of a shape being drawn with the shape tool. */
  draft?: Rect;
}

export interface AgentCursor {
  actor: Actor;
  x: number;
  y: number;
}

export interface Highlight {
  ids: Id[];
  message?: string;
  actor: Actor;
  /** Changes on every highlight so repeated ones re-trigger the animation. */
  key: number;
}

/** Space taken by the floating panels, so framing a region keeps it clear of them. */
export const CHROME = { top: 60, bottom: 68, palette: 252, panel: 332, gutter: 12 } as const;

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 6;
const HISTORY_LIMIT = 200;

export interface EditorState {
  diagramId: Id;
  /** Identifies this browser tab to the server. */
  clientId: string;
  status: "loading" | "ready" | "missing" | "error";
  connection: "connecting" | "online" | "offline";
  doc: DiagramDoc | null;

  selection: Id[];
  hovered: Id | null;
  /** Element whose label is being edited in place. */
  editing: Id | null;
  tool: Tool;
  /** Shape placed by the shape tool and by double-click. */
  toolShape: string | null;
  viewport: Viewport;
  canvasSize: Size;
  overlay: CanvasOverlay;
  spaceHeld: boolean;

  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Document as it was when the current drag started. */
  gestureBase: DiagramDoc | null;

  agents: AgentInfo[];
  activity: ActivityEntry[];
  /** Element id → delay (ms) of its draw-in animation. */
  reveal: Record<Id, number>;
  agentCursor: AgentCursor | null;
  highlight: Highlight | null;
  /** Node rectangles shown instead of the stored ones while a layout animates. */
  tween: Record<Id, Rect> | null;

  /** Pending review of agent changes (server state). */
  review: ReviewInfo | null;
  /** What the diff overlay compares the live document against, if anything. */
  compare: Comparison | null;
  /** Other people on this diagram. */
  peers: PeerInfo[];
  /** Viewer role: the document cannot be edited from this tab. */
  readOnly: boolean;
  /** Accounts on: what this person may do here, and who they are. Solo mode: owner, nobody. */
  role: Role;
  me: PublicUser | null;
  /** Presentation mode: index of the frame being shown. */
  presenting: { frame: number } | null;
  chat: ChatState;

  panel: SidePanel | null;
  paletteOpen: boolean;
  dialog: DialogId | null;
  activeComment: Id | null;
  /** Position (and target) of a comment being written. */
  draftComment: { x: number; y: number; target?: Id } | null;

  /** Set by the sync client; receives every committed local patch. */
  emit: ((patch: Patch) => void) | null;

  /* ----------------------------------------------------------- actions */
  load(doc: DiagramDoc): void;
  set(partial: Partial<EditorState>): void;

  /** Applies a local edit: recorded in history and sent to the server. */
  apply(patch: Patch): void;
  /** Applies a change coming from the server (another tab or an agent). */
  applyRemote(patch: Patch, actor: Actor): void;
  beginGesture(): void;
  /** Applies an intermediate drag state: not recorded, not sent. */
  applyTransient(patch: Patch): void;
  endGesture(): void;
  cancelGesture(): void;
  undo(): void;
  redo(): void;

  select(ids: Id[], additive?: boolean): void;
  setTool(tool: Tool, shape?: string | null): void;
  setViewport(viewport: Viewport): void;
  zoomAt(screen: Point, factor: number): void;
  zoomTo(rect: Rect, padding?: number, maxZoom?: number): void;
  fit(): void;
  toWorld(screen: Point): Point;
  toScreen(world: Point): Point;
}

export type EditorStore = StoreApi<EditorState>;

function contentBounds(doc: DiagramDoc): Rect | null {
  return union(Object.values(doc.nodes).map(nodeBounds));
}

export function createEditorStore(diagramId: Id): EditorStore {
  return createStore<EditorState>((set, get) => {
    const pushUndo = (entry: HistoryEntry) => {
      const stack = [...get().undoStack, entry];
      if (stack.length > HISTORY_LIMIT) stack.shift();
      return stack;
    };

    /** Drops ids that no longer exist from selection-like state. */
    const prune = (doc: DiagramDoc, state: EditorState) => {
      const exists = (id: Id) => id in doc.nodes || id in doc.edges;
      const selection = state.selection.filter(exists);
      return {
        selection: selection.length === state.selection.length ? state.selection : selection,
        editing: state.editing && exists(state.editing) ? state.editing : null,
        hovered: state.hovered && exists(state.hovered) ? state.hovered : null,
        activeComment: state.activeComment && state.activeComment in doc.comments ? state.activeComment : null,
      };
    };

    return {
      diagramId,
      clientId: newClientId(),
      status: "loading",
      connection: "connecting",
      doc: null,
      selection: [],
      hovered: null,
      editing: null,
      tool: "select",
      toolShape: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      canvasSize: { w: 0, h: 0 },
      overlay: {},
      spaceHeld: false,
      undoStack: [],
      redoStack: [],
      gestureBase: null,
      agents: [],
      activity: [],
      reveal: {},
      agentCursor: null,
      highlight: null,
      tween: null,
      review: null,
      compare: null,
      peers: [],
      readOnly: false,
      role: "owner",
      me: null,
      presenting: null,
      chat: { messages: [], busy: false, error: null },
      panel: "design",
      paletteOpen: true,
      dialog: null,
      activeComment: null,
      draftComment: null,
      emit: null,

      load(doc) {
        const first = get().doc === null;
        set((state) => ({ doc, status: "ready", gestureBase: null, ...prune(doc, state), ...(first ? {} : { undoStack: [], redoStack: [] }) }));
        if (first) get().fit();
      },

      set(partial) {
        set(partial);
      },

      apply(patch) {
        const { doc, gestureBase, emit, readOnly, presenting } = get();
        // A slide show does not edit; agents' changes still arrive through `applyRemote`.
        if (!doc || readOnly || presenting) return;
        if (gestureBase) return get().applyTransient(patch);
        const complete = withIntegrity(doc, patch);
        const result = applyPatch(doc, complete);
        if (!result.changed) return;
        set((state) => ({
          doc: result.doc,
          undoStack: pushUndo({ inverse: result.inverse, actor: "you" }),
          redoStack: [],
          ...prune(result.doc, state),
        }));
        emit?.(complete);
      },

      applyRemote(patch, actor) {
        const { doc, gestureBase } = get();
        if (!doc) return;
        const result = applyPatch(doc, patch);
        if (!result.changed) return;
        // Keep an in-progress drag consistent: fold the remote change into its starting point too.
        const base = gestureBase ? applyPatch(gestureBase, patch).doc : null;
        set((state) => ({
          doc: result.doc,
          gestureBase: base,
          // Agent edits are undoable by the human; edits from the human's other tabs are not duplicated.
          undoStack: actor.kind === "agent" ? pushUndo({ inverse: result.inverse, actor: actor.name }) : state.undoStack,
          ...prune(result.doc, state),
        }));
      },

      beginGesture() {
        const { doc, gestureBase, readOnly } = get();
        if (doc && !gestureBase && !readOnly) set({ gestureBase: doc });
      },

      applyTransient(patch) {
        const { doc, readOnly } = get();
        if (!doc || readOnly) return;
        const result = applyPatch(doc, patch);
        if (result.changed) set({ doc: result.doc });
      },

      endGesture() {
        const { doc, gestureBase, emit } = get();
        if (!doc || !gestureBase) return set({ gestureBase: null, overlay: {} });
        const forward = diffDocs(gestureBase, doc);
        if (isEmptyPatch(forward)) return set({ gestureBase: null, overlay: {} });
        set({
          gestureBase: null,
          overlay: {},
          undoStack: pushUndo({ inverse: diffDocs(doc, gestureBase), actor: "you" }),
          redoStack: [],
        });
        emit?.(forward);
      },

      cancelGesture() {
        const { gestureBase } = get();
        if (gestureBase) set({ doc: gestureBase, gestureBase: null, overlay: {} });
        else set({ overlay: {} });
      },

      undo() {
        const { doc, undoStack, redoStack, emit, gestureBase, readOnly } = get();
        const entry = undoStack[undoStack.length - 1];
        if (!doc || !entry || gestureBase || readOnly) return;
        const result = applyPatch(doc, entry.inverse);
        set((state) => ({
          doc: result.doc,
          undoStack: undoStack.slice(0, -1),
          redoStack: [...redoStack, { inverse: result.inverse, actor: entry.actor }],
          ...prune(result.doc, state),
        }));
        if (result.changed) emit?.(entry.inverse);
      },

      redo() {
        const { doc, undoStack, redoStack, emit, gestureBase, readOnly } = get();
        const entry = redoStack[redoStack.length - 1];
        if (!doc || !entry || gestureBase || readOnly) return;
        const result = applyPatch(doc, entry.inverse);
        set((state) => ({
          doc: result.doc,
          redoStack: redoStack.slice(0, -1),
          undoStack: [...undoStack, { inverse: result.inverse, actor: entry.actor }],
          ...prune(result.doc, state),
        }));
        if (result.changed) emit?.(entry.inverse);
      },

      select(ids, additive = false) {
        const { selection } = get();
        if (!additive) return set({ selection: ids, activeComment: null });
        const next = new Set(selection);
        for (const id of ids) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        set({ selection: [...next] });
      },

      setTool(tool, shape = null) {
        // A viewer can look and point, never draw.
        if (get().readOnly && tool !== "select" && tool !== "pan") return;
        set({ tool, toolShape: tool === "shape" ? shape : null, overlay: {}, draftComment: null });
      },

      setViewport(viewport) {
        set({ viewport: { ...viewport, zoom: clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM) } });
      },

      zoomAt(screen, factor) {
        const { viewport } = get();
        const zoom = clamp(viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const k = zoom / viewport.zoom;
        // Keep the world point under the cursor fixed.
        set({ viewport: { zoom, x: screen.x - (screen.x - viewport.x) * k, y: screen.y - (screen.y - viewport.y) * k } });
      },

      zoomTo(rect, padding = 48, maxZoom = 1.25) {
        const { canvasSize, paletteOpen, panel } = get();
        if (!canvasSize.w || !canvasSize.h) return;
        // Frame the region inside the area not covered by panels (when the window is wide enough to have one).
        const left = paletteOpen && !get().readOnly ? CHROME.palette : 0;
        const right = panel ? CHROME.panel : 0;
        const roomy = canvasSize.w - left - right > 320;
        const area = {
          x: roomy ? left : 0,
          y: CHROME.top,
          w: roomy ? canvasSize.w - left - right : canvasSize.w,
          h: canvasSize.h - CHROME.top - CHROME.bottom,
        };
        const inset = Math.min(padding, area.w / 6, area.h / 6);
        const zoom = clamp(Math.min((area.w - inset * 2) / Math.max(rect.w, 1), (area.h - inset * 2) / Math.max(rect.h, 1)), MIN_ZOOM, maxZoom);
        set({
          viewport: {
            zoom,
            x: area.x + area.w / 2 - (rect.x + rect.w / 2) * zoom,
            y: area.y + area.h / 2 - (rect.y + rect.h / 2) * zoom,
          },
        });
      },

      fit() {
        const { doc, canvasSize } = get();
        if (!doc) return;
        const bounds = contentBounds(doc);
        if (bounds) get().zoomTo(bounds);
        else if (canvasSize.w) set({ viewport: { zoom: 1, x: canvasSize.w / 2, y: canvasSize.h / 2 } });
      },

      toWorld(screen) {
        const { viewport } = get();
        return { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom };
      },

      toScreen(world) {
        const { viewport } = get();
        return { x: world.x * viewport.zoom + viewport.x, y: world.y * viewport.zoom + viewport.y };
      },
    };
  });
}
