import { describe, expect, it } from "vitest";

import type { DNode } from "@/core/model/types";

import { blendViewport, clampSlide, countFrames, easeInOut, fitSlide, indexOfSlide, selectedFrame, slideForSelection, slidesOf } from "./slides";

const node = (id: string, patch: Partial<DNode> = {}): DNode => ({ id, shape: "basic/rect", x: 0, y: 0, w: 100, h: 60, z: 1, ...patch });
const frame = (id: string, x: number, y: number, patch: Partial<DNode> = {}): DNode =>
  node(id, { shape: "basic/frame", x, y, w: 400, h: 300, z: -1, ...patch });

const nodesOf = (...list: DNode[]) => Object.fromEntries(list.map((n) => [n.id, n]));

describe("slidesOf", () => {
  it("uses top-level frames in reading order: rows top to bottom, each row left to right", () => {
    const nodes = nodesOf(
      frame("c", 500, 400, { text: "Third" }),
      frame("a", 0, 0, { text: "First\nsubtitle", note: "  say hello  " }),
      frame("b", 500, 20, { text: "Second" }),
      frame("nested", 10, 10, { parent: "a", text: "not a slide" }),
      node("plain", { x: 20, y: 20 }),
    );
    const slides = slidesOf({ nodes, name: "Deck" });
    expect(slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(slides.map((s) => s.title)).toEqual(["First", "Second", "Third"]);
    expect(slides[0].note).toBe("say hello");
    expect(slides[1].note).toBe("");
    expect(slides[0].bounds).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("names unlabelled frames by position", () => {
    const slides = slidesOf({ nodes: nodesOf(frame("a", 0, 0), frame("b", 600, 0, { text: "  " })), name: "Deck" });
    expect(slides.map((s) => s.title)).toEqual(["Slide 1", "Slide 2"]);
  });

  it("is one slide made of the whole diagram when there are no frames", () => {
    const nodes = nodesOf(node("a", { x: 0, y: 0 }), node("b", { x: 300, y: 200 }));
    expect(slidesOf({ nodes, name: "Flow" })).toEqual([{ id: null, title: "Flow", note: "", bounds: { x: 0, y: 0, w: 400, h: 260 } }]);
  });

  it("has no slides for an empty diagram", () => {
    expect(slidesOf({ nodes: {}, name: "Empty" })).toEqual([]);
  });
});

describe("slide lookup", () => {
  const nodes = nodesOf(
    frame("f1", 0, 0),
    frame("f2", 600, 0),
    node("in-f2", { parent: "f2", x: 650, y: 40 }),
    node("deep", { parent: "in-f2", x: 660, y: 50 }),
    node("floating", { x: 700, y: 100 }),
    node("outside", { x: 2000, y: 2000 }),
  );

  it("starts from the selected frame, or the frame that holds the selection", () => {
    expect(slideForSelection({ nodes }, ["f2"])).toBe(1);
    expect(slideForSelection({ nodes }, ["deep"])).toBe(1);
    // Not parented, but sitting on the frame.
    expect(slideForSelection({ nodes }, ["floating"])).toBe(1);
    expect(slideForSelection({ nodes }, ["outside"])).toBeUndefined();
    expect(slideForSelection({ nodes }, [])).toBeUndefined();
    expect(slideForSelection({ nodes: nodesOf(node("a")) }, ["a"])).toBeUndefined();
  });

  it("reports a frame only when exactly one top-level frame is selected", () => {
    expect(selectedFrame({ nodes }, ["f1"])).toBe(0);
    expect(selectedFrame({ nodes }, ["f2"])).toBe(1);
    expect(selectedFrame({ nodes }, ["f1", "f2"])).toBeUndefined();
    expect(selectedFrame({ nodes }, ["in-f2"])).toBeUndefined();
  });

  it("finds a slide again by id after the list changed", () => {
    const slides = slidesOf({ nodes, name: "x" });
    expect(indexOfSlide(slides, "f2")).toBe(1);
    expect(indexOfSlide(slides, "gone")).toBe(-1);
    expect(indexOfSlide([{ id: null, title: "", note: "", bounds: { x: 0, y: 0, w: 1, h: 1 } }], null)).toBe(0);
  });

  it("counts frames once per nodes object", () => {
    expect(countFrames(nodes)).toBe(2);
    expect(countFrames(nodes)).toBe(2);
    expect(countFrames(nodesOf(node("a")))).toBe(0);
  });

  it("clamps indexes", () => {
    expect(clampSlide(-3, 5)).toBe(0);
    expect(clampSlide(9, 5)).toBe(4);
    expect(clampSlide(2.4, 5)).toBe(2);
    expect(clampSlide(3, 0)).toBe(0);
  });
});

describe("fitSlide", () => {
  const window = { w: 1600, h: 900 };

  it("centres the slide in the whole window with padding on every side", () => {
    const rect = { x: 100, y: 50, w: 800, h: 450 };
    const view = fitSlide(rect, window);
    const centre = { x: (rect.x + rect.w / 2) * view.zoom + view.x, y: (rect.y + rect.h / 2) * view.zoom + view.y };
    expect(centre.x).toBeCloseTo(800);
    expect(centre.y).toBeCloseTo(450);
    // 16:9 into 16:9: limited by height, with 6% of the shorter side as padding.
    expect(view.zoom).toBeCloseTo((900 - 2 * 54) / 450);
    expect(rect.w * view.zoom).toBeLessThan(window.w);
  });

  it("keeps clear of the notes strip", () => {
    const rect = { x: 0, y: 0, w: 400, h: 300 };
    const free = fitSlide(rect, window);
    const withNotes = fitSlide(rect, window, { inset: { bottom: 128 } });
    expect(withNotes.zoom).toBeLessThan(free.zoom);
    // The slide's bottom edge ends above the strip.
    expect(withNotes.y + rect.h * withNotes.zoom).toBeLessThanOrEqual(900 - 128);
  });

  it("does not blow up small frames and does not collapse huge ones", () => {
    expect(fitSlide({ x: 0, y: 0, w: 10, h: 10 }, window).zoom).toBe(3);
    expect(fitSlide({ x: 0, y: 0, w: 0, h: 0 }, window).zoom).toBe(3);
    const huge = fitSlide({ x: 0, y: 0, w: 1_000_000, h: 1_000_000 }, window);
    expect(huge.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(huge.x)).toBe(true);
  });

  it("uses the padding it is given", () => {
    const rect = { x: 0, y: 0, w: 1000, h: 1000 };
    expect(fitSlide(rect, window, { padding: 0 }).zoom).toBeCloseTo(0.9);
    expect(fitSlide(rect, window, { padding: 100 }).zoom).toBeCloseTo(0.7);
  });
});

describe("blendViewport", () => {
  const window = { w: 1000, h: 600 };
  const from = { x: 0, y: 0, zoom: 1 };
  const to = { x: -2000, y: -900, zoom: 0.25 };

  it("starts and ends exactly on the two viewports", () => {
    expect(blendViewport(from, to, 0, window)).toEqual(from);
    expect(blendViewport(from, to, 1, window)).toEqual(to);
  });

  it("changes the zoom by a constant factor and moves the middle of the window in a straight line", () => {
    const mid = blendViewport(from, to, 0.5, window);
    expect(mid.zoom).toBeCloseTo(0.5);
    const centre = (v: typeof from) => ({ x: (500 - v.x) / v.zoom, y: (300 - v.y) / v.zoom });
    const a = centre(from);
    const b = centre(to);
    const m = centre(mid);
    expect(m.x).toBeCloseTo((a.x + b.x) / 2);
    expect(m.y).toBeCloseTo((a.y + b.y) / 2);
  });

  it("eases in and out", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});
