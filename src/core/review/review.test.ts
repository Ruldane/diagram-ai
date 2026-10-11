import { describe, expect, it } from "vitest";

import { createDoc } from "../model/defaults";
import { removalPatch } from "../model/integrity";
import { applyPatch } from "../model/patch";
import type { DComment, DEdge, DiagramDoc, DNode, Patch } from "../model/types";
import { acceptIntoBase, changeLabel, describeFields, diffForReview, revertPatch } from "./index";

const node = (id: string, extra: Partial<DNode> = {}): DNode => ({ id, shape: "basic/rect", x: 0, y: 0, w: 100, h: 50, z: 1, text: id, ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<DEdge> = {}): DEdge => ({
  id,
  from: { node: from },
  to: { node: to },
  routing: "orthogonal",
  ...extra,
});
const comment = (id: string, target?: string, extra: Partial<DComment> = {}): DComment => ({
  id,
  target,
  x: 0,
  y: 0,
  author: { kind: "human", id: "u", name: "You" },
  text: "Check this",
  createdAt: "2026-01-01T00:00:00.000Z",
  replies: [],
  ...extra,
});

/** a → b, a container `box` holding `inner`, a comment on `a`. */
function baseDoc(): DiagramDoc {
  return applyPatch(createDoc({ id: "d1", name: "Review test" }), {
    nodes: { set: [node("a"), node("b", { x: 200 }), node("box", { shape: "basic/frame", w: 400, h: 300, y: 200 }), node("inner", { parent: "box", y: 220 })] },
    edges: { set: [edge("e-ab", "a", "b"), edge("e-b-inner", "b", "inner")] },
    comments: { set: [comment("c-a", "a")] },
  }).doc;
}

const apply = (doc: DiagramDoc, patch: Patch): DiagramDoc => applyPatch(doc, patch).doc;
const kinds = (doc: DiagramDoc, base: DiagramDoc) => diffForReview(base, doc).changes.map((c) => `${c.kind}:${c.id}`).sort();

describe("diffForReview", () => {
  it("is empty for identical content, whatever the identities", () => {
    const base = baseDoc();
    const copy = JSON.parse(JSON.stringify(base)) as DiagramDoc;
    expect(diffForReview(base, copy).changes).toEqual([]);
  });

  it("treats an undefined property like a missing one", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [{ ...base.nodes.a, parent: undefined, note: undefined }] } });
    expect(diffForReview(base, current).changes).toEqual([]);
  });

  it("classifies added, removed and modified elements", () => {
    const base = baseDoc();
    const edited = apply(base, { nodes: { set: [node("n1"), { ...base.nodes.b, text: "Renamed" }] }, edges: { set: [edge("e-new", "a", "n1")] } });
    const current = apply(edited, removalPatch(edited, ["e-ab"]));
    const diff = diffForReview(base, current);
    expect(kinds(current, base)).toEqual(["added:e-new", "added:n1", "modified:b", "removed:e-ab"]);
    expect(diff.byId.get("b")?.fields).toEqual(["text"]);
    expect(diff.counts).toEqual({ added: 2, removed: 1, modified: 1, layout: 0, rows: 4 });
  });

  it("separates changes that only affect position, size or route", () => {
    const base = baseDoc();
    const current = apply(base, {
      nodes: { set: [{ ...base.nodes.a, x: 50, y: 20, w: 120, rotation: 15 }, { ...base.nodes.b, x: 260, text: "Moved and renamed" }] },
      edges: { set: [{ ...base.edges["e-ab"], waypoints: [{ x: 5, y: 5 }], autoRoute: true, from: { node: "a", anchor: { x: 1, y: 0.5 } } }] },
    });
    const diff = diffForReview(base, current);
    expect(diff.byId.get("a")).toMatchObject({ kind: "layout" });
    expect(diff.byId.get("e-ab")).toMatchObject({ kind: "layout" });
    expect(diff.byId.get("b")).toMatchObject({ kind: "modified" });
    expect(diff.byId.get("b")?.fields).toEqual(expect.arrayContaining(["x", "text"]));
    // Two layout changes fold into one row.
    expect(diff.counts).toMatchObject({ layout: 2, modified: 1, rows: 2 });
  });

  it("reports style sub-fields and re-attached connector ends", () => {
    const base = baseDoc();
    const current = apply(base, {
      nodes: { set: [{ ...base.nodes.a, style: { fill: "#ff0000" } }] },
      edges: { set: [{ ...base.edges["e-ab"], to: { node: "inner" } }] },
    });
    const diff = diffForReview(base, current);
    expect(diff.byId.get("a")?.fields).toEqual(["style.fill"]);
    expect(diff.byId.get("e-ab")).toMatchObject({ kind: "modified", fields: ["to.node"] });
  });

  it("includes comments: added, removed, resolved and replied to", () => {
    const base = apply(baseDoc(), { comments: { set: [comment("c-gone"), comment("c-open"), comment("c-talk")] } });
    const reply = { id: "r1", author: { kind: "agent" as const, id: "claude", name: "Claude" }, text: "Done", createdAt: "2026-01-02T00:00:00.000Z" };
    const current = apply(base, {
      comments: { remove: ["c-gone"], set: [comment("c-new", "b"), { ...base.comments["c-open"], resolved: true }, { ...base.comments["c-talk"], replies: [reply] }] },
    });
    expect(kinds(current, base)).toEqual(["added:c-new", "modified:c-open", "modified:c-talk", "removed:c-gone"]);
    expect(diffForReview(base, current).byId.get("c-open")?.fields).toEqual(["resolved"]);
  });

  it("names elements and fields for people", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [{ ...base.nodes.a, text: "Gateway", style: { fill: "#ff0000" } }] } });
    const diff = diffForReview(base, current);
    expect(changeLabel(diff.byId.get("a")!, base, current)).toBe("Gateway");
    expect(describeFields(diff.byId.get("a")!.fields)).toBe("text, fill");
    const removed = apply(base, removalPatch(base, ["e-ab"]));
    expect(changeLabel(diffForReview(base, removed).byId.get("e-ab")!, base, removed)).toBe("a → b");
  });
});

