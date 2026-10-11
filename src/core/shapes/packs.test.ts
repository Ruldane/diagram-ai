import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../model/defaults";
import type { DNode } from "../model/types";
import { buildScene, nodePrims } from "../render/scene";
import { primToSvg, renderSvg } from "../render/svg";
import { BRAND_DATA } from "./brand-data";
import { PACK_LIMITS, iconMarkup, packIdFromName, packToLibrary, validatePack, type IconPack, type PackIcon } from "./packs";
import {
  allShapes,
  fitSize,
  getLibrary,
  getShape,
  hasShape,
  isRuntimeLibrary,
  listLibraries,
  registerLibrary,
  registryVersion,
  resolveShape,
  searchShapes,
  shapeOutline,
  subscribeRegistry,
  unregisterLibrary,
} from "./registry";

const square = (id: string, name: string, fill = "#ed7100", category?: string): PackIcon => ({
  id,
  name,
  category,
  viewBox: { w: 64, h: 64 },
  layers: [
    { d: "M0 0h64v64H0z", fill },
    { d: "M16 16h32v32H16z", fill: "#ffffff" },
  ],
});

const pack = (overrides: Partial<IconPack> = {}): IconPack => ({
  id: "aws-test",
  name: "AWS Test Icons",
  icons: [square("lambda", "AWS Lambda", "#ed7100", "Compute"), square("amazon-s3", "Amazon S3", "#7aa116", "Storage")],
  ...overrides,
});

const node = (shape: string, w = 120, h = 96, text = "Label"): DNode => ({ id: "n_1", shape, x: 0, y: 0, w, h, z: 1, text });

afterEach(() => {
  for (const library of listLibraries()) if (isRuntimeLibrary(library.id)) unregisterLibrary(library.id);
});

describe("validatePack", () => {
  it("accepts a pack and normalises colours", () => {
    const result = validatePack(pack({ icons: [{ ...square("a", "A"), layers: [{ d: "M0 0h5v5z", fill: "#ABC", stroke: "none" }] }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pack.icons[0].layers[0].fill).toBe("#aabbcc");
  });

  it.each([
    ["an uppercase id", { id: "AWS Icons" }],
    ["no icons", { icons: [] }],
    ["an over-long id", { id: "a".repeat(PACK_LIMITS.packId + 1) }],
    ["a blank name", { name: "  " }],
  ])("rejects %s", (_label, change) => {
    expect(validatePack(pack(change as Partial<IconPack>)).ok).toBe(false);
  });

  it("rejects duplicate icon ids, bad path data and bad colours", () => {
    expect(validatePack(pack({ icons: [square("x", "X"), square("x", "Y")] }))).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate/) });
    const bad = { ...square("x", "X"), layers: [{ d: "<script>alert(1)</script>", fill: "#000000" }] };
    expect(validatePack(pack({ icons: [bad] })).ok).toBe(false);
    const colour = { ...square("x", "X"), layers: [{ d: "M0 0h1v1z", fill: "javascript:1" }] };
    expect(validatePack(pack({ icons: [colour] })).ok).toBe(false);
  });

  it("enforces the icon, per-icon and total size limits", () => {
    const many = Array.from({ length: PACK_LIMITS.icons + 1 }, (_, i) => square(`i${i}`, `Icon ${i}`));
    expect(validatePack(pack({ icons: many }))).toMatchObject({ ok: false });

    const heavy = (id: string, size: number): PackIcon => ({ id, name: id, viewBox: { w: 1, h: 1 }, layers: [{ d: `M0 0${"L1 1".repeat(size / 4)}`, fill: "#000000" }] });
    expect(validatePack(pack({ icons: [heavy("big", PACK_LIMITS.iconBytes + 8)] }))).toMatchObject({ ok: false });
    // Every icon is under the per-icon limit; together they pass the total.
    const each = PACK_LIMITS.iconBytes - 1000;
    const count = Math.ceil(PACK_LIMITS.totalBytes / each) + 1;
    const total = validatePack(pack({ icons: Array.from({ length: count }, (_, i) => heavy(`p${i}`, each)) }));
    expect(total).toMatchObject({ ok: false, error: expect.stringMatching(/MB/) });
  });
});

describe("packIdFromName", () => {
  it("makes short lower-case ids", () => {
    expect(packIdFromName("AWS Architecture Icons")).toBe("aws-architecture-icons");
    expect(packIdFromName("Icons for the very long named company internal pack").length).toBeLessThanOrEqual(PACK_LIMITS.packId);
    expect(packIdFromName("!!!")).toBe("icons");
  });
});

