import { describe, expect, it } from "vitest";

import { loadElk } from "../layout/engine";
import { createDoc } from "../model/defaults";
import { applyPatch } from "../model/patch";
import { boundsOfNodes } from "../model/queries";
import type { DiagramDoc, DNode, Patch } from "../model/types";
import { importMermaid, exportMermaid } from "../io/mermaid";
import { planCodeApply, type CodeApplyMode, type CodePlan, type CodePlanOptions } from "./apply";
import { CODE_EXAMPLES } from "./examples";
import { generateCode, generateMermaid } from "./generate";
import { placePlan } from "./layout";
import { parseCode } from "./parse";
import type { CodeLanguage } from "./types";

/* ------------------------------------------------------------------ helpers */

const empty = (): DiagramDoc => createDoc({ id: "doc", name: "Diagram", type: "blank" }, new Date(0));

interface Applied {
  doc: DiagramDoc;
  plan: CodePlan;
  patch: Patch;
}

/** Parses text, plans it, lays out what is new and applies the single patch. */
async function apply(doc: DiagramDoc, text: string, mode: CodeApplyMode = "replace", language: CodeLanguage = "mermaid", options?: CodePlanOptions): Promise<Applied> {
  const plan = planCodeApply(doc, parseCode(language, text).imported, mode, options);
  const patch = await placePlan(plan, await loadElk());
  return { doc: applyPatch(doc, patch).doc, plan, patch };
}

const node = (doc: DiagramDoc, id: string): DNode => {
  const found = doc.nodes[id];
  if (!found) throw new Error(`no node "${id}" in ${Object.keys(doc.nodes).join(", ")}`);
  return found;
};

const edgesBetween = (doc: DiagramDoc, from: string, to: string) => Object.values(doc.edges).filter((e) => e.from.node === from && e.to.node === to);