describe("revertPatch", () => {
  it("removes an added node together with the connectors attached to it", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [node("n1")] }, edges: { set: [edge("e1", "a", "n1"), edge("e2", "n1", "b")] } });
    const patch = revertPatch(base, current, ["n1"]);
    expect(patch.nodes?.remove).toEqual(["n1"]);
    expect(patch.edges?.remove?.sort()).toEqual(["e1", "e2"]);
    expect(apply(current, patch)).toMatchObject({ nodes: base.nodes, edges: base.edges });
  });

  it("re-attaches a connector that existed before to its old ends instead of deleting it", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [node("n1")] }, edges: { set: [{ ...base.edges["e-ab"], to: { node: "n1" } }] } });
    const next = apply(current, revertPatch(base, current, ["n1"]));
    expect(next.edges["e-ab"]).toEqual(base.edges["e-ab"]);
    expect(next.nodes.n1).toBeUndefined();
  });

  it("restores a removed node with its connectors", () => {
    const base = baseDoc();
    const current = apply(base, removalPatch(base, ["b"]));
    expect(Object.keys(current.edges)).toEqual([]);
    const next = apply(current, revertPatch(base, current, ["b"]));
    expect(next.nodes.b).toEqual(base.nodes.b);
    expect(next.edges).toEqual(base.edges);
  });

  it("restores a removed container before the node that sits in it", () => {
    const base = baseDoc();
    // Release the child, remove its container: the child now floats free.
    const current = apply(base, removalPatch(base, ["box"], false));
    expect(current.nodes.inner.parent).toBeUndefined();
    const patch = revertPatch(base, current, ["inner"]);
    expect(patch.nodes?.set?.map((n) => n.id).sort()).toEqual(["box", "inner"]);
    const next = apply(current, patch);
    expect(next.nodes.box).toEqual(base.nodes.box);
    expect(next.nodes.inner).toEqual(base.nodes.inner);
  });

  it("does not leave a restored connector dangling when its other end stays removed", () => {
    const base = baseDoc();
    const current = apply(base, removalPatch(base, ["a", "b"]));
    const next = apply(current, revertPatch(base, current, ["a"]));
    expect(next.nodes.a).toBeDefined();
    expect(next.nodes.b).toBeUndefined();
    expect(next.edges["e-ab"]).toBeUndefined();
    // Restoring the other end brings the connector with it.
    const both = apply(next, revertPatch(base, next, ["b"]));
    expect(both.edges["e-ab"]).toEqual(base.edges["e-ab"]);
  });

  it("brings back the nodes a changed connector was attached to", () => {
    const base = baseDoc();
    const moved = apply(base, { edges: { set: [{ ...base.edges["e-ab"], to: { node: "inner" } }] } });
    const current = apply(moved, removalPatch(moved, ["b"]));
    const next = apply(current, revertPatch(base, current, ["e-ab"]));
    expect(next.edges["e-ab"]).toEqual(base.edges["e-ab"]);
    expect(next.nodes.b).toEqual(base.nodes.b);
  });

  it("reverts a modified element to its previous version, including what a person changed afterwards", () => {
    const base = baseDoc();
    const byAgent = apply(base, { nodes: { set: [{ ...base.nodes.a, text: "Gateway" }] } });
    const current = apply(byAgent, { nodes: { set: [{ ...byAgent.nodes.a, x: 77 }] } });
    const next = apply(current, revertPatch(base, current, ["a"]));
    expect(next.nodes.a).toEqual(base.nodes.a);
  });

  it("puts the children of a rejected container back where they were", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [node("group", { shape: "basic/frame", w: 300, h: 200 }), { ...base.nodes.a, parent: "group" }] } });
    const next = apply(current, revertPatch(base, current, ["group"]));
    expect(next.nodes.group).toBeUndefined();
    expect(next.nodes.a).toEqual(base.nodes.a);
  });

  it("ignores ids that are not part of the difference and reverts only what was asked for", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [node("n1"), { ...base.nodes.a, text: "Changed" }] } });
    expect(revertPatch(base, current, ["b", "nope"])).toEqual({});
    const next = apply(current, revertPatch(base, current, ["n1"]));
    expect(next.nodes.n1).toBeUndefined();
    expect(next.nodes.a.text).toBe("Changed");
  });

  it("returns a patch whose inverse puts the agent's version back (undo)", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [node("n1"), { ...base.nodes.a, text: "Changed" }] }, edges: { set: [edge("e1", "a", "n1")] } });
    const reverted = applyPatch(current, revertPatch(base, current, ["n1", "a"]));
    const undone = applyPatch(reverted.doc, reverted.inverse).doc;
    expect(undone.nodes).toEqual(current.nodes);
    expect(undone.edges).toEqual(current.edges);
  });

  it("restores comments and the element they were pinned to", () => {
    const base = baseDoc();
    // Removing `a` unpins its comment; the agent also resolved it.
    const unpinned = apply(base, removalPatch(base, ["a"]));
    const current = apply(unpinned, { comments: { set: [{ ...unpinned.comments["c-a"], resolved: true }] } });
    const next = apply(current, revertPatch(base, current, ["c-a"]));
    expect(next.comments["c-a"]).toEqual(base.comments["c-a"]);
    expect(next.nodes.a).toEqual(base.nodes.a);
  });
});

