import { describe, expect, it } from "vitest";

import { isEdgeKind } from "../edges/kinds";
import { loadElk } from "../layout/engine";
import { computeLayout } from "../layout/layout";
import { createDoc } from "../model/defaults";
import { applyPatch } from "../model/patch";
import type { DiagramDoc, DNode } from "../model/types";
import { getLibrary, getShape, hasShape, listLibraries, resolveShape } from "../shapes/registry";
import { applySpec } from "../spec/apply";
import { buildSequence } from "../spec/sequence";
import { CATEGORIES } from "./categories";
import { DIAGRAM_TYPES } from "./diagram-types";
import type { DiagramTypeDef } from "./types";

const QUICK_START = ["flowchart", "uml-sequence", "system-architecture", "er-diagram", "uml-class"];
const REQUIRED = ["flowchart", "blank", "uml-sequence"];
const LIBRARY_IDS = new Set(listLibraries().map((library) => library.id));
const SHAPE_TOKEN = /\b[a-z0-9]+\/[a-z0-9-]+\b/g;

/** Instantiates a template the way `DiagramService.create` does, before any layout. */
function build(type: DiagramTypeDef): { doc: DiagramDoc; warnings: string[] } {
  const doc = createDoc({ name: type.name, type: type.id, settings: { routing: type.routing, layout: type.layout } });
  const built = applySpec(doc, type.template ?? {}, { mode: "create", defaultShape: type.defaultShape });
  return { doc: applyPatch(doc, built.patch).doc, warnings: built.warnings };
}

const overlaps = (a: DNode, b: DNode): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

const isInside = (child: DNode, parent: DNode): boolean =>
  child.x >= parent.x - 1 && child.y >= parent.y - 1 && child.x + child.w <= parent.x + parent.w + 1 && child.y + child.h <= parent.y + parent.h + 1;