const overlaps = (doc: DiagramDoc): string[] => {
  const nodes = Object.values(doc.nodes).filter((n) => !n.parent);
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id}/${b.id}`);
    }
  }
  return out;
};

const FLOW = `flowchart TD
  A[Start] --> B{Valid?}
  B -->|yes| C[Done]
  B -->|no| D[Fix]
  D --> A`;

/* ------------------------------------------------------------------ replace */

describe("planCodeApply: replace", () => {
  it("fills an empty canvas: adopts the diagram type, lays everything out, marks it auto-laid-out", async () => {
    const { doc, plan } = await apply(empty(), FLOW);
    expect(doc.type).toBe("flowchart");
    expect(Object.keys(doc.nodes).sort()).toEqual(["A", "B", "C", "D"]);
    expect(Object.keys(doc.edges)).toHaveLength(4);
    expect(plan.placement.strategy).toBe("full");
    expect(doc.settings.autoLayout).toBe(true);
    expect(plan.created.nodes.sort()).toEqual(["A", "B", "C", "D"]);
    expect(plan.removed.nodes).toEqual([]);
    expect(overlaps(doc)).toEqual([]);
    // Laid out in the flowchart's direction: A above B.
    expect(node(doc, "A").y).toBeLessThan(node(doc, "B").y);
  });

  it("keeps position, size and style of nodes the text still names; changes only what the text says", async () => {
    const first = await apply(empty(), FLOW);
    // A person moves, resizes and colours things by hand.
    const moved: DNode = { ...node(first.doc, "C"), x: 900, y: 40, w: 220, style: { fill: "#ffe2df", stroke: "#e03131" } };
    const hand = applyPatch(first.doc, { nodes: { set: [moved] }, doc: { settings: { autoLayout: false } } }).doc;

    const next = await apply(
      hand,
      `flowchart TD
  A[Start] --> B{Valid?}
  B -->|yes| C[All done]
  B -->|no| D[Fix]
  D --> A
  C --> E[Archive]`,
    );

    const c = node(next.doc, "C");
    expect(c).toMatchObject({ x: 900, y: 40, text: "All done", style: { fill: "#ffe2df", stroke: "#e03131" } });
    expect(c.w).toBeGreaterThanOrEqual(220);
    // Untouched nodes are not in the patch at all.
    expect(next.patch.nodes?.set?.map((n) => n.id).sort()).toEqual(["C", "E"]);
    expect(next.plan.created.nodes).toEqual(["E"]);
    expect(next.plan.updated.nodes).toEqual(["C"]);
    // The new node lands next to the node it connects to, not on top of anything.
    expect(next.plan.placement.strategy).toBe("near");
    expect(overlaps(next.doc)).toEqual([]);
    expect(node(next.doc, "E").y).toBeGreaterThan(node(next.doc, "C").y);
    // Hand-tuned diagrams stay hand-tuned.
    expect(next.doc.settings.autoLayout).toBe(false);
  });

  it("removes what the text no longer mentions, with its connectors", async () => {
    const first = await apply(empty(), FLOW);
    const next = await apply(first.doc, "flowchart TD\n  A[Start] --> B{Valid?}\n  B -->|yes| C[Done]");
    expect(Object.keys(next.doc.nodes).sort()).toEqual(["A", "B", "C"]);
    expect(next.plan.removed.nodes).toEqual(["D"]);
    expect(Object.keys(next.doc.edges)).toHaveLength(2);
    expect(next.doc.nodes["D"]).toBeUndefined();
  });

  it("keeps connector identity, route and colour, and clears a label the text dropped", async () => {
    const first = await apply(empty(), FLOW);
    const [edge] = edgesBetween(first.doc, "B", "C");
    expect(edge.text).toBe("yes");
    const coloured = applyPatch(first.doc, { edges: { set: [{ ...edge, style: { ...edge.style, stroke: "#2f6fed" }, note: "keep me" }] } }).doc;

    const next = await apply(coloured, FLOW.replace("B -->|yes| C[Done]", "B --> C[Done]"));
    const [after] = edgesBetween(next.doc, "B", "C");
    expect(after.id).toBe(edge.id);
    expect(after.text).toBeUndefined();
    expect(after.style?.stroke).toBe("#2f6fed");
    expect(after.note).toBe("keep me");
    expect(after.waypoints).toEqual(edge.waypoints);
  });

  it("changes a connector's arrow when the text says so", async () => {
    const first = await apply(empty(), "flowchart TD\n  A --> B");
    const next = await apply(first.doc, "flowchart TD\n  A -.-> B");
    const [edge] = edgesBetween(next.doc, "A", "B");
    expect(edge.style?.dash).toBe("dashed");
    expect(Object.keys(next.doc.edges)).toHaveLength(1);
  });

  it("does nothing when the text changes nothing (a no-op is not an undo step)", async () => {
    const first = await apply(empty(), FLOW);
    const again = await apply(first.doc, FLOW);
    expect(again.patch).toEqual({});
    expect(again.plan.placement.strategy).toBe("none");
    // Even a comment or reordered whitespace is a no-op.
    const reflowed = await apply(first.doc, `%% note\n${FLOW.replace(/\n {2}/g, "\n      ")}`);
    expect(reflowed.patch).toEqual({});
  });

  it("re-flows everything when the text changes the direction", async () => {
    const first = await apply(empty(), FLOW);
    const next = await apply(first.doc, FLOW.replace("flowchart TD", "flowchart LR"));
    expect(next.doc.settings.layout.direction).toBe("right");
    expect(next.plan.placement.strategy).toBe("full");
    expect(node(next.doc, "A").x).toBeLessThan(node(next.doc, "B").x);
  });

  it("with a managed set, leaves everything outside it alone", async () => {
    const first = await apply(empty(), "flowchart TD\n  A --> B");
    const handDrawn: DNode = { id: "mine", shape: "basic/rounded", x: 500, y: 500, w: 100, h: 50, z: 99, text: "Mine" };
    const withHand = applyPatch(first.doc, { nodes: { set: [handDrawn] } }).doc;

    const live = await apply(withHand, "flowchart TD\n  A --> C", "replace", "mermaid", { managed: new Set(["A", "B"]) });
    expect(Object.keys(live.doc.nodes).sort()).toEqual(["A", "C", "mine"]);
    expect(live.doc.nodes["mine"]).toEqual(handDrawn);

    const full = await apply(withHand, "flowchart TD\n  A --> C");
    expect(Object.keys(full.doc.nodes).sort()).toEqual(["A", "C"]);
  });

  it("lets a group release a node the text no longer puts in it, but not one a person framed", async () => {
    const first = await apply(empty(), "flowchart TD\n  subgraph g [Group]\n    A --> B\n  end");
    expect(node(first.doc, "A").parent).toBe("g");
    const next = await apply(first.doc, "flowchart TD\n  subgraph g [Group]\n    B\n  end\n  A --> B");
    expect(node(next.doc, "A").parent).toBeUndefined();
    expect(node(next.doc, "B").parent).toBe("g");

    const frame: DNode = { id: "frame", shape: "basic/frame", x: -50, y: -50, w: 600, h: 600, z: -3, text: "Mine" };
    const framed = applyPatch(next.doc, { nodes: { set: [frame, { ...node(next.doc, "A"), parent: "frame" }] } }).doc;
    const again = await apply(framed, "flowchart TD\n  A --> B", "replace", "mermaid", { managed: new Set(["A", "B", "g"]) });
    expect(node(again.doc, "A").parent).toBe("frame");
  });
});

/* ----------------------------------------------------------------- insert */

describe("planCodeApply: insert beside", () => {
  it("adds the text to the right of the existing content under fresh ids, without touching it", async () => {
    const first = await apply(empty(), FLOW);
    const before = boundsOfNodes(Object.values(first.doc.nodes))!;
    const next = await apply(first.doc, "flowchart TD\n  A[Other start] --> X[Other end]", "insert");

    // Same node ids in the text, new ids on the canvas.
    expect(Object.keys(next.doc.nodes).sort()).toEqual(["A", "A-2", "B", "C", "D", "X"]);
    expect(node(next.doc, "A")).toEqual(node(first.doc, "A"));
    expect(node(next.doc, "A-2").text).toBe("Other start");
    expect(edgesBetween(next.doc, "A-2", "X")).toHaveLength(1);
    for (const id of ["A-2", "X"]) expect(node(next.doc, id).x).toBeGreaterThanOrEqual(before.x + before.w);
    expect(next.plan.removed.nodes).toEqual([]);
    expect(Object.keys(first.doc.edges).every((id) => id in next.doc.edges)).toBe(true);
    expect(overlaps(next.doc)).toEqual([]);
  });

  it("keeps the diagram's type and settings", async () => {
    const base = applyPatch(empty(), { doc: { type: "uml-class" } }).doc;
    const first = await apply(base, "flowchart TD\n  A --> B", "insert");
    expect(first.doc.type).toBe("uml-class");
    expect(first.patch.doc).toBeUndefined();
  });

  it("is one patch", async () => {
    const first = await apply(empty(), FLOW);
    const { patch } = await apply(first.doc, "flowchart TD\n  P --> Q --> R", "insert");
    expect(patch.nodes?.set).toHaveLength(3);
    expect(patch.edges?.set).toHaveLength(2);
  });
});

/* --------------------------------------------------------------- sequence */

describe("planCodeApply: sequence diagrams", () => {
  const SEQ = `sequenceDiagram
  actor User
  participant Web
  participant API
  User->>Web: open
  Web->>API: fetch
  API-->>Web: rows`;

  it("builds lifelines and messages, not auto-laid-out, adopting the sequence type", async () => {
    const { doc, plan } = await apply(empty(), SEQ);
    expect(doc.type).toBe("uml-sequence");
    expect(Object.keys(doc.nodes).sort()).toEqual(["api", "user", "web"]);
    expect(Object.keys(doc.edges)).toHaveLength(3);
    expect(doc.settings.autoLayout).toBe(false);
    expect(plan.placement.strategy).toBe("none");
    expect(node(doc, "user").shape).toBe("uml/actor-lifeline");
  });

  it("keeps lifeline styling and connector ids across edits", async () => {
    const first = await apply(empty(), SEQ);
    const styled = applyPatch(first.doc, { nodes: { set: [{ ...node(first.doc, "web"), style: { fill: "#e5efff" }, note: "front door" }] } }).doc;
    const [message] = edgesBetween(styled, "user", "web");

    const next = await apply(styled, `${SEQ}\n  Web->>User: done`);
    expect(node(next.doc, "web")).toMatchObject({ style: { fill: "#e5efff" }, note: "front door" });
    expect(next.doc.edges[message.id]).toBeDefined();
    expect(Object.keys(next.doc.edges)).toHaveLength(4);
    expect(Object.keys(next.doc.nodes).sort()).toEqual(["api", "user", "web"]);
  });

  it("is a no-op when the text is unchanged", async () => {
    const first = await apply(empty(), SEQ);
    const again = await apply(first.doc, SEQ);
    expect(again.patch).toEqual({});
  });

  it("removes participants that disappeared", async () => {
    const first = await apply(empty(), SEQ);
    const next = await apply(first.doc, "sequenceDiagram\n  User->>Web: only these two");
    expect(Object.keys(next.doc.nodes).sort()).toEqual(["user", "web"]);
    expect(Object.keys(next.doc.edges)).toHaveLength(1);
  });

  it("inserts beside existing content with fresh ids", async () => {
    const first = await apply(empty(), SEQ);
    const before = boundsOfNodes(Object.values(first.doc.nodes))!;
    const next = await apply(first.doc, SEQ, "insert");
    expect(Object.keys(next.doc.nodes)).toHaveLength(6);
    expect(Object.keys(next.doc.edges)).toHaveLength(6);
    expect(Object.keys(next.doc.nodes).sort()).toEqual(["api", "api-2", "user", "user-2", "web", "web-2"]);
    expect(node(next.doc, "user-2").x).toBeGreaterThan(before.x + before.w);
    expect(overlaps(next.doc)).toEqual([]);
  });

  it("replaces a flowchart wholesale when the canvas held one", async () => {
    const first = await apply(empty(), FLOW);
    const next = await apply(first.doc, SEQ);
    expect(Object.keys(next.doc.nodes).sort()).toEqual(["api", "user", "web"]);
    expect(next.doc.settings.autoLayout).toBe(false);
  });
});

/* -------------------------------------------------------------- plantuml */

describe("planCodeApply: PlantUML", () => {
  const CLASSES = `@startuml
