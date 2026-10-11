import { describe, expect, it } from "vitest";

import { createDoc } from "./defaults";
import { removalPatch, withIntegrity } from "./integrity";
import { applyPatch, diffDocs, isEmptyPatch, mergePatches } from "./patch";
import { parsePatch } from "./schema";
import type { DComment, DEdge, DiagramDoc, DNode } from "./types";

const node = (id: string, extra: Partial<DNode> = {}): DNode => ({ id, shape: "basic/rect", x: 0, y: 0, w: 100, h: 50, z: 1, ...extra });
const edge = (id: string, from: string, to: string): DEdge => ({ id, from: { node: from }, to: { node: to }, routing: "orthogonal" });
const comment = (id: string, target?: string): DComment => ({
  id,
  target,
  x: 0,
  y: 0,
  author: { kind: "human", id: "u", name: "You" },
  text: "Check this",
  createdAt: "2026-01-01T00:00:00.000Z",
  replies: [],
});

function sample(): DiagramDoc {
  return applyPatch(createDoc({ name: "Test" }), {
    nodes: { set: [node("a"), node("b"), node("group", { shape: "basic/group" }), node("c", { parent: "group" })] },
    edges: { set: [edge("e1", "a", "b"), edge("e2", "b", "c")] },
    comments: { set: [comment("c1", "a")] },
  }).doc;
}

describe("applyPatch", () => {
  it("is immutable and keeps untouched elements identical", () => {
    const doc = sample();
    const moved = { ...doc.nodes.a, x: 40 };
    const { doc: next, changed } = applyPatch(doc, { nodes: { set: [moved] } });
    expect(changed).toBe(true);
    expect(next).not.toBe(doc);
    expect(doc.nodes.a.x).toBe(0);
    expect(next.nodes.a).toBe(moved);
    expect(next.nodes.b).toBe(doc.nodes.b);
    expect(next.edges).toBe(doc.edges);
  });

  it("reports no change for a no-op patch", () => {
    const doc = sample();
    const result = applyPatch(doc, { nodes: { set: [doc.nodes.a], remove: ["does-not-exist"] } });
    expect(result.changed).toBe(false);
    expect(result.doc).toBe(doc);
  });

  it("returns an inverse that restores the previous document exactly", () => {
    const doc = sample();
    const patch = {
      nodes: { set: [{ ...doc.nodes.a, text: "Renamed" }, node("new")], remove: ["b"] },
      edges: { remove: ["e1"] },
      doc: { name: "Renamed diagram", settings: { snap: false } },
    };
    const forward = applyPatch(doc, patch);
    const back = applyPatch(forward.doc, forward.inverse);
    expect(back.doc.nodes).toEqual(doc.nodes);
    expect(back.doc.edges).toEqual(doc.edges);
    expect(back.doc.name).toBe("Test");
    expect(back.doc.settings).toEqual(doc.settings);
    // Undo of the undo is the original change again.
    expect(applyPatch(back.doc, back.inverse).doc.nodes).toEqual(forward.doc.nodes);
  });

  it("treats an element set and removed in the same patch as never created", () => {
    const doc = sample();
    const result = applyPatch(doc, { nodes: { set: [node("temp")], remove: ["temp"] } });
    expect(result.doc.nodes.temp).toBeUndefined();
    expect(applyPatch(result.doc, result.inverse).doc.nodes).toEqual(doc.nodes);
  });
});

describe("diffDocs and mergePatches", () => {
  it("diff turns one document into the other", () => {
    const before = sample();
    const after = applyPatch(before, { nodes: { set: [{ ...before.nodes.a, x: 10 }], remove: ["b"] }, doc: { name: "Other" } }).doc;
    const patch = diffDocs(before, after);
    expect(patch.nodes?.set?.map((n) => n.id)).toEqual(["a"]);
    expect(patch.nodes?.remove).toEqual(["b"]);
    expect(applyPatch(before, patch).doc.nodes).toEqual(after.nodes);
    expect(isEmptyPatch(diffDocs(after, after))).toBe(true);
  });

  it("merge keeps the last write per element", () => {
    const merged = mergePatches({ nodes: { set: [node("a", { x: 1 }), node("b")] } }, { nodes: { set: [node("a", { x: 2 })], remove: ["b"] } });
    expect(merged.nodes?.set).toEqual([node("a", { x: 2 })]);
    expect(merged.nodes?.remove).toEqual(["b"]);
  });
});

describe("integrity", () => {
  it("removing a node removes its connectors, frees its children and unpins comments", () => {
    const doc = sample();
    const patch = withIntegrity(doc, { nodes: { remove: ["a", "group"] } });
    const next = applyPatch(doc, patch).doc;
    expect(next.edges.e1).toBeUndefined();
    expect(next.edges.e2).toBeDefined();
    expect(next.nodes.c.parent).toBeUndefined();
    expect(next.comments.c1.target).toBeUndefined();
  });

  it("cascading removal takes everything inside a container", () => {
    const doc = sample();
    const next = applyPatch(doc, removalPatch(doc, ["group"])).doc;
    expect(next.nodes.c).toBeUndefined();
    expect(next.edges.e2).toBeUndefined();
    expect(Object.keys(next.nodes).sort()).toEqual(["a", "b"]);
  });

  it("one undo brings back the node and everything that went with it", () => {
    const doc = sample();
    const removed = applyPatch(doc, removalPatch(doc, ["a"]));
    const restored = applyPatch(removed.doc, removed.inverse).doc;
    expect(restored.nodes).toEqual(doc.nodes);
    expect(restored.edges).toEqual(doc.edges);
    expect(restored.comments).toEqual(doc.comments);
  });
});

describe("patch validation", () => {
  it("accepts a well-formed patch and normalises colours", () => {
    const parsed = parsePatch({ nodes: { set: [{ ...node("a"), style: { fill: "#ABC" } }] } });
    expect(parsed.nodes?.set?.[0].style?.fill).toBe("#aabbcc");
  });

  it("rejects unsafe ids, absurd sizes and invalid colours", () => {
    expect(() => parsePatch({ nodes: { set: [node("../etc/passwd")] } })).toThrow();
    expect(() => parsePatch({ nodes: { set: [node("a", { w: Number.POSITIVE_INFINITY })] } })).toThrow();
    expect(() => parsePatch({ nodes: { set: [{ ...node("a"), style: { fill: "javascript:alert(1)" } }] } })).toThrow();
  });
});
