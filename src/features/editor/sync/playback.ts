import { center } from "@/core/geometry/basics";
import { nodeBounds } from "@/core/model/queries";
import type { Actor, DiagramDoc, DNode, Id, Patch, Rect } from "@/core/model/types";
import type { PatchAnimation } from "@/core/protocol";

import { CHROME, type EditorStore } from "../store/editor-store";

/**
 * Presents a remote change as visible "work": new elements draw in one after
 * another with the agent's cursor hopping between them, and moved nodes glide
 * to their new positions. The document itself is already up to date — this
 * only choreographs how the change is shown.
 */

const STEP_MS = 95;
const MAX_DRAW_MS = 2600;
const TWEEN_MS = 520;
const CURSOR_LINGER_MS = 1400;

const timers = new WeakMap<EditorStore, { cursor: number[]; clear?: number; frame?: number }>();

function state(store: EditorStore) {
  let entry = timers.get(store);
  if (!entry) timers.set(store, (entry = { cursor: [] }));
  return entry;
}

export function stopPlayback(store: EditorStore): void {
  const entry = state(store);
  entry.cursor.forEach(window.clearTimeout);
  entry.cursor = [];
  window.clearTimeout(entry.clear);
  if (entry.frame) cancelAnimationFrame(entry.frame);
  store.setState({ reveal: {}, tween: null, agentCursor: null });
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Glides nodes from where they were to where the patch put them. */
function tweenNodes(store: EditorStore, before: DiagramDoc, after: DiagramDoc, ids: Id[]) {
  const moves = ids
    .map((id) => ({ id, from: before.nodes[id], to: after.nodes[id] }))
    .filter((m) => m.from && m.to && (m.from.x !== m.to.x || m.from.y !== m.to.y || m.from.w !== m.to.w || m.from.h !== m.to.h));
  if (!moves.length) return;
  const entry = state(store);
  if (entry.frame) cancelAnimationFrame(entry.frame);
  const start = performance.now();

  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / TWEEN_MS);
    if (t >= 1) {
      entry.frame = undefined;
      store.setState({ tween: null });
      return;
    }
    const k = easeInOut(t);
    const tween: Record<Id, Rect> = {};
    for (const { id, from, to } of moves) {
      tween[id] = {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        w: from.w + (to.w - from.w) * k,
        h: from.h + (to.h - from.h) * k,
      };
    }
    store.setState({ tween });
    entry.frame = requestAnimationFrame(tick);
  };
  entry.frame = requestAnimationFrame(tick);
}

/**
 * Keeps the agent's work in view: when it draws outside the visible area the
 * whole diagram is re-framed. Left alone while the person is busy (dragging,
 * typing a label or a comment) so the canvas never jumps under their hands.
 */
function followAgent(store: EditorStore, added: DNode[]) {
  const state = store.getState();
  if (!added.length || state.gestureBase || state.editing || state.draftComment) return;
  const { viewport, canvasSize } = state;
  // The part of the canvas not covered by the side panels, in world coordinates.
  const left = state.paletteOpen ? CHROME.palette : 0;
  const right = state.panel ? CHROME.panel : 0;
  const view = {
    x: (left - viewport.x) / viewport.zoom,
    y: (CHROME.top - viewport.y) / viewport.zoom,
    w: (canvasSize.w - left - right) / viewport.zoom,
    h: (canvasSize.h - CHROME.top - CHROME.bottom) / viewport.zoom,
  };
  const hidden = added.some((node) => {
    const box = nodeBounds(node);
    return box.x < view.x || box.y < view.y || box.x + box.w > view.x + view.w || box.y + box.h > view.y + view.h;
  });
  if (hidden) state.fit();
}

/**
 * Call right after a remote patch has been applied to the store.
 * `before` is the document as it was before the patch.
 */
export function playRemotePatch(store: EditorStore, before: DiagramDoc, patch: Patch, actor: Actor, animate: PatchAnimation): void {
  const after = store.getState().doc;
  if (!after || animate === "none" || reducedMotion()) return;

  const setNodes = patch.nodes?.set ?? [];
  const newNodes = setNodes.filter((n) => !before.nodes[n.id] && after.nodes[n.id]);
  const movedIds = setNodes.filter((n) => before.nodes[n.id]).map((n) => n.id);
  const newEdges = (patch.edges?.set ?? []).filter((e) => !before.edges[e.id] && after.edges[e.id]);

  tweenNodes(store, before, after, movedIds);
  if (animate !== "draw" || (!newNodes.length && !newEdges.length)) return;
  followAgent(store, newNodes);

  const entry = state(store);
  entry.cursor.forEach(window.clearTimeout);
  entry.cursor = [];
  window.clearTimeout(entry.clear);

  // Containers first, then nodes in reading order, so the drawing feels deliberate.
  const ordered = [...newNodes].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const step = Math.min(STEP_MS, MAX_DRAW_MS / Math.max(1, ordered.length));
  const reveal: Record<Id, number> = { ...store.getState().reveal };
  ordered.forEach((node, index) => {
    reveal[node.id] = index * step;
  });
  const nodesDone = ordered.length * step;
  newEdges.forEach((edge, index) => {
    const ends = [edge.from.node, edge.to.node].map((id) => (id && reveal[id] !== undefined ? reveal[id] : 0));
    // A connector appears just after both of its ends; purely new connectors trail the nodes.
    reveal[edge.id] = ordered.length ? Math.max(...ends) + step * 0.8 : index * step * 0.6;
  });
  store.setState({ reveal });

  // Move the agent's cursor to each node as it appears.
  const stride = Math.max(1, Math.ceil(ordered.length / 24));
  ordered.forEach((node, index) => {
    if (index % stride !== 0 && index !== ordered.length - 1) return;
    entry.cursor.push(
      window.setTimeout(() => {
        const c = center(node);
        store.setState({ agentCursor: { actor, x: c.x + node.w * 0.28, y: c.y + node.h * 0.3 } });
      }, index * step),
    );
  });

  const total = Math.max(nodesDone, ...Object.values(reveal)) + 500;
  entry.clear = window.setTimeout(() => {
    const current = store.getState().reveal;
    const remaining: Record<Id, number> = {};
    // Keep entries added by a newer patch that is still playing.
    for (const [id, delay] of Object.entries(current)) if (!(id in reveal) || reveal[id] !== delay) remaining[id] = delay;
    store.setState({ reveal: remaining });
    entry.cursor.push(window.setTimeout(() => store.setState({ agentCursor: null }), CURSOR_LINGER_MS));
  }, total);
}