describe("runtime registry", () => {
  it("registers a pack as a library with ids, search and aliases", () => {
    const before = allShapes().length;
    registerLibrary(packToLibrary(pack()));
    expect(allShapes().length).toBe(before + 2);
    expect(listLibraries().at(-1)?.id).toBe("aws-test");
    expect(isRuntimeLibrary("aws-test")).toBe(true);
    expect(getLibrary("aws-test")?.shapes).toHaveLength(2);

    expect(hasShape("aws-test/lambda")).toBe(true);
    expect(resolveShape("aws-test/lambda")?.id).toBe("aws-test/lambda");
    expect(resolveShape("AWS Lambda")?.id).toBe("aws-test/lambda");
    expect(resolveShape("aws-lambda")?.id).toBe("aws-test/lambda");
    expect(resolveShape("aws-s3")?.id).toBe("aws-test/amazon-s3");
    expect(resolveShape("s3")?.id).toBe("infra/object-storage"); // built-ins keep their own names
    expect(searchShapes("lambda").map((s) => s.id)).toContain("aws-test/lambda");
    expect(searchShapes("compute").map((s) => s.id)).toContain("aws-test/lambda");
  });

  it("never shadows a built-in alias", () => {
    registerLibrary(packToLibrary(pack({ icons: [square("queue", "Queue"), square("rect", "Rect")] })));
    expect(resolveShape("queue")?.id).not.toBe("aws-test/queue");
    expect(resolveShape("rect")?.id).toBe("basic/rect");
    expect(resolveShape("aws-test/queue")?.id).toBe("aws-test/queue");
  });

  it("bumps the version, notifies subscribers and stops after unsubscribe", () => {
    let calls = 0;
    const stop = subscribeRegistry(() => calls++);
    const start = registryVersion();
    registerLibrary(packToLibrary(pack()));
    expect(registryVersion()).toBe(start + 1);
    expect(calls).toBe(1);
    expect(unregisterLibrary("aws-test")).toBe(true);
    expect(calls).toBe(2);
    expect(unregisterLibrary("aws-test")).toBe(false);
    expect(calls).toBe(2);
    stop();
    registerLibrary(packToLibrary(pack()));
    expect(calls).toBe(2);
  });

  it("replaces a library registered again and forgets its old shapes", () => {
    registerLibrary(packToLibrary(pack()));
    registerLibrary(packToLibrary(pack({ icons: [square("fargate", "AWS Fargate")] })));
    expect(hasShape("aws-test/lambda")).toBe(false);
    expect(resolveShape("aws-lambda")).toBeUndefined();
    expect(hasShape("aws-test/fargate")).toBe(true);
    expect(listLibraries().filter((l) => l.id === "aws-test")).toHaveLength(1);
  });

  it("refuses to replace a built-in library or to borrow another library's ids", () => {
    expect(() => registerLibrary({ ...packToLibrary(pack()), id: "infra" })).toThrow(/built-in/);
    expect(() => registerLibrary({ id: "mine", name: "Mine", description: "", shapes: [{ ...packToLibrary(pack()).shapes[0], id: "infra/server" }] })).toThrow();
    expect(unregisterLibrary("infra")).toBe(false);
  });

  it("falls back to a rectangle once the pack is gone, and the document still renders", () => {
    registerLibrary(packToLibrary(pack()));
    const nodes = { n_1: node("aws-test/lambda") };
    const withPack = renderSvg(buildScene({ nodes, edges: {}, settings: DEFAULT_SETTINGS })).svg;
    expect(withPack).toContain("#ed7100");

    unregisterLibrary("aws-test");
    expect(getShape("aws-test/lambda").id).toBe("basic/rect");
    // The very same node object: the display-list cache has to notice the registry changed.
    const without = renderSvg(buildScene({ nodes, edges: {}, settings: DEFAULT_SETTINGS })).svg;
    expect(without).not.toContain("#ed7100");
    expect(without).toContain("<path");
  });
});