describe("round trip", () => {
  it("diff → revert everything → diff is empty, and the document equals the baseline", () => {
    const base = apply(baseDoc(), { comments: { set: [comment("c-b", "b"), comment("c-loose")] } });
    let current = base;
    // An agent session: add, rewire, restyle, move, delete, comment.
    current = apply(current, { nodes: { set: [node("n1", { parent: "box" }), node("n2", { x: 500 })] }, edges: { set: [edge("e-new1", "a", "n1"), edge("e-new2", "n1", "n2")] } });
    current = apply(current, { edges: { set: [{ ...current.edges["e-ab"], to: { node: "n2" } }] } });
    current = apply(current, { nodes: { set: [{ ...current.nodes.a, x: 33, text: "Gateway", style: { fill: "#00ff00" } }, { ...current.nodes.inner, x: 999 }] } });
    current = apply(current, removalPatch(current, ["b"]));
    current = apply(current, removalPatch(current, ["box"], false));
    current = apply(current, { comments: { set: [{ ...current.comments["c-loose"], resolved: true }, comment("c-agent", "n1")], remove: [] } });

    const diff = diffForReview(base, current);
    expect(diff.changes.length).toBeGreaterThan(8);

    const next = apply(current, revertPatch(base, current, diff.changes.map((c) => c.id)));
    expect(diffForReview(base, next).changes).toEqual([]);
    expect(next.nodes).toEqual(base.nodes);
    expect(next.edges).toEqual(base.edges);
    expect(next.comments).toEqual(base.comments);
  });

  it("every single change can be rejected on its own without breaking integrity", () => {
    const base = baseDoc();
    let current = apply(base, { nodes: { set: [node("n1"), { ...base.nodes.a, text: "Changed" }] }, edges: { set: [edge("e1", "a", "n1")] } });
    current = apply(current, removalPatch(current, ["b"]));
    const ids = diffForReview(base, current).changes.map((c) => c.id);
    for (const id of ids) {
      const next = apply(current, revertPatch(base, current, [id]));
      for (const e of Object.values(next.edges)) {
        for (const end of [e.from.node, e.to.node]) if (end) expect(next.nodes[end], `${id}: ${e.id} → ${end}`).toBeDefined();
      }
      for (const n of Object.values(next.nodes)) if (n.parent) expect(next.nodes[n.parent], `${id}: ${n.id} parent`).toBeDefined();
    }
  });
});