class Order {
  + total(): Money
}
class Customer
Customer "1" --> "*" Order : places
@enduml`;

  it("builds a class diagram, adopting uml-class and its upward layout", async () => {
    const { doc } = await apply(empty(), CLASSES, "replace", "plantuml");
    expect(doc.type).toBe("uml-class");
    expect(doc.settings.layout.direction).toBe("up");
    const [edge] = Object.values(doc.edges);
    expect(edge).toMatchObject({ text: "places", startText: "1", endText: "*" });
    expect(edge.style).toMatchObject({ endMarker: "open-arrow" });
  });

  it("keeps hand-tuned positions when members are added", async () => {
    const first = await apply(empty(), CLASSES, "replace", "plantuml");
    const moved = applyPatch(first.doc, { nodes: { set: [{ ...node(first.doc, "Order"), x: 700, y: 300 }] } }).doc;
    const next = await apply(moved, CLASSES.replace("+ total(): Money", "+ total(): Money\n  + cancel(): void"), "replace", "plantuml");
    expect(node(next.doc, "Order")).toMatchObject({ x: 700, y: 300 });
    expect(node(next.doc, "Order").text).toContain("cancel");
    expect(node(next.doc, "Order").h).toBeGreaterThanOrEqual(node(moved, "Order").h);
  });

  it("builds an activity diagram with decisions", async () => {
    const { doc } = await apply(empty(), CODE_EXAMPLES.plantuml.find((e) => e.id === "activity")!.code, "replace", "plantuml");
    expect(doc.type).toBe("uml-activity");
    expect(Object.values(doc.nodes).some((n) => n.shape === "flowchart/decision")).toBe(true);
    expect(overlaps(doc)).toEqual([]);
  });
});

/* ------------------------------------------------------ generate and re-apply */

describe("generated text round-trips onto the diagram it came from", () => {
  it("applies back as a no-op, whatever the ids, shapes and markers are", async () => {
    const first = await apply(empty(), FLOW);
    // Hand edits Mermaid cannot express: ids with hyphens, a shape without a bracket, a custom arrow head.
    const renamed: DiagramDoc = {
      ...first.doc,
      nodes: Object.fromEntries(
        Object.values(first.doc.nodes).map((n, i) => {
          const id = i === 0 ? "check-input" : n.id;
          return [id, { ...n, id, ...(i === 1 ? { shape: "uml/class", text: "Klass" } : {}) }];
        }),
      ),
      edges: Object.fromEntries(
        Object.values(first.doc.edges).map((e) => {
          const from = e.from.node === "A" ? "check-input" : e.from.node;
          const to = e.to.node === "A" ? "check-input" : e.to.node;
          return [e.id, { ...e, from: { node: from }, to: { node: to }, style: { ...e.style, endMarker: "triangle" as const } }];
        }),
      ),
    };

    const generated = generateMermaid(renamed);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const again = await apply(renamed, generated.text);
    expect(again.patch).toEqual({});
  });

  it("offers text only for diagrams Mermaid can say", async () => {
    const flow = await apply(empty(), FLOW);
    expect(generateMermaid(flow.doc)).toMatchObject({ ok: true, kind: "flowchart" });

    const seq = await apply(empty(), "sequenceDiagram\n  A->>B: hi");
    expect(generateMermaid(seq.doc)).toMatchObject({ ok: true, kind: "sequence" });

    const classes = await apply(empty(), "@startuml\nclass A\nclass B\nA --|> B\n@enduml", "replace", "plantuml");
    const refused = generateMermaid(classes.doc);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toMatch(/flowcharts and sequence diagrams/);
      expect(importMermaid(refused.example).spec.nodes?.length).toBeGreaterThan(0);
    }
  });

  it("exports something the importer reads back for a freshly generated flowchart", async () => {
    const flow = await apply(empty(), FLOW);
    expect(importMermaid(exportMermaid(flow.doc)).spec.nodes).toHaveLength(4);
  });
});

/* ---------------------------------------------------------------- parseCode */

describe("parseCode", () => {
  it("points at the lines Mermaid could not read", () => {
    const parsed = parseCode("mermaid", "flowchart TD\n  A --> B\n  this is not valid\n\n  B --> C\n  C[unclosed --> D");
    expect(parsed.counts).toMatchObject({ nodes: 3, connectors: 2 });
    expect(parsed.diagnostics).toEqual([
      { line: 3, severity: "error", message: "Could not be understood: this is not valid" },
      { line: 6, severity: "error", message: "Could not be understood: C[unclosed --> D" },
    ]);
    expect(parsed.hasErrors).toBe(true);
    expect(parsed.empty).toBe(false);
  });

  it("keeps line numbers across front matter and init directives", () => {
    const parsed = parseCode("mermaid", "---\ntitle: x\n---\n%%{init: {\"theme\": \"dark\"}}%%\nflowchart TD\n  A --> B\n  nonsense here");
    expect(parsed.diagnostics.map((d) => d.line)).toEqual([7]);
  });

  it("flags unsupported diagram types on the header line", () => {
    const parsed = parseCode("mermaid", "\n%% comment\npie title Pets\n  \"Dogs\" : 5");
    expect(parsed.empty).toBe(true);
    expect(parsed.hasErrors).toBe(true);
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ line: 3, severity: "error" })]);
  });

  it("marks skipped sequence statements as warnings per line", () => {
    const parsed = parseCode("mermaid", "sequenceDiagram\n  A->>B: hi\n  Note over A,B: hello\n  loop retry\n    B->>A: again\n  end");
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.diagnostics.map((d) => [d.line, d.severity])).toEqual([
      [3, "warning"],
      [4, "warning"],
    ]);
  });

  it("treats empty text as empty, not as an error", () => {
    for (const language of ["mermaid", "plantuml"] as const) {
      const parsed = parseCode(language, "   \n");
      expect(parsed.empty).toBe(true);
      expect(parsed.hasErrors).toBe(false);
    }
  });

  it("reads PlantUML with the same result shape", () => {
    const parsed = parseCode("plantuml", "@startuml\nA -> B : hi\noops this\n@enduml");
    expect(parsed.counts).toMatchObject({ participants: 2, messages: 1 });
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ line: 3, severity: "error" })]);
  });

  it("handles large text without blowing up", () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `  n${i} --> n${i + 1}`);
    const started = Date.now();
    const parsed = parseCode("mermaid", `flowchart TD\n${lines.join("\n")}`);
    expect(parsed.counts.nodes).toBe(2501);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

/* ----------------------------------------------------------------- examples */

describe("code examples", () => {
  for (const language of ["mermaid", "plantuml"] as const) {
    for (const example of CODE_EXAMPLES[language]) {
      it(`${language}: ${example.title} reads cleanly and applies`, async () => {
        const parsed = parseCode(language, example.code);
        expect(parsed.warnings).toEqual([]);
        expect(parsed.diagnostics).toEqual([]);
        expect(parsed.empty).toBe(false);
        const { doc } = await apply(empty(), example.code, "replace", language);
        expect(Object.keys(doc.nodes).length).toBeGreaterThan(2);
        expect(overlaps(doc)).toEqual([]);
      });
    }
  }
});

describe("generateCode", () => {
  it("writes the same canvas in either language, and says why when one cannot", async () => {
    const { doc } = await apply(empty(), FLOW);
    const mermaid = generateCode(doc, "mermaid");
    const plantuml = generateCode(doc, "plantuml");
    expect(mermaid.ok).toBe(true);
    // A flowchart's decisions and terminators are not PlantUML activity or structure shapes.
    expect(plantuml.ok).toBe(false);
    if (!plantuml.ok) expect(plantuml.reason).toMatch(/PlantUML/);

    const classes = await apply(empty(), "@startuml\nclass A\nclass B\nA --|> B\n@enduml", "replace", "plantuml");
    expect(generateCode(classes.doc, "mermaid").ok).toBe(false);
    const text = generateCode(classes.doc, "plantuml");
    expect(text.ok && text.kind).toBe("class");
  });
});
