import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "@/core/model/defaults";
import type { DiagramDoc, DNode } from "@/core/model/types";

import type { EditorStore } from "../store/editor-store";
import { startFromUrl } from "./session";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const node = (id: string, patch: Partial<DNode> = {}): DNode => ({ id, shape: "basic/rect", x: 0, y: 0, w: 100, h: 60, z: 1, ...patch });

function docWith(...nodes: DNode[]): DiagramDoc {
  const doc = createDoc({ id: "d", name: "Deck" }, new Date(0));
  return { ...doc, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) };
}

/** Just enough of the editor store for `startPresentation`. */
function fakeStore(doc: DiagramDoc) {
  const state: Record<string, unknown> = {
    doc,
    status: "ready",
    presenting: null,
    selection: [],
    cancelGesture: () => undefined,
    setTool: () => undefined,
  };
  const store = {
    getState: () => state,
    setState: (partial: Record<string, unknown>) => Object.assign(state, partial),
  };
  return { store: store as unknown as EditorStore, state };
}

function at(search: string): void {
  vi.stubGlobal("window", { location: { search, href: `http://localhost/d/x${search}` } });
}

afterEach(() => vi.unstubAllGlobals());

describe("startFromUrl", () => {
  const frames = docWith(
    node("a", { shape: "basic/frame", x: 0, y: 0, w: 400, h: 300, z: -1, text: "One" }),
    node("b", { shape: "basic/frame", x: 600, y: 0, w: 400, h: 300, z: -1, text: "Two" }),
  );

  it("starts on the first slide for ?present=1", () => {
    at("?present=1");
    const { store, state } = fakeStore(frames);
    expect(startFromUrl(store)).toBe(true);
    expect(state.presenting).toEqual({ frame: 0 });
  });

  it("takes a 1-based slide number", () => {
    at("?present=1&slide=2");
    const { store, state } = fakeStore(frames);
    expect(startFromUrl(store)).toBe(true);
    expect(state.presenting).toEqual({ frame: 1 });
  });

  it("does nothing without the parameter, or when it says no", () => {
    for (const search of ["", "?other=1", "?present=0", "?present=false"]) {
      at(search);
      const { store, state } = fakeStore(frames);
      expect(startFromUrl(store)).toBe(false);
      expect(state.presenting).toBeNull();
    }
  });

  it("does not start an empty diagram", () => {
    at("?present=1");
    const { store, state } = fakeStore(docWith());
    expect(startFromUrl(store)).toBe(false);
    expect(state.presenting).toBeNull();
  });
});