describe("acceptIntoBase", () => {
  const session = () => {
    const base = baseDoc();
    const current = apply(base, {
      nodes: { set: [node("n1"), node("n2", { x: 400 }), { ...base.nodes.a, text: "Gateway" }] },
      edges: { set: [edge("e1", "a", "n1"), edge("e2", "n1", "n2")] },
      comments: { set: [comment("c-new", "n1")] },
    });
    return { base, current };
  };

  it("accepting everything leaves nothing to review", () => {
    const { base, current } = session();
    const result = acceptIntoBase(base, current, "all");
    expect(result.remaining.changes).toEqual([]);
    expect(result.base.nodes).toBe(current.nodes);
  });

  it("accepting some elements keeps the rest pending", () => {
    const { base, current } = session();
    const result = acceptIntoBase(base, current, ["a"]);
    expect(result.accepted).toEqual(["a"]);
    expect(result.base.nodes.a).toBe(current.nodes.a);
    expect(result.remaining.changes.map((c) => c.id).sort()).toEqual(["c-new", "e1", "e2", "n1", "n2"]);
    // The live document is untouched by accepting, and the baseline stays a valid diagram.
    expect(result.base.nodes.n1).toBeUndefined();
  });

  it("accepting a connector takes the new nodes it needs", () => {
    const { base, current } = session();
    const result = acceptIntoBase(base, current, ["e2"]);
    expect(result.accepted.sort()).toEqual(["e2", "n1", "n2"]);
    expect(result.base.nodes.n1).toBe(current.nodes.n1);
    expect(result.remaining.changes.map((c) => c.id).sort()).toEqual(["a", "c-new", "e1"]);
  });

  it("accepting a comment takes the element it is pinned to", () => {
    const { base, current } = session();
    const result = acceptIntoBase(base, current, ["c-new"]);
    expect(result.accepted.sort()).toEqual(["c-new", "n1"]);
  });

  it("accepting a new node takes the container it sits in", () => {
    const base = baseDoc();
    const current = apply(base, { nodes: { set: [node("g", { shape: "basic/frame" }), node("kid", { parent: "g" })] } });
    expect(acceptIntoBase(base, current, ["kid"]).accepted.sort()).toEqual(["g", "kid"]);
  });

  it("accepting a removed container takes the changes that detached what was inside it", () => {
    const base = baseDoc();
    const current = apply(base, removalPatch(base, ["box"], false));
    const result = acceptIntoBase(base, current, ["box"]);
    expect(result.accepted.sort()).toEqual(["box", "inner"]);
    expect(result.remaining.changes).toEqual([]);
  });

  it("accepting then rejecting the rest leaves accepted work in place", () => {
    const { base, current } = session();
    const { base: moved, remaining } = acceptIntoBase(base, current, ["a", "n1", "e1"]);
    const next = apply(current, revertPatch(moved, current, remaining.changes.map((c) => c.id)));
    expect(next.nodes.a.text).toBe("Gateway");
    expect(next.nodes.n1).toBeDefined();
    expect(next.edges.e1).toBeDefined();
    expect(next.nodes.n2).toBeUndefined();
    expect(next.edges.e2).toBeUndefined();
    expect(next.comments["c-new"]).toBeUndefined();
  });

  it("ignores ids that are not part of the difference", () => {
    const { base, current } = session();
    const result = acceptIntoBase(base, current, ["b", "nope"]);
    expect(result.accepted).toEqual([]);
    expect(result.remaining.changes.length).toBe(diffForReview(base, current).changes.length);
  });
});
