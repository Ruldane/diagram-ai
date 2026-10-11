import { describe, expect, it } from "vitest";

import { pathBounds } from "../geometry/path";
import type { DNode } from "../model/types";
import { nodePrims } from "../render/scene";
import { primToSvg } from "../render/svg";
import { allShapes, fitSize, getShape, listLibraries, resolveShape, shapeOutline } from "./registry";
import type { Prim } from "./types";

const SAMPLE_TEXT = "Order Service\n---\n+ id: UUID\n+ total: Money\n---\n+ submit(): void";

function makeNode(shape: string, w: number, h: number, text?: string): DNode {
  return { id: "n_test", shape, x: 0, y: 0, w, h, z: 1, text };
}

function assertFinite(prims: Prim[], label: string) {
  for (const prim of prims) {
    if (prim.kind === "path") {
      for (const cmd of prim.d) {
        for (const value of cmd.slice(1)) {
          expect(Number.isFinite(value), `${label}: non-finite path coordinate`).toBe(true);
        }
      }
    } else {
      for (const value of [prim.box.x, prim.box.y, prim.box.w, prim.box.h, prim.font.size]) {
        expect(Number.isFinite(value), `${label}: non-finite text box`).toBe(true);
      }
    }
  }
}

describe("shape registry", () => {
  it("has unique, well-formed ids that match their library", () => {
    for (const library of listLibraries()) {
      for (const shape of library.shapes) {
        expect(shape.id, shape.id).toMatch(/^[a-z0-9]+\/[a-z0-9-]+$/);
        expect(shape.id.startsWith(`${library.id}/`), `${shape.id} must start with ${library.id}/`).toBe(true);
        expect(shape.name.length, `${shape.id} needs a name`).toBeGreaterThan(0);
        expect(shape.size.w, shape.id).toBeGreaterThan(0);
        expect(shape.size.h, shape.id).toBeGreaterThan(0);
      }
    }
  });

  it("resolves ids, short names and aliases", () => {
    expect(resolveShape("flowchart/decision")?.id).toBe("flowchart/decision");
    expect(resolveShape("Decision")?.id).toBe("flowchart/decision");
    expect(resolveShape("database")?.id).toBe("basic/cylinder");
    expect(resolveShape("no-such-shape")).toBeUndefined();
    expect(getShape("no-such-shape").id).toBe("basic/rect");
  });
});

describe.each(allShapes().map((shape) => [shape.id, shape] as const))("%s", (id, shape) => {
  const sizes = [
    shape.size,
    { w: shape.size.w * 2.5, h: shape.size.h * 2 },
    { w: Math.max(shape.minSize?.w ?? 24, 24), h: Math.max(shape.minSize?.h ?? 24, 24) },
  ];

  it("renders finite geometry at any size, with and without text", () => {
    for (const size of sizes) {
      for (const text of [undefined, shape.text, SAMPLE_TEXT]) {
        const node = makeNode(id, size.w, size.h, text);
        const prims = nodePrims(node);
        assertFinite(prims, `${id} ${size.w}×${size.h}`);
        for (const prim of prims) expect(typeof primToSvg(prim)).toBe("string");
      }
    }
  });

  it("draws something visible at its default size", () => {
    const prims = nodePrims(makeNode(id, shape.size.w, shape.size.h, shape.text ?? "Label"));
    expect(prims.length, `${id} draws nothing`).toBeGreaterThan(0);
  });

  it("has a closed outline close to its box", () => {
    const { w, h } = shape.size;
    const outline = shapeOutline(makeNode(id, w, h));
    expect(outline.some((cmd) => cmd[0] === "Z"), `${id} outline must be closed`).toBe(true);
    const bounds = pathBounds(outline)!;
    // Connectors clip against the outline, so it must stay within the node box (small tolerance).
    expect(bounds.x).toBeGreaterThanOrEqual(-w * 0.1 - 2);
    expect(bounds.y).toBeGreaterThanOrEqual(-h * 0.1 - 2);
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(w * 1.1 + 2);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(h * 1.1 + 2);
  });

  it("auto-sizes to a sane size", () => {
    const size = fitSize({ shape: id, text: SAMPLE_TEXT });
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
    expect(size.w).toBeLessThan(1200);
    expect(size.h).toBeLessThan(1200);
  });
});
