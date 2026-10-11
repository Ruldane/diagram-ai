import { describe, expect, it } from "vitest";

import { createDoc } from "@/core/model/defaults";
import type { DiagramDoc, DNode } from "@/core/model/types";

import {
  DEFAULT_EXPORT_OPTIONS,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  bytesToBase64,
  exportDiagram,
  exportDiagramFiles,
  exportExtension,
  exportFileNames,
  exportMime,
  previewSvg,
  rasterScale,
  resolveBackground,
} from "./client-export";
import { exportSummary, sheetLayout } from "./export-layout";
import { DEFAULT_EXPORT_SETTINGS, effectiveSettings, exportedMessage, toExportOptions } from "./export-settings";

function node(id: string, shape: string, x: number, y: number, extra: Partial<DNode> = {}): DNode {
  return { id, shape, x, y, w: 160, h: 80, z: 0, text: id, ...extra };
}

function sampleDoc(): DiagramDoc {
  const doc = createDoc({ name: "Checkout flow" });
  doc.nodes = {
    f1: node("f1", "basic/frame", 0, 0, { w: 400, h: 300, text: "Cart" }),
    a: node("a", "basic/rect", 40, 60, { parent: "f1" }),
    f2: node("f2", "basic/frame", 500, 0, { w: 400, h: 300, text: "Payment" }),
    b: node("b", "basic/rect", 540, 60, { parent: "f2" }),
  };
  return doc;
}

describe("file names and types", () => {
  it("uses the jpg extension and image/jpeg for JPEG", () => {
    expect(exportExtension("jpeg")).toBe("jpg");
    expect(exportMime("jpeg")).toBe("image/jpeg");
    expect(exportExtension("mermaid")).toBe("mmd");
    expect(exportMime("pptx")).toContain("presentationml");
  });

  it("names a single file after the diagram", () => {
    expect(exportFileNames("Checkout flow", "png")).toEqual(["Checkout-flow.png"]);
    expect(exportFileNames("  ", "pdf")).toEqual(["diagram.pdf"]);
  });

  it("numbers several files with a fixed width", () => {
    expect(exportFileNames("Flow", "jpeg", 3)).toEqual(["Flow-01.jpg", "Flow-02.jpg", "Flow-03.jpg"]);
    const many = exportFileNames("Flow", "svg", 120);
    expect(many[0]).toBe("Flow-001.svg");
    expect(many[119]).toBe("Flow-120.svg");
  });
});

describe("resolveBackground", () => {
  it("maps white to a colour for every format", () => {
    expect(resolveBackground("png", "white")).toBe("#ffffff");
    expect(resolveBackground("pdf", "white")).toBe("#ffffff");
  });

  it("keeps transparency only where the format supports it", () => {
    expect(resolveBackground("png", "transparent")).toBe("transparent");
    expect(resolveBackground("svg", "transparent")).toBe("transparent");
    expect(resolveBackground("jpeg", "transparent")).toBe("doc");
    expect(resolveBackground("pptx", "transparent")).toBe("doc");
  });
});

describe("rasterScale", () => {
  it("keeps the requested density for ordinary diagrams", () => {
    expect(rasterScale({ w: 1200, h: 800 }, 2)).toBe(2);
    expect(rasterScale({ w: 1200, h: 800 }, 4)).toBe(4);
  });

  it("reduces the density to stay inside the canvas limits", () => {
    const area = rasterScale({ w: 6000, h: 5000 }, 4);
    expect(area).toBeLessThan(4);
    expect(6000 * area * 5000 * area).toBeLessThanOrEqual(MAX_CANVAS_PIXELS * 1.0001);

    const side = rasterScale({ w: 30_000, h: 200 }, 2);
    expect(30_000 * side).toBeLessThanOrEqual(MAX_CANVAS_SIDE * 1.0001);
  });
});

