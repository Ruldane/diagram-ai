"use client";

import { useEffect, useRef } from "react";

import { union } from "@/core/geometry/basics";
import { nodeBounds } from "@/core/model/queries";
import type { DNode, Id, Rect } from "@/core/model/types";

import { useEditorStore } from "../store/context";
import type { EditorState } from "../store/editor-store";

const THICKNESS = 9;
const MIN_THUMB = 36;
/** How far the view can travel past the content, as a fraction of the view size. */
const SLACK = 0.5;

/**
 * Scrollable extent in world units: the content padded by half a view on every
 * side, always including the current view so the thumb never leaves the track.
 */
export function scrollRange(content: Rect | null, view: Rect): Rect {
  const base = content
    ? { x: content.x - view.w * SLACK, y: content.y - view.h * SLACK, w: content.w + view.w * 2 * SLACK, h: content.h + view.h * 2 * SLACK }
    : view;
  const left = Math.min(base.x, view.x);
  const top = Math.min(base.y, view.y);
  return { x: left, y: top, w: Math.max(base.x + base.w, view.x + view.w) - left, h: Math.max(base.y + base.h, view.y + view.h) - top };
}

type Axis = "x" | "y";

interface Geometry {
  /** Track length in px. */
  track: number;
  thumbSize: number;
  thumbStart: number;
  /** World units per px of thumb travel. */
  worldPerPx: number;
  range: Rect;
  view: Rect;
}

function geometry(axis: Axis, state: EditorState, content: Rect | null, track: number, frozen?: Rect): Geometry | null {
  const { viewport, canvasSize } = state;
  if (!canvasSize.w || !canvasSize.h || track <= 0) return null;
  const view: Rect = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, w: canvasSize.w / viewport.zoom, h: canvasSize.h / viewport.zoom };
  const range = frozen ?? scrollRange(content, view);
  const [from, size, viewFrom, viewSize] = axis === "x" ? [range.x, range.w, view.x, view.w] : [range.y, range.h, view.y, view.h];
  const thumbSize = Math.min(track, Math.max(MIN_THUMB, (viewSize / size) * track));
  const free = Math.max(1, track - thumbSize);
  const t = Math.min(1, Math.max(0, (viewFrom - from) / Math.max(1, size - viewSize)));
  // Travel of the thumb maps onto the part of the range the view can occupy.
  return { track, thumbSize, thumbStart: t * free, worldPerPx: Math.max(1, size - viewSize) / free, range, view };
}

/**
 * Visible scrollbars for the infinite canvas. They sit in the gutter around the
 * floating panels and are driven imperatively from the store, so panning never
 * re-renders React.
 */