describe("diagram type catalog", () => {
  it("has unique kebab-case ids", () => {
    const ids = DIAGRAM_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("contains the ids other code depends on", () => {
    const ids = new Set(DIAGRAM_TYPES.map((type) => type.id));
    for (const id of REQUIRED) expect(ids.has(id), id).toBe(true);
  });

  it("starts with the quick-start types", () => {
    expect(DIAGRAM_TYPES.slice(0, QUICK_START.length).map((type) => type.id)).toEqual(QUICK_START);
  });

  it("lists the remaining types by category, in the order of CATEGORIES", () => {
    const order = CATEGORIES.map((category) => category.id);
    const ranks = DIAGRAM_TYPES.slice(QUICK_START.length).map((type) => order.indexOf(type.category));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(DIAGRAM_TYPES.find((type) => type.category === "general")?.id).toBe("blank");
  });

  it("covers every category", () => {
    expect(DIAGRAM_TYPES.length).toBeGreaterThanOrEqual(60);
    for (const category of CATEGORIES) {
      const count = DIAGRAM_TYPES.filter((type) => type.category === category.id).length;
      expect(count, category.id).toBeGreaterThanOrEqual(category.id === "general" ? 2 : 3);
    }
  });

  it("builds the sequence template with lifelines and messages", () => {
    const type = DIAGRAM_TYPES.find((t) => t.id === "uml-sequence");
    expect(type?.template?.sequence).toBeDefined();
    expect(type?.template?.layout).toBe("none");
    expect(type?.routing).toBe("straight");
    expect(type?.edgeKind).toBe("message");
  });
});

describe.each(DIAGRAM_TYPES)("$category/$id", (type) => {
  const template = type.template;

  it("has valid metadata", () => {
    expect(CATEGORIES.some((category) => category.id === type.category), `category ${type.category}`).toBe(true);
    expect(type.name.trim().length).toBeGreaterThan(0);
    expect(type.description.trim().length).toBeGreaterThan(0);
    expect(type.agentGuide.trim().length).toBeGreaterThan(0);
    expect(type.keywords.length).toBeGreaterThan(0);
    expect(type.libraries.length).toBeGreaterThan(0);
    for (const library of type.libraries) expect(getLibrary(library), `library ${library}`).toBeDefined();
    expect(hasShape(type.defaultShape), `defaultShape ${type.defaultShape}`).toBe(true);
    expect(isEdgeKind(type.edgeKind), `edgeKind ${type.edgeKind}`).toBe(true);
    expect(["dedicated", "generic"]).toContain(type.support);
  });

  it("only names existing shapes in its agent guide", () => {
    for (const token of type.agentGuide.match(SHAPE_TOKEN) ?? []) {
      if (!LIBRARY_IDS.has(token.split("/")[0])) continue;
      expect(hasShape(token), `agentGuide mentions unknown shape ${token}`).toBe(true);
    }
  });

  if (!template) return;

  if (template.sequence) {
    it("builds its sequence without warnings", () => {
      const built = buildSequence(template.sequence!);
      expect(built.warnings).toEqual([]);
      expect(built.participantIds.length).toBe(template.sequence!.participants.length);
      expect(built.patch.edges?.set?.length).toBe(template.sequence!.messages.length);
      expect(template.layout).toBe("none");
      expect(template.nodes ?? []).toEqual([]);
      expect(template.edges ?? []).toEqual([]);
    });
    return;
  }

  it("uses exact shape ids, existing endpoints and container parents", () => {
    const nodes = template.nodes ?? [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    expect(byId.size, "node ids must be unique").toBe(nodes.length);
    for (const node of nodes) {
      expect(node.id, "every template node needs an id").toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      if (node.shape) {
        expect(resolveShape(node.shape)?.id, `node ${node.id}: shape ${node.shape}`).toBe(node.shape);
        expect(hasShape(node.shape), `node ${node.id}: shape ${node.shape}`).toBe(true);
      }
      if (node.parent) {
        const parent = byId.get(node.parent);
        expect(parent, `node ${node.id}: parent ${node.parent}`).toBeDefined();
        expect(Boolean(getShape(parent?.shape ?? type.defaultShape).container), `node ${node.id}: parent ${node.parent} must be a container`).toBe(true);
      }
    }
    for (const [index, edge] of (template.edges ?? []).entries()) {
      expect(byId.has(edge.from ?? ""), `edges[${index}].from ${edge.from}`).toBe(true);
      expect(byId.has(edge.to ?? ""), `edges[${index}].to ${edge.to}`).toBe(true);
      if (edge.kind) expect(isEdgeKind(edge.kind), `edges[${index}].kind ${edge.kind}`).toBe(true);
    }
  });

  it("applies without warnings", () => {
    const { doc, warnings } = build(type);
    expect(warnings).toEqual([]);
    expect(Object.keys(doc.nodes).length).toBe(template.nodes?.length ?? 0);
    expect(Object.keys(doc.edges).length).toBe(template.edges?.length ?? 0);
  });

  if (template.layout === "none") {
    it("places every node explicitly, children inside their containers", () => {
      for (const node of template.nodes ?? []) {
        expect(typeof node.x === "number" && typeof node.y === "number", `node ${node.id} needs x and y`).toBe(true);
      }
      const { doc } = build(type);
      for (const node of Object.values(doc.nodes)) {
        if (node.parent) expect(isInside(node, doc.nodes[node.parent]), `node ${node.id} lies outside its container ${node.parent}`).toBe(true);
      }
    });
  } else {
    it("lays out automatically without overlapping nodes", async () => {
      for (const node of template.nodes ?? []) {
        expect(node.x === undefined && node.y === undefined, `node ${node.id}: auto-layout templates must not set x / y`).toBe(true);
        // Only the layered algorithm lays out containers hierarchically.
        if (type.layout.algorithm !== "layered") expect(node.parent, `node ${node.id}: no containers with the ${type.layout.algorithm} layout`).toBeUndefined();
      }
      const { doc } = build(type);
      const laidOut = applyPatch(doc, await computeLayout(doc, type.layout, await loadElk())).doc;
      const nodes = Object.values(laidOut.nodes);
      for (const node of nodes) {
        expect([node.x, node.y, node.w, node.h].every(Number.isFinite), `node ${node.id} has a non-finite box`).toBe(true);
        if (node.parent) expect(isInside(node, laidOut.nodes[node.parent]), `node ${node.id} lies outside its container ${node.parent}`).toBe(true);
      }
      const leaves = nodes.filter((node) => !getShape(node.shape).container);
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          expect(overlaps(leaves[i], leaves[j]), `nodes ${leaves[i].id} and ${leaves[j].id} overlap`).toBe(false);
        }
      }
    });
  }
});
