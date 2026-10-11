"use client";

import { ChevronLeft, ChevronRight, Contrast, Maximize, Minimize, StickyNote, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { luminance } from "@/core/model/palette";
import type { Id } from "@/core/model/types";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

import { useDoc, useEditor, useEditorStore } from "../store/context";
import type { Viewport } from "../store/editor-store";
import { animateViewport, goToSlide, isFullscreen, stopPresentation, toggleFullscreen, watchPresentation } from "./session";
import { clampSlide, fitSlide, indexOfSlide, slidesOf, type Slide } from "./slides";

/** How long the controls stay after the pointer stops moving. */
const IDLE_MS = 2000;
/** Height of the speaker-notes strip; the slide is framed above it. */
const NOTES_HEIGHT = 128;
/** Opacity of everything outside the current frame, as the veil's complement. */
const DIM = 0.88;
/** Drag distance that counts as a swipe rather than a tap. */
const SWIPE_PX = 48;

/**
 * Presentation mode. The editor chrome is hidden by the shell while
 * `presenting` is set; this component owns what takes its place: the camera,
 * the keyboard, the click zones and a small overlay that hides itself.
 */
export function PresentMode() {
  const store = useEditorStore();
  // Entering and leaving (fullscreen, viewport restore) are driven by the store, so they also run
  // when something other than the keyboard starts or ends the show; the cleanup ends it on unmount.
  useEffect(() => watchPresentation(store), [store]);
  const active = useEditor((state) => state.presenting !== null);
  return active ? <Presenter /> : null;
}

/* ----------------------------------------------------------------- veil */

/**
 * Dims everything outside the slide: a page-coloured sheet with a hole where
 * the frame is, laid over the canvas. Looks the same as lowering the opacity
 * of the other elements, and follows the camera without touching them.
 */
function Veil({ slide }: { slide: Slide }) {
  const store = useEditorStore();
  const background = useEditor((state) => state.doc!.settings.background);
  const ref = useRef<HTMLDivElement>(null);
  const { x, y, w, h } = slide.bounds;

  useEffect(() => {
    const place = () => {
      const element = ref.current;
      if (!element) return;
      const { viewport, canvasSize } = store.getState();
      const left = viewport.x + x * viewport.zoom;
      const top = viewport.y + y * viewport.zoom;
      const right = left + w * viewport.zoom;
      const bottom = top + h * viewport.zoom;
      element.style.clipPath = `path(evenodd, "M0 0H${canvasSize.w}V${canvasSize.h}H0Z M${left} ${top}H${right}V${bottom}H${left}Z")`;
    };
    place();
    return store.subscribe((state, previous) => {
      if (state.viewport !== previous.viewport || state.canvasSize !== previous.canvasSize) place();
    });
  }, [store, x, y, w, h]);

  // The same treatment as the canvas paper, so the veil is the page's colour in dark mode too.
  return (
    <div
      ref={ref}
      aria-hidden
      className="canvas-paper pointer-events-none absolute inset-0 z-30"
      data-invert={luminance(background) >= 0.4}
      style={{ background, opacity: DIM }}
    />
  );
}

/* ------------------------------------------------------------ presenter */

function Presenter() {
  const store = useEditorStore();
  const doc = useDoc();
  const frame = useEditor((state) => state.presenting?.frame ?? 0);
  const canvasSize = useEditor((state) => state.canvasSize);

  const slides = useMemo(() => slidesOf({ nodes: doc.nodes, name: doc.name }), [doc.nodes, doc.name]);
  const index = clampSlide(frame, slides.length);
  const slide: Slide | undefined = slides[index];

  const [visible, setVisible] = useState(true);
  const [notes, setNotes] = useState(false);
  const [dim, setDim] = useState(true);
  const [laser, setLaser] = useState(false);
  const [fullscreen, setFullscreenState] = useState(isFullscreen);

  /* Which frame is on screen is remembered by id, so slides added or reordered by an agent do not change it. */
  const anchor = useRef<Id | null | undefined>(undefined);
  useEffect(() => {
    if (anchor.current !== undefined) {
      const at = indexOfSlide(slides, anchor.current);
      if (at >= 0 && at !== index) return goToSlide(store, at);
    }
    anchor.current = slides[index]?.id;
  }, [slides, index, store]);

  const navigate = (to: number) => {
    const next = clampSlide(to, slides.length);
    anchor.current = slides[next]?.id;
    goToSlide(store, next);
  };
  // The key handler is registered once; it reads the latest navigation through this ref.
  const latest = useRef({ navigate, index, count: slides.length });
  useEffect(() => {
    latest.current = { navigate, index, count: slides.length };
  });

  /* Camera: frame the slide in the whole window. */
  const present = slide !== undefined;
  const { x: sx = 0, y: sy = 0, w: sw = 0, h: sh = 0 } = slide?.bounds ?? {};
  const { w: cw, h: ch } = canvasSize;
  const framed = useRef<{ key: string; size: string } | null>(null);
  useEffect(() => {
    if (!present || !cw || !ch) return;
    const target: Viewport = fitSlide({ x: sx, y: sy, w: sw, h: sh }, { w: cw, h: ch }, { inset: { bottom: notes ? NOTES_HEIGHT : 0 } });
    const key = `${index}:${sx}:${sy}:${sw}:${sh}:${notes}`;
    const size = `${cw}x${ch}`;
    // A resize (entering fullscreen) re-frames at once; moving between slides glides.
    const resizeOnly = framed.current?.key === key && framed.current.size !== size;
    framed.current = { key, size };
    animateViewport(store, target, resizeOnly ? 0 : undefined);
  }, [store, present, index, sx, sy, sw, sh, cw, ch, notes]);

  /* Controls fade out when the pointer rests. */
  const idle = useRef<number | undefined>(undefined);
  const wake = () => {
    setVisible(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setVisible(false), IDLE_MS);
  };
  useEffect(() => {
    idle.current = window.setTimeout(() => setVisible(false), IDLE_MS);
    return () => window.clearTimeout(idle.current);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreenState(isFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* Keyboard. Captured on the window, so none of the editor's shortcuts see a key while presenting. */
  useEffect(() => {
    // A control focused by an earlier click would also react to Space and Enter.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      const { navigate: go, index: at, count } = latest.current;
      if (event.ctrlKey || event.metaKey || event.altKey) {
        // The shortcut that started the show also ends it; other browser shortcuts keep working.
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === "KeyP") {
          event.preventDefault();
          stopPresentation(store);
        }
        return;
      }
      const handled = (action: () => void) => {
        event.preventDefault();
        action();
      };
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          return handled(() => go(at + 1));
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          return handled(() => go(at - 1));
        case "Home":
          return handled(() => go(0));
        case "End":
          return handled(() => go(count - 1));
        case "Escape":
          return handled(() => stopPresentation(store));
        case "n":
        case "N":
          return handled(() => setNotes((value) => !value));
        case "d":
        case "D":
          return handled(() => setDim((value) => !value));
        case "f":
        case "F":
          return handled(() => toggleFullscreen(store));
        case "l":
        case "L":
          return handled(() => setLaser(true));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "l" || event.key === "L") setLaser(false);
    };
    const onBlur = () => setLaser(false);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [store]);

  /* Pointer: thirds of the window go back and forward, a swipe does the same. */
  const dot = useRef<HTMLDivElement>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = (event: ReactPointerEvent) => {
    wake();
    if (dot.current) dot.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    down.current = { x: event.clientX, y: event.clientY };
    if (dot.current) dot.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = down.current;
    down.current = null;
    if (!start || event.button !== 0) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) return navigate(index + (dx < 0 ? 1 : -1));
    if (Math.hypot(dx, dy) > 10) return;
    const third = window.innerWidth / 3;
    if (event.clientX < third) navigate(index - 1);
    else if (event.clientX > third * 2) navigate(index + 1);
    else wake();
  };

  const hidden = !visible && !laser;
  const bottom = notes ? NOTES_HEIGHT : 0;

  return (
    <>
      {/* The editor's own layers that must not show to an audience. */}
      <style>{`
        [data-layer="overlay"], [data-layer="grid"], [data-sonner-toaster] { display: none !important; }
      `}</style>

      {dim && slide?.id ? <Veil slide={slide} /> : null}

      <div
        className={cn("absolute inset-0 z-40 touch-none select-none", hidden || laser ? "cursor-none" : "cursor-default")}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />

      {laser ? (
        <div ref={dot} aria-hidden className="pointer-events-none absolute top-0 left-0 z-[60]">
          <span className="absolute -top-2 -left-2 size-4 rounded-full bg-[#ff2d2d] shadow-[0_0_0_6px_rgba(255,45,45,0.28),0_0_18px_6px_rgba(255,45,45,0.55)]" />
        </div>
      ) : null}

      {/* Controls. Mouse-down never moves focus here, so Space and Enter keep navigating. */}
      <div
        role="region"
        aria-label="Presentation controls"
        aria-hidden={hidden}
        onMouseDown={(event) => event.preventDefault()}
        onPointerMove={wake}
        className={cn("pointer-events-none absolute inset-0 z-50 transition-opacity duration-200", hidden ? "opacity-0" : "opacity-100")}
      >
        <p className="sr-only" aria-live="polite">
          {slide ? `Slide ${index + 1} of ${slides.length}: ${slide.title}` : "Nothing to present"}
        </p>

        {slide ? (
          <div className="absolute top-4 left-4 max-w-[min(60vw,640px)] rounded-xl bg-ink/85 px-3.5 py-2 text-[14px] font-medium text-bg shadow-[var(--shadow-lg)] backdrop-blur">
            <span className="block truncate">{slide.title}</span>
          </div>
        ) : null}

        <div className={cn("pointer-events-auto absolute top-4 right-4 flex items-center gap-1 rounded-xl bg-ink/85 p-1 text-bg shadow-[var(--shadow-lg)] backdrop-blur", hidden && "pointer-events-none")}>
          <OverlayButton
            label={notes ? "Hide notes" : "Show notes"}
            shortcut="N"
            active={notes}
            side="bottom"
            onClick={() => setNotes((value) => !value)}
          >
            <StickyNote className="size-4" />
          </OverlayButton>
          <OverlayButton
            label={dim ? "Show everything" : "Dim the rest"}
            shortcut="D"
            active={dim}
            side="bottom"
            onClick={() => setDim((value) => !value)}
          >
            <Contrast className="size-4" />
          </OverlayButton>
          <OverlayButton
            label={fullscreen ? "Leave full screen" : "Full screen"}
            shortcut="F"
            side="bottom"
            onClick={() => toggleFullscreen(store)}
          >
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </OverlayButton>
          <OverlayButton label="End presentation" shortcut="Esc" side="bottom" onClick={() => stopPresentation(store)}>
            <X className="size-4" />
          </OverlayButton>
        </div>

        <div className="absolute inset-x-0 flex flex-col items-center gap-2.5" style={{ bottom: bottom + 16 }}>
          <div className={cn("pointer-events-auto flex items-center gap-1 rounded-xl bg-ink/85 p-1 text-bg shadow-[var(--shadow-lg)] backdrop-blur", hidden && "pointer-events-none")}>
            <OverlayButton
              label="Previous slide"
              shortcut="←"
              side="top"
              disabled={index <= 0}
              onClick={() => navigate(index - 1)}
             
            >
              <ChevronLeft className="size-4" />
            </OverlayButton>
            <span className="min-w-[64px] px-1 text-center font-mono text-[12.5px] tabular-nums">
              {slides.length ? `${index + 1} / ${slides.length}` : "0 / 0"}
            </span>
            <OverlayButton
              label="Next slide"
              shortcut="→"
              side="top"
              disabled={index >= slides.length - 1}
              onClick={() => navigate(index + 1)}
             
            >
              <ChevronRight className="size-4" />
            </OverlayButton>
          </div>
          <Progress count={slides.length} index={index} onGo={navigate} interactive={!hidden} />
        </div>
      </div>

      {notes ? (
        <section
          aria-label="Speaker notes"
          className="absolute inset-x-0 bottom-0 z-50 overflow-y-auto border-t border-white/10 bg-ink/92 px-8 py-4 text-bg backdrop-blur"
          style={{ height: NOTES_HEIGHT }}
        >
          {slide?.note ? (
            <p className="mx-auto max-w-3xl text-[16px] leading-relaxed whitespace-pre-wrap">{slide.note}</p>
          ) : (
            <p className="mx-auto max-w-3xl text-[14px] text-bg/60">No notes for this slide. Add one in the frame&rsquo;s note field.</p>
          )}
        </section>
      ) : null}
    </>
  );
}

/** Icon button for the dark overlay pills. Written out rather than reusing `IconButton`, whose colours it would have to fight. */
function OverlayButton({
  label,
  shortcut,
  active,
  disabled,
  side,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  side?: "top" | "bottom";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tip label={label} shortcut={shortcut} side={side}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-35",
          active ? "bg-accent text-accent-ink" : "text-bg hover:bg-bg/15",
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

/** Dots for a short deck, a bar for a long one. */
function Progress({ count, index, onGo, interactive }: { count: number; index: number; onGo: (index: number) => void; interactive: boolean }) {
  if (count <= 1) return null;
  if (count > 14) {
    return (
      <div className="h-1 w-56 overflow-hidden rounded-full bg-ink/40" role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1}>
        <div className="h-full rounded-full bg-bg transition-[width] duration-300" style={{ width: `${((index + 1) / count) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-1.5", interactive ? "pointer-events-auto" : "pointer-events-none")}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Go to slide ${i + 1}`}
          aria-current={i === index}
          onClick={() => onGo(i)}
          className={cn("size-2 rounded-full transition-all", i === index ? "scale-125 bg-bg" : "bg-bg/40 hover:bg-bg/70")}
        />
      ))}
    </div>
  );
}