export function Scrollbars() {
  const store = useEditorStore();
  const trackX = useRef<HTMLDivElement>(null);
  const trackY = useRef<HTMLDivElement>(null);
  const thumbX = useRef<HTMLDivElement>(null);
  const thumbY = useRef<HTMLDivElement>(null);
  const contentCache = useRef<{ nodes: Record<Id, DNode> | null; bounds: Rect | null }>({ nodes: null, bounds: null });
  /** Range frozen at the start of a thumb drag, so the thumb does not chase its own movement. */
  const frozen = useRef<Partial<Record<Axis, Rect>>>({});

  useEffect(() => {
    const contentBounds = (): Rect | null => {
      const nodes = store.getState().doc?.nodes ?? null;
      if (contentCache.current.nodes !== nodes) {
        contentCache.current = { nodes, bounds: nodes ? union(Object.values(nodes).map(nodeBounds)) : null };
      }
      return contentCache.current.bounds;
    };

    const paint = () => {
      const state = store.getState();
      if (state.status !== "ready") return;
      const content = contentBounds();
      for (const axis of ["x", "y"] as const) {
        const track = axis === "x" ? trackX.current : trackY.current;
        const thumb = axis === "x" ? thumbX.current : thumbY.current;
        if (!track || !thumb) continue;
        const length = axis === "x" ? track.clientWidth : track.clientHeight;
        const g = geometry(axis, state, content, length, frozen.current[axis]);
        if (!g) continue;
        if (axis === "x") {
          thumb.style.width = `${g.thumbSize}px`;
          thumb.style.transform = `translateX(${g.thumbStart}px)`;
        } else {
          thumb.style.height = `${g.thumbSize}px`;
          thumb.style.transform = `translateY(${g.thumbStart}px)`;
        }
      }
    };

    paint();
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.viewport !== previous.viewport || state.canvasSize !== previous.canvasSize || state.doc?.nodes !== previous.doc?.nodes || state.status !== previous.status) paint();
    });
    const observer = new ResizeObserver(paint);
    if (trackX.current) observer.observe(trackX.current);
    if (trackY.current) observer.observe(trackY.current);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [store]);

  /** Current geometry for an axis, computed on demand by the pointer handlers. */
  const read = (axis: Axis): Geometry | null => {
    const track = axis === "x" ? trackX.current : trackY.current;
    if (!track) return null;
    const nodes = store.getState().doc?.nodes;
    const content = nodes ? union(Object.values(nodes).map(nodeBounds)) : null;
    return geometry(axis, store.getState(), content, axis === "x" ? track.clientWidth : track.clientHeight, frozen.current[axis]);
  };

  const dragThumb = (axis: Axis, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const g = read(axis);
    if (!g) return;
    frozen.current[axis] = g.range;
    const start = axis === "x" ? event.clientX : event.clientY;
    const origin = store.getState().viewport;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => {
      const delta = ((axis === "x" ? e.clientX : e.clientY) - start) * g.worldPerPx;
      const { viewport } = store.getState();
      store.getState().setViewport(
        axis === "x" ? { ...viewport, x: origin.x - delta * origin.zoom, zoom: viewport.zoom } : { ...viewport, y: origin.y - delta * origin.zoom, zoom: viewport.zoom },
      );
    };
    const end = () => {
      frozen.current[axis] = undefined;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  /** Clicking the empty track pages towards the click, like a native scrollbar. */
  const page = (axis: Axis, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const g = read(axis);
    if (!g) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = axis === "x" ? event.clientX - rect.left : event.clientY - rect.top;
    const direction = at < g.thumbStart ? -1 : 1;
    const { viewport, canvasSize } = store.getState();
    const step = (axis === "x" ? canvasSize.w : canvasSize.h) * 0.9;
    store.getState().setViewport(axis === "x" ? { ...viewport, x: viewport.x - direction * step } : { ...viewport, y: viewport.y - direction * step });
  };

  const common = "absolute z-[15] rounded-full bg-ink/[0.07] transition-colors hover:bg-ink/[0.12]";
  const thumb = "absolute rounded-full bg-ink/30 transition-colors hover:bg-ink/55 active:bg-ink/65";

  return (
    <>
      <div
        ref={trackX}
        data-canvas-ui
        aria-hidden
        data-scrollbar="horizontal"
        className={common}
        style={{ left: 12, right: THICKNESS + 12, bottom: 2, height: THICKNESS }}
        onPointerDown={(event) => page("x", event)}
      >
        <div ref={thumbX} className={thumb} style={{ top: 0, left: 0, height: THICKNESS, width: 80, cursor: "grab" }} onPointerDown={(event) => dragThumb("x", event)} />
      </div>
      <div
        ref={trackY}
        data-canvas-ui
        aria-hidden
        data-scrollbar="vertical"
        className={common}
        style={{ right: 2, top: 64, bottom: THICKNESS + 12, width: THICKNESS }}
        onPointerDown={(event) => page("y", event)}
      >
        <div ref={thumbY} className={thumb} style={{ left: 0, top: 0, width: THICKNESS, height: 80, cursor: "grab" }} onPointerDown={(event) => dragThumb("y", event)} />
      </div>
    </>
  );
}