describe("pack shapes", () => {
  it("draws a tile with the icon's own colours and the label below", () => {
    registerLibrary(packToLibrary(pack()));
    const prims = nodePrims(node("aws-test/lambda", 120, 96, "My function"));
    const svg = prims.map(primToSvg).join("");
    expect(svg).toContain('fill="#ed7100"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("My function");
    expect(prims.some((prim) => prim.kind === "text")).toBe(true);
  });

  it("keeps the icon's aspect ratio and stays inside the tile", () => {
    const wide: PackIcon = { id: "wide", name: "Wide", viewBox: { w: 200, h: 50 }, layers: [{ d: "M0 0h200v50H0z", fill: "#112233" }] };
    registerLibrary(packToLibrary(pack({ icons: [wide] })));
    const prims = nodePrims(node("aws-test/wide", 120, 96, "Wide"));
    const art = prims.find((prim) => prim.kind === "path" && prim.fill === "#112233");
    expect(art?.kind).toBe("path");
    if (art?.kind === "path") {
      const xs = art.d.flatMap((cmd) => (cmd[0] === "M" || cmd[0] === "L" ? [cmd[1]] : []));
      const ys = art.d.flatMap((cmd) => (cmd[0] === "M" || cmd[0] === "L" ? [cmd[2]] : []));
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(w / h).toBeCloseTo(4);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(120);
    }
  });

  it("honours the node style on the tile body", () => {
    registerLibrary(packToLibrary(pack()));
    const styled: DNode = { ...node("aws-test/lambda"), style: { fill: "#ffeeaa", stroke: "#ff0000" } };
    expect(nodePrims(styled)[0]).toMatchObject({ kind: "path", fill: "#ffeeaa", stroke: "#ff0000" });
  });

  it("passes the invariants every shape has to meet", () => {
    registerLibrary(packToLibrary(pack()));
    for (const shape of getLibrary("aws-test")!.shapes) {
      for (const size of [shape.size, { w: 300, h: 200 }, { w: 24, h: 24 }]) {
        for (const text of [undefined, shape.text, "Two\nlines\n---\nsections"]) {
          const prims = nodePrims(node(shape.id, size.w, size.h, text));
          expect(prims.length).toBeGreaterThan(0);
          for (const prim of prims) {
            expect(typeof primToSvg(prim)).toBe("string");
            if (prim.kind === "path") for (const cmd of prim.d) for (const value of cmd.slice(1)) expect(Number.isFinite(value)).toBe(true);
          }
        }
      }
      const outline = shapeOutline(node(shape.id));
      expect(outline.some((cmd) => cmd[0] === "Z")).toBe(true);
      const size = fitSize({ shape: shape.id, text: "Long name for a service icon\nsubtitle" });
      expect(size.w).toBeGreaterThan(0);
      expect(size.h).toBeLessThan(1200);
    }
  });

  it("renders preview markup that cannot carry anything but paths", () => {
    const icon: PackIcon = { id: "x", name: "X", viewBox: { w: 10, h: 10 }, layers: [{ d: 'M0 0h5v5z"><script>1</script><path d="', fill: "#123456" }] };
    const markup = iconMarkup(icon);
    expect(markup).not.toContain("<script");
    expect(markup).toContain('fill="#123456"');
  });
});

describe("brands", () => {
  it("is registered after the icons library and has a tile per brand", () => {
    const ids = listLibraries().map((l) => l.id);
    expect(ids.indexOf("brands")).toBeGreaterThan(ids.indexOf("icons"));
    expect(getLibrary("brands")!.shapes).toHaveLength(Object.keys(BRAND_DATA).length);
    expect(Object.keys(BRAND_DATA).length).toBeGreaterThan(150);
  });

  it("resolves brand names and aliases, while infra keeps its own names", () => {
    expect(resolveShape("brands/postgresql")?.id).toBe("brands/postgresql");
    expect(resolveShape("postgresql-logo")?.id).toBe("brands/postgresql");
    expect(resolveShape("Apache Kafka")?.id).toBe("brands/apachekafka");
    expect(resolveShape("amazon web services")?.id).toBe("brands/amazonaws");
    expect(resolveShape("aws")?.id).toBe("brands/amazonaws");
    expect(resolveShape("gcp")?.id).toBe("brands/googlecloud");
    expect(resolveShape("azure")?.id).toBe("brands/microsoftazure");
    // Generic infra tiles win their own names.
    expect(resolveShape("kubernetes")?.id).toBe("infra/kubernetes");
    expect(resolveShape("docker")?.id).toBe("infra/container");
    expect(resolveShape("postgres")?.id).toBe("infra/sql-database");
    // `prefer` lets a caller choose the logos.
    expect(resolveShape("kubernetes", ["brands"])?.id).toBe("brands/kubernetes");
    expect(resolveShape("docker", ["brands"])?.id).toBe("brands/docker");
  });

  it("draws the glyph in the brand colour, or in ink when the colour would not read", () => {
    const blue = nodePrims(node("brands/docker")).map(primToSvg).join("");
    expect(blue).toContain(`fill="${BRAND_DATA.docker.hex}"`);
    const yellow = nodePrims(node("brands/javascript")).map(primToSvg).join("");
    expect(yellow).not.toContain(BRAND_DATA.javascript.hex);
    expect(yellow).toContain('fill="#1c1f23"');
    // On a dark tile a near-black mark would vanish: it flips to white. A bright brand colour stays.
    const dark = nodePrims({ ...node("brands/github"), style: { fill: "#1c1f23" } }).map(primToSvg).join("");
    expect(dark).toContain('fill="#ffffff"');
    const bright = nodePrims({ ...node("brands/javascript"), style: { fill: "#1c1f23" } }).map(primToSvg).join("");
    expect(bright).toContain(`fill="${BRAND_DATA.javascript.hex}"`);
  });
});