describe("bytesToBase64", () => {
  it("matches Buffer for data larger than one chunk", () => {
    const bytes = new Uint8Array(100_003).map((_, index) => (index * 31 + 7) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("text exports", () => {
  it("writes the document as JSON that parses back to the same value", async () => {
    const doc = sampleDoc();
    const file = await exportDiagram(doc, "json", DEFAULT_EXPORT_OPTIONS);
    expect(file.fileName).toBe("Checkout-flow.json");
    expect(file.blob.type).toContain("application/json");
    expect(JSON.parse(await file.blob.text())).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it("produces one draw.io and one Mermaid file whatever the scope", async () => {
    const doc = sampleDoc();
    const [drawio, ...rest] = await exportDiagramFiles(doc, "drawio", { ...DEFAULT_EXPORT_OPTIONS, scope: { kind: "frames" } });
    expect(rest).toHaveLength(0);
    expect(drawio.fileName).toBe("Checkout-flow.drawio");
    expect(await drawio.blob.text()).toContain("<mxfile");

    const mermaid = await exportDiagram(doc, "mermaid", DEFAULT_EXPORT_OPTIONS);
    expect(mermaid.fileName).toBe("Checkout-flow.mmd");
    expect((await mermaid.blob.text()).length).toBeGreaterThan(0);
  });
});

describe("previewSvg", () => {
  it("renders the first page without embedding fonts and reports the page count", async () => {
    const doc = sampleDoc();
    const all = await previewSvg(doc, DEFAULT_EXPORT_OPTIONS);
    expect(all.pages).toBe(1);
    expect(all.svg.startsWith("<svg")).toBe(true);
    expect(all.svg).not.toContain("@font-face");
    expect(all.width).toBeGreaterThan(900);

    const frames = await previewSvg(doc, { ...DEFAULT_EXPORT_OPTIONS, scope: { kind: "frames" } });
    expect(frames.pages).toBe(2);
    expect(frames.name).toBe("Cart");
    expect(frames.width).toBe(400);
    expect(frames.height).toBe(300);
  });

  it("omits the background rectangle when transparent", async () => {
    const doc = sampleDoc();
    const opaque = await previewSvg(doc, { ...DEFAULT_EXPORT_OPTIONS, background: "white" });
    const clear = await previewSvg(doc, { ...DEFAULT_EXPORT_OPTIONS, background: "transparent" });
    expect(opaque.svg).toContain('<rect x=');
    expect(clear.svg).not.toContain('<rect x=');
  });
});

describe("sheetLayout", () => {
  const options = DEFAULT_EXPORT_SETTINGS;

  it("has no sheet for images and fit-to-diagram PDFs", () => {
    expect(sheetLayout("png", options, { w: 800, h: 600 })).toBeNull();
    expect(sheetLayout("pdf", { ...options, pageSize: "fit" }, { w: 800, h: 600 })).toBeNull();
  });

  it("picks the orientation from the diagram and keeps it inside the margins", () => {
    const wide = sheetLayout("pdf", { ...options, pageSize: "a4" }, { w: 2000, h: 900 })!;
    expect(wide.landscape).toBe(true);
    expect(wide.content.x).toBeCloseTo(options.margin, 5);
    expect(wide.content.x + wide.content.w).toBeCloseTo(wide.sheet.w - options.margin, 5);
    expect(wide.content.y).toBeGreaterThan(options.margin);

    const tall = sheetLayout("pdf", { ...options, pageSize: "letter" }, { w: 600, h: 1800 })!;
    expect(tall.landscape).toBe(false);
    expect(sheetLayout("pdf", { ...options, pageSize: "letter", orientation: "landscape" }, { w: 600, h: 1800 })!.landscape).toBe(true);
  });

  it("does not blow small diagrams up to the full sheet", () => {
    const small = sheetLayout("pdf", { ...options, pageSize: "a3" }, { w: 200, h: 100 })!;
    expect(small.content.w).toBeCloseTo(300, 5);
    const slide = sheetLayout("pptx", options, { w: 120, h: 60 })!;
    expect(slide.content.w).toBeCloseTo(2, 5);
    expect(slide.content.x).toBeCloseTo((slide.sheet.w - 2) / 2, 5);
  });
});

describe("exportSummary", () => {
  const page = { width: 920, height: 610, pages: 1 };

  it("describes each kind of output", () => {
    expect(exportSummary("png", { ...DEFAULT_EXPORT_SETTINGS, scale: 2 }, page)).toBe("1840 × 1220 px @2×");
    expect(exportSummary("svg", DEFAULT_EXPORT_SETTINGS, page)).toBe("920 × 610 px · vector");
    expect(exportSummary("pdf", { ...DEFAULT_EXPORT_SETTINGS, pageSize: "a4" }, page)).toBe("A4 landscape · 1 page");
    expect(exportSummary("pdf", DEFAULT_EXPORT_SETTINGS, page)).toBe("243 × 161 mm · 1 page");
    expect(exportSummary("pptx", DEFAULT_EXPORT_SETTINGS, { ...page, pages: 3 })).toBe("16:9 · 3 slides");
    expect(exportSummary("png", DEFAULT_EXPORT_SETTINGS, { ...page, pages: 3 })).toBe("1840 × 1220 px @2× · 3 files");
  });

  it("says when the image had to be shrunk", () => {
    expect(exportSummary("jpeg", { ...DEFAULT_EXPORT_SETTINGS, scale: 4 }, { width: 6000, height: 5000, pages: 1 })).toContain("reduced");
  });
});

describe("export settings", () => {
  it("falls back when a scope or background is not available, without losing the choice", () => {
    const chosen = { ...DEFAULT_EXPORT_SETTINGS, scope: "selection" as const, background: "transparent" as const };
    expect(effectiveSettings(chosen, { selection: 0, frames: 0 }).scope).toBe("all");
    expect(effectiveSettings(chosen, { selection: 2, frames: 0 })).toBe(chosen);
    expect(effectiveSettings({ ...chosen, format: "jpeg" }, { selection: 2, frames: 0 }).background).toBe("doc");
    expect(effectiveSettings({ ...chosen, format: "json" }, { selection: 2, frames: 0 })).toMatchObject({ scope: "all", background: "doc" });
    expect(chosen.scope).toBe("selection");
  });

  it("turns settings into options with the current selection", () => {
    const options = toExportOptions({ ...DEFAULT_EXPORT_SETTINGS, scope: "selection" }, ["a", "b"]);
    expect(options.scope).toEqual({ kind: "selection", ids: ["a", "b"] });
    expect(options).not.toHaveProperty("format");
    expect(toExportOptions(DEFAULT_EXPORT_SETTINGS, ["a"]).scope).toEqual({ kind: "all" });
  });

  it("words the success message for one file, several files and a reduced scale", () => {
    const blob = new Blob([]);
    expect(exportedMessage([{ blob, fileName: "a.png", pages: 1, scale: 2 }], 2)).toBe("Exported a.png");
    expect(exportedMessage([{ blob, fileName: "a.pdf", pages: 4 }], 2)).toBe("Exported a.pdf (4 pages)");
    expect(exportedMessage([{ blob, fileName: "a-01.png", pages: 1 }, { blob, fileName: "a-02.png", pages: 1 }], 2)).toContain("2 files");
    expect(exportedMessage([{ blob, fileName: "a.png", pages: 1, scale: 1.5 }], 4)).toContain("1.5× instead of 4×");
  });
});
