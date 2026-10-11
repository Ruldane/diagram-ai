import { toast } from "sonner";

import type { EditorStore, Viewport } from "../store/editor-store";
import { blendViewport, clampSlide, easeInOut, slideForSelection, slidesOf } from "./slides";

/**
 * Presentation state that is not React's business: entering and leaving
 * (viewport restore, browser fullscreen) and the camera animation. Kept per
 * editor store, because routes are kept alive and several editors can exist.
 */

const ENTER_MS = 450;
const LEAVE_MS = 300;

interface Session {
  /** The viewport to return to when the presentation ends. */
  restore: Viewport | null;
  frame: number | null;
  /** We asked for fullscreen and have not been told to leave it: losing it means the person pressed Esc. */
  wantFullscreen: boolean;
}

const sessions = new WeakMap<EditorStore, Session>();

function session(store: EditorStore): Session {
  let current = sessions.get(store);
  if (!current) sessions.set(store, (current = { restore: null, frame: null, wantFullscreen: false }));
  return current;
}

export const prefersReducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ----------------------------------------------------------------- camera */

function cancelAnimation(current: Session): void {
  if (current.frame !== null) cancelAnimationFrame(current.frame);
  current.frame = null;
}

/** Moves the view to `target` over `duration` ms (immediately when motion is reduced or the duration is 0). */
export function animateViewport(store: EditorStore, target: Viewport, duration = ENTER_MS): void {
  const current = session(store);
  cancelAnimation(current);
  const { viewport: from, canvasSize, setViewport } = store.getState();
  if (duration <= 0 || prefersReducedMotion() || !canvasSize.w || !canvasSize.h) return setViewport(target);

  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    store.getState().setViewport(t >= 1 ? target : blendViewport(from, target, easeInOut(t), canvasSize));
    current.frame = t < 1 ? requestAnimationFrame(tick) : null;
  };
  current.frame = requestAnimationFrame(tick);
}

/* ------------------------------------------------------------ navigation */

/** Starts presenting. Without `frame` it begins at the selected frame, or the first slide. */
export function startPresentation(store: EditorStore, frame?: number): boolean {
  const state = store.getState();
  const { doc } = state;
  if (!doc || state.status !== "ready" || state.presenting) return false;
  const slides = slidesOf(doc);
  if (!slides.length) {
    toast("Nothing to present yet. Draw something, or add frames to make slides.");
    return false;
  }
  const index = clampSlide(frame ?? slideForSelection(doc, state.selection) ?? 0, slides.length);
  // Whatever the person was in the middle of must not carry over into the show.
  state.cancelGesture();
  state.setTool("select");
  store.setState({
    presenting: { frame: index },
    selection: [],
    hovered: null,
    editing: null,
    dialog: null,
    activeComment: null,
    draftComment: null,
    spaceHeld: false,
  });
  return true;
}

export function stopPresentation(store: EditorStore): void {
  if (store.getState().presenting) store.setState({ presenting: null });
}

export function goToSlide(store: EditorStore, index: number): void {
  const { presenting, doc } = store.getState();
  if (!presenting || !doc) return;
  const next = clampSlide(index, slidesOf(doc).length);
  if (next !== presenting.frame) store.setState({ presenting: { frame: next } });
}

/* ------------------------------------------------------------- fullscreen */

export function isFullscreen(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

export function setFullscreen(store: EditorStore, on: boolean): void {
  const current = session(store);
  if (typeof document === "undefined") return;
  if (on) {
    if (!document.fullscreenEnabled || document.fullscreenElement) return;
    current.wantFullscreen = true;
    // Refused outside a user gesture or by policy: the show simply runs in the window.
    document.documentElement.requestFullscreen().catch(() => {
      current.wantFullscreen = false;
    });
  } else {
    current.wantFullscreen = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }
}

export function toggleFullscreen(store: EditorStore): void {
  setFullscreen(store, !isFullscreen());
}

/* -------------------------------------------------------------- lifecycle */

/**
 * Watches `presenting` and does what entering and leaving need. Entering
 * remembers the viewport and asks for fullscreen (inside the click or key
 * press that started it, which browsers require). Leaving restores the
 * viewport and leaves fullscreen. The returned cleanup also ends a running
 * presentation, which is what happens when the route is hidden or unmounted.
 */
export function watchPresentation(store: EditorStore): () => void {
  const current = session(store);
  let active = false;

  const onFullscreenChange = () => {
    // Esc (or the browser's own control) left fullscreen: the show is over too.
    if (!document.fullscreenElement && current.wantFullscreen) stopPresentation(store);
  };

  const enter = () => {
    active = true;
    current.restore = store.getState().viewport;
    document.addEventListener("fullscreenchange", onFullscreenChange);
    setFullscreen(store, true);
  };

  const leave = () => {
    if (!active) return;
    active = false;
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    setFullscreen(store, false);
    const restore = current.restore;
    current.restore = null;
    cancelAnimation(current);
    if (restore) animateViewport(store, restore, LEAVE_MS);
  };

  if (store.getState().presenting) enter();
  const unsubscribe = store.subscribe((state, previous) => {
    const now = state.presenting !== null;
    if (now && previous.presenting === null) enter();
    else if (!now && previous.presenting !== null) leave();
  });

  return () => {
    unsubscribe();
    if (store.getState().presenting) store.setState({ presenting: null });
    leave();
    cancelAnimation(current);
  };
}
