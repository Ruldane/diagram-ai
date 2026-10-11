import { describe, expect, it } from "vitest";

import { getDiagramType } from "./catalog";
import { createDoc } from "./model/defaults";
import { patchSchema } from "./model/schema";
import { safeLink } from "./model/url";
import { buildScene } from "./render/scene";
import { renderSvg } from "./render/svg";
import { applySpec } from "./spec/apply";
import { resolveShape } from "./shapes/registry";
import { layoutText } from "./text/layout";
import { applyPatch } from "./model/patch";

describe("link safety", () => {
  it("accepts web, mail and relative links and rejects script-capable schemes", () => {
    for (const ok of ["https://example.com/a?b=1", "http://localhost:3000", "mailto:a@b.co", "/docs/page", "#section", "docs/readme.md"]) {
      expect(safeLink(ok), ok).toBe(ok);
    }
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html;base64,AAAA", "vbscript:msgbox(1)", "file:///etc/passwd"]) {
      expect(safeLink(bad), bad).toBeUndefined();
    }
  });

  it("is enforced on input and when serialising", () => {
    const node = { id: "a", shape: "basic/rect", x: 0, y: 0, w: 100, h: 50, z: 1, link: "javascript:alert(1)" };
    expect(() => patchSchema.parse({ nodes: { set: [node] } })).toThrow();

    // Even a document that already contains one (older file) cannot emit it.
    const doc = applyPatch(createDoc(), { nodes: { set: [node] } }).doc;
    expect(renderSvg(buildScene(doc)).svg).not.toMatch(/javascript:/i);
  });
});

describe("agent shape names", () => {
  it("ambiguous aliases resolve to the libraries the diagram type pins", () => {
    expect(resolveShape("entity")?.id).toBe("uml/entity");
    expect(resolveShape("entity", getDiagramType("er-diagram").libraries)?.id).toBe("er/entity");
    expect(resolveShape("queue", getDiagramType("cloud-architecture").libraries)?.id).toBe("infra/queue");
    expect(resolveShape("queue", getDiagramType("agent-architecture").libraries)?.id).toBe("ai/queue");
    // Exact ids always win, whatever the preference.
    expect(resolveShape("c4/queue", ["infra"])?.id).toBe("c4/queue");
  });

  it("the spec builder uses the preference", () => {
    const { patch } = applySpec(createDoc(), { nodes: [{ id: "q", shape: "queue", text: "Jobs" }] }, { preferLibraries: ["infra"] });
    expect(patch.nodes!.set![0].shape).toBe("infra/queue");
  });
});

describe("agent references", () => {
  it("edges and parents may use the label or original id of a node whose id was normalised", () => {
    const { patch, warnings } = applySpec(createDoc(), {
      nodes: [{ id: "Backend Zone", shape: "group", text: "Backend" }, { id: "Auth Service", parent: "Backend Zone" }, { text: "Billing" }],
      edges: [{ from: "Auth Service", to: "Billing" }],
    });
    expect(warnings).toEqual([]);
    const ids = patch.nodes!.set!.map((n) => n.id);
    expect(ids).toEqual(["backend-zone", "auth-service", "billing"]);
    expect(patch.nodes!.set!.find((n) => n.id === "auth-service")!.parent).toBe("backend-zone");
    expect(patch.edges!.set![0]).toMatchObject({ from: { node: "auth-service" }, to: { node: "billing" } });
  });

  it("new edges take the diagram type's relationship, explicit kinds still win", () => {
    const { patch } = applySpec(
      createDoc(),
      { nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "b", kind: "dashed" }] },
      { defaultEdgeKind: "association" },
    );
    const [plain, dashed] = patch.edges!.set!;
    expect(plain.style).toMatchObject({ endMarker: "open-arrow", dash: "solid" });
    expect(dashed.style).toMatchObject({ endMarker: "arrow", dash: "dashed" });
  });
});

describe("connector labels never wrap mid-word", () => {
  it("holds for a wide sample of words and sizes", () => {
    const words = ["check", "Pass", "close", "U(s)", "happens in", "Yes", "No", "publishes", "HTTPS", "SQL", "consumes", "approved", "retry", "1..*", "validate", "on timeout", "Wednesday", "minimum", "illicit"];
    for (const size of [10, 11, 12, 13, 14, 16]) {
      for (const word of words) {
        const doc = applyPatch(createDoc(), {
          nodes: { set: [{ id: "a", shape: "basic/rect", x: 0, y: 0, w: 100, h: 50, z: 1 }, { id: "b", shape: "basic/rect", x: 400, y: 0, w: 100, h: 50, z: 1 }] },
          edges: { set: [{ id: "e", from: { node: "a" }, to: { node: "b" }, routing: "straight", text: word, style: { fontSize: size } }] },
        }).doc;
        const prim = buildScene(doc).layers.find((layer) => layer.kind === "edge-labels")!.prims[0];
        if (prim.kind !== "text") throw new Error("expected text");
        expect(layoutText(prim).lines.map((line) => line.text), `${word} @${size}`).toEqual([word]);
      }
    }
  });
});
