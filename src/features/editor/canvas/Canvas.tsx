"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

import { luminance } from "@/core/model/palette";
import type { DocSettings } from "@/core/model/types";
import { ContextArea } from "@/components/ui/menu";

import { createNode } from "../actions/elements";
import { SHAPE_DRAG_TYPE } from "../panels/ShapePalette";
import { useEditor, useEditorStore } from "../store/context";
import type { Viewport } from "../store/editor-store";
import { CanvasMenu } from "./CanvasMenu";
import { HtmlOverlay } from "./HtmlOverlay";
import { DiffOverlay } from "../review/DiffOverlay";
import { Overlay } from "./Overlay";
import { useInteractions } from "./use-interactions";
import { useDisplay, World } from "./World";

const CURSORS = { select: "default", pan: "grab", shape: "crosshair", connect: "crosshair", text: "text", comment: "crosshair" } as const;

/** Grid drawn with CSS gradients; the step doubles when zoomed out so it never turns to noise. */
function gridStyle(settings: DocSettings, viewport: Viewport, dark: boolean): Partial<CSSStyleDeclaration> {
  if (settings.grid === "none") return { backgroundImage: "none" };
  let step = settings.gridSize * viewport.zoom;
  while (step < 14) step *= 2;
  if (settings.grid === "lines") while (step < 28) step *= 2;
  const color = dark ? "rgb(255 255 255 / 0.13)" : "rgb(23 21 15 / 0.14)";
  const image =
    settings.grid === "dots"
      ? `radial-gradient(circle, ${color} 1px, transparent 1.4px)`
      : `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`;
  const offset = settings.grid === "dots" ? step / 2 : 0;
  return {
    backgroundImage: image,
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${viewport.x - offset}px ${viewport.y - offset}px`,
  };
}

/**
 * The drawing surface. Pan and zoom are applied by writing transforms straight
 * to the DOM from a store subscription, so moving around a large diagram never
 * re-renders React.
 */
export function Canvas() {
  const store = useEditorStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<SVGGElement>(null);
  const htmlRef = useRef<HTMLDivElement>(null);

  const settings = useEditor((state) => state.doc!.settings);
  const tool = useEditor((state) => state.tool);
  const spaceHeld = useEditor((state) => state.spaceHeld);
  const display = useDisplay();
  const handlers = useInteractions(rootRef);

  const darkPaper = luminance(settings.background) < 0.4;

  // Track the canvas size; the first measurement frames the diagram.
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => {
      const first = store.getState().canvasSize.w === 0;
      store.setState({ canvasSize: { w: element.clientWidth, h: element.clientHeight } });
      if (first) store.getState().fit();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);

  // Apply the viewport imperatively.
  useEffect(() => {
    const apply = (viewport: Viewport) => {
      const transform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`;
      worldRef.current?.setAttribute("transform", transform);
      overlayRef.current?.setAttribute("transform", transform);
      if (htmlRef.current) {
        htmlRef.current.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
        htmlRef.current.style.setProperty("--zoom", String(viewport.zoom));
      }
      if (gridRef.current) Object.assign(gridRef.current.style, gridStyle(settings, viewport, darkPaper));
    };
    apply(store.getState().viewport);
    return store.subscribe((state, previous) => {
      if (state.viewport !== previous.viewport) apply(state.viewport);
    });
  }, [store, settings, darkPaper]);

  return (
    <ContextArea menu={<CanvasMenu />}>
      <div
        ref={rootRef}
        className="canvas-root absolute inset-0 overflow-hidden"
        style={{ cursor: spaceHeld ? "grab" : CURSORS[tool] }}
        {...handlers}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(SHAPE_DRAG_TYPE)) event.preventDefault();
        }}
        onDrop={(event) => {
          const shapeId = event.dataTransfer.getData(SHAPE_DRAG_TYPE);
          if (!shapeId) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const state = store.getState();
          createNode(store, shapeId, { at: state.toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }) });
          state.setTool("select");
        }}
      >
        {/* The page: background, grid and the diagram. Flipped in dark mode when the page is light. */}
        <div className="canvas-paper absolute inset-0" data-invert={!darkPaper} style={{ background: settings.background }}>
          <div ref={gridRef} data-layer="grid" className="absolute inset-0" />
          <svg className="canvas-world absolute inset-0 h-full w-full" role="img" aria-label="Diagram canvas">
            <g ref={worldRef}>
              <World display={display} />
            </g>
          </svg>
        </div>

        <svg data-layer="overlay" className="pointer-events-none absolute inset-0 h-full w-full [&_[data-handle]]:pointer-events-auto [&_[data-port]]:pointer-events-auto">
          <g ref={overlayRef}>
            <DiffOverlay display={display} />
            <Overlay display={display} />
          </g>
        </svg>

        <div ref={htmlRef} data-layer="overlay" className="pointer-events-none absolute top-0 left-0 origin-top-left [&>*]:pointer-events-auto">
          <HtmlOverlay display={display} />
        </div>
      </div>
    </ContextArea>
  );
}
