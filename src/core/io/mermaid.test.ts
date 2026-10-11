import { describe, expect, it } from "vitest";

import { createDoc } from "../model/defaults";
import { applyPatch } from "../model/patch";
import type { DEdge, DiagramDoc, DNode, DocSettings } from "../model/types";
import { applySpec, type EdgeSpec, type NodeSpec } from "../spec/apply";
import { buildSequence } from "../spec/sequence";
import { exportMermaid, importMermaid } from "./mermaid";

function makeDoc(nodes: DNode[], edges: DEdge[], settings: Partial<DocSettings> = {}): DiagramDoc {
  const doc = createDoc({ id: "doc1", name: "Order flow", settings }, new Date(0));
  return applyPatch(doc, { nodes: { set: nodes }, edges: { set: edges } }).doc;
}

const byId = (nodes: NodeSpec[] | undefined): Map<string, NodeSpec> => new Map((nodes ?? []).map((node) => [node.id!, node]));
const pairs = (edges: EdgeSpec[] | undefined): string[] => (edges ?? []).map((edge) => `${edge.from}>${edge.to}`);

/* --------------------------------------------------------- flowchart import */

describe("importMermaid: flowcharts", () => {
  it("reads nodes, shapes, chains and labels", () => {
    const result = importMermaid(`
      %% a comment
      flowchart LR
        A[Start here] --> B{Is it valid?}
        B -->|Yes| C(Process it) --> D([Done])
        B -- No --> E[(Audit log)]
        E -.-> F((Retry)); F ==> A
    `);
    expect(result.kind).toBe("flowchart");
    expect(result.direction).toBe("right");
    expect(result.warnings).toEqual([]);

    expect(result.spec.nodes).toEqual([
      { id: "A", shape: "flowchart/process", text: "Start here" },
      { id: "B", shape: "flowchart/decision", text: "Is it valid?" },
      { id: "C", shape: "basic/rounded", text: "Process it" },
      { id: "D", shape: "flowchart/terminator", text: "Done" },
      { id: "E", shape: "basic/cylinder", text: "Audit log" },
      { id: "F", shape: "basic/circle", text: "Retry" },
    ]);
    expect(result.spec.edges).toEqual([
      { from: "A", to: "B", kind: "flow" },
      { from: "B", to: "C", text: "Yes", kind: "flow" },
      { from: "C", to: "D", kind: "flow" },
      { from: "B", to: "E", text: "No", kind: "flow" },
      { from: "E", to: "F", kind: "dashed" },
      { from: "F", to: "A", kind: "flow", style: { strokeWidth: 3 } },
    ]);
    for (const node of result.spec.nodes!) {
      expect(node).not.toHaveProperty("x");
      expect(node).not.toHaveProperty("w");
    }
  });

  it("maps every bracket shape", () => {
    const shapes: [string, string][] = [
      ["a[text]", "flowchart/process"],
      ["b(text)", "basic/rounded"],
      ["c([text])", "flowchart/terminator"],
      ["d[[text]]", "flowchart/predefined-process"],
      ["e[(text)]", "basic/cylinder"],
      ["f((text))", "basic/circle"],
      ["g(((text)))", "basic/circle"],
      ["h{text}", "flowchart/decision"],
      ["i{{text}}", "basic/hexagon"],
      ["j[/text/]", "flowchart/data"],
      ["k[\\text\\]", "flowchart/data"],
      ["l[/text\\]", "basic/trapezoid"],
      ["m[\\text/]", "flowchart/manual-operation"],
      ["n>text]", "basic/chevron"],
      ["o", "flowchart/process"],
      ['p@{ shape: diamond, label: "text" }', "flowchart/decision"],
      ["q@{ shape: cyl }", "basic/cylinder"],
    ];
    const result = importMermaid(`graph TD\n${shapes.map(([source]) => source).join("\n")}`);
    expect(result.warnings).toEqual([]);
    expect(result.direction).toBe("down");
    expect(result.spec.nodes!.map((node) => node.shape)).toEqual(shapes.map(([, shape]) => shape));
    expect(result.spec.nodes!.map((node) => node.text)).toEqual([...Array(14).fill("text"), "o", "text", "q"]);
  });

  it("understands quoted text, line breaks, entities and markup", () => {
    const result = importMermaid(
      [
        "flowchart TB",
        '  A["Line one<br/>line (two) [x]"] --> B["Say #quot;hi#quot; &amp; #35;1"]',
        "  B --> C[Plain <b>bold</b><br>next]",
        '  C -- "a --> b; c" --> D["`**Markdown** text`"]',
        '  D -->|"piped | label"| E{"semi;colon"}; E --> A',
        "  path-1.b_2[/api/users] --> A",
      ].join("\n"),
    );
    expect(result.warnings).toEqual([]);
    const nodes = byId(result.spec.nodes);
    expect(nodes.get("A")!.text).toBe("Line one\nline (two) [x]");
    expect(nodes.get("B")!.text).toBe('Say "hi" & #1');
    expect(nodes.get("C")!.text).toBe("Plain bold\nnext");
    expect(nodes.get("D")!.text).toBe("**Markdown** text");
    expect(nodes.get("E")).toMatchObject({ shape: "flowchart/decision", text: "semi;colon" });
    // "[/…]" only opens a parallelogram when it also closes like one.
    expect(nodes.get("path-1.b_2")).toMatchObject({ shape: "flowchart/process", text: "/api/users" });
    expect(result.spec.edges!.map((edge) => edge.text)).toEqual([undefined, undefined, "a --> b; c", "piped | label", undefined, undefined]);
    expect(pairs(result.spec.edges)).toEqual(["A>B", "B>C", "C>D", "D>E", "E>A", "path-1.b_2>A"]);
  });

  it("reads every link variant", () => {
    const links: [string, Partial<EdgeSpec>][] = [
      ["A --> B", { kind: "flow" }],
      ["A ---> B", { kind: "flow" }],
      ["A --- B", { kind: "line" }],
      ["A ----- B", { kind: "line" }],
      ["A -.-> B", { kind: "dashed" }],
      ["A -..-> B", { kind: "dashed" }],
      ["A -.- B", { kind: "dotted" }],
      ["A ==> B", { kind: "flow", style: { strokeWidth: 3 } }],
      ["A === B", { kind: "line", style: { strokeWidth: 3 } }],
      ["A <--> B", { kind: "bidirectional" }],
      ["A --o B", { style: { startMarker: "none", endMarker: "circle", dash: "solid" } }],
      ["A --x B", { style: { startMarker: "none", endMarker: "cross", dash: "solid" } }],
      ["A o--o B", { style: { startMarker: "circle", endMarker: "circle", dash: "solid" } }],
      ["A x--x B", { style: { startMarker: "cross", endMarker: "cross", dash: "solid" } }],
      ["A <-.-> B", { style: { startMarker: "arrow", endMarker: "arrow", dash: "dashed" } }],
      ["A-->B", { kind: "flow" }],
      ["A-.->B", { kind: "dashed" }],
      ["A==>B", { kind: "flow", style: { strokeWidth: 3 } }],
      ["A -- text --> B", { kind: "flow", text: "text" }],
      ["A -- text --- B", { kind: "line", text: "text" }],
      ["A -. text .-> B", { kind: "dashed", text: "text" }],
      ["A == text ==> B", { kind: "flow", text: "text", style: { strokeWidth: 3 } }],
      ["A -->|text| B", { kind: "flow", text: "text" }],
      ["A---|text|B", { kind: "line", text: "text" }],
      ["A e1@--> B", { kind: "flow" }],
    ];
    const result = importMermaid(`flowchart TD\n${links.map(([source]) => source).join("\n")}`);
    expect(result.warnings).toEqual([]);
    expect(result.spec.nodes!.map((node) => node.id)).toEqual(["A", "B"]);
    expect(result.spec.edges).toEqual(links.map(([, expected]) => ({ from: "A", to: "B", ...expected })));
  });

  it("expands & groups and long chains", () => {
    const result = importMermaid("flowchart TD\n  A & B --> C & D --> E\n  X --> Y --> Z --> X");
    expect(pairs(result.spec.edges)).toEqual(["A>C", "A>D", "B>C", "B>D", "C>E", "D>E", "X>Y", "Y>Z", "Z>X"]);
  });

  it("turns subgraphs into nested group containers", () => {
    const result = importMermaid(`
      flowchart TB
        client[Browser] --> api
        subgraph backend [Back end]
          api[API] --> db[(Database)]
          subgraph workers ["Async workers"]
            direction LR
            w1[Mailer] --> w2[Indexer]
          end
          api --> w1
        end
        subgraph Third Party
          stripe[Stripe]
        end
        subgraph solo
        end
        api --> stripe
        backend --> solo
    `);
    expect(result.warnings).toEqual([]);
    const nodes = byId(result.spec.nodes);
    expect(nodes.get("backend")).toEqual({ id: "backend", shape: "basic/group", text: "Back end" });
    expect(nodes.get("workers")).toEqual({ id: "workers", shape: "basic/group", text: "Async workers", parent: "backend" });
    expect(nodes.get("subgraph-1")).toEqual({ id: "subgraph-1", shape: "basic/group", text: "Third Party" });
    expect(nodes.get("solo")).toMatchObject({ shape: "basic/group", text: "solo" });
    // "api" is first mentioned outside, but declared inside "backend".
    expect(nodes.get("api")).toMatchObject({ text: "API", parent: "backend" });
    expect(nodes.get("db")!.parent).toBe("backend");
    expect(nodes.get("w1")!.parent).toBe("workers");
    expect(nodes.get("w2")!.parent).toBe("workers");
    expect(nodes.get("stripe")!.parent).toBe("subgraph-1");
    expect(nodes.get("client")!.parent).toBeUndefined();
    expect(pairs(result.spec.edges)).toContain("backend>solo");

    // The spec applies cleanly: parents exist and are containers.
    const empty = createDoc({ id: "x" }, new Date(0));
    const applied = applySpec(empty, result.spec);
    expect(applied.warnings).toEqual([]);
    expect(applied.unplaced).toHaveLength(result.spec.nodes!.length);
    const doc = applyPatch(empty, applied.patch).doc;
    expect(doc.nodes.w1.parent).toBe("workers");
    expect(Object.keys(doc.edges)).toHaveLength(result.spec.edges!.length);
  });

  it("applies style and class colours and ignores interaction statements", () => {
    const result = importMermaid(`
      graph LR;
        A[One]:::warm --> B[Two];
        B --> C[Three]
        classDef warm fill:#f96,stroke:#333,stroke-width:4px,color:#fff;
        classDef default fill:#EEE
        class C warm
        style B fill:#bbf,stroke:#f66,stroke-width:2px,color:#000,stroke-dasharray: 5 5
        linkStyle 0 stroke:#ff3,stroke-width:4px
        click A callback "Tooltip"
        accTitle: My title
    `);
    expect(result.warnings).toEqual([]);
    const nodes = byId(result.spec.nodes);
    expect(nodes.get("A")!.style).toEqual({ fill: "#ff9966", stroke: "#333333", strokeWidth: 4, textColor: "#ffffff" });
    expect(nodes.get("B")!.style).toEqual({ fill: "#bbbbff", stroke: "#ff6666", strokeWidth: 2, textColor: "#000000", dash: "dashed" });
    expect(nodes.get("C")!.style).toEqual({ fill: "#ff9966", stroke: "#333333", strokeWidth: 4, textColor: "#ffffff" });
    expect(result.spec.nodes).toHaveLength(3);
    expect(result.spec.edges).toHaveLength(2);
  });

  it("skips front matter, directives and invisible links", () => {
    const result = importMermaid(
      ["---", "title: Demo", "config:", "  theme: dark", "---", "%%{init: {'theme': 'forest'}}%%", "flowchart", "  A ~~~ B", "  A --> B"].join("\r\n"),
    );
    expect(result.direction).toBeUndefined();
    expect(result.spec.edges).toEqual([{ from: "A", to: "B", kind: "flow" }]);
    expect(result.warnings).toEqual(["1 invisible link (~~~) ignored."]);
  });

  it("reports lines it cannot parse without inventing nodes from them", () => {
    const result = importMermaid("flowchart TD\n  A --> B\n  this is not valid\n  C[unclosed --> D\n  E --> ");
    expect(result.spec.nodes!.map((node) => node.id)).toEqual(["A", "B"]);
    expect(result.warnings).toEqual(['3 lines could not be understood and were skipped: "this is not valid", "C[unclosed --> D", "E -->".']);
  });

  it("makes ids safe and keeps edges attached to them", () => {
    const long = "x".repeat(80);
    const result = importMermaid(`flowchart TD\n  Größe[Size] --> _private\n  ${long} --> Größe`);
    const ids = result.spec.nodes!.map((node) => node.id!);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
    expect(new Set(ids).size).toBe(3);
    expect(result.spec.nodes![1].text).toBe("_private");
    expect(pairs(result.spec.edges)).toEqual([`${ids[0]}>${ids[1]}`, `${ids[2]}>${ids[0]}`]);
  });
});

/* ---------------------------------------------------------- sequence import */

describe("importMermaid: sequence diagrams", () => {
  const source = `
    sequenceDiagram
      autonumber
      actor U as End user
      participant W as Web app
      participant API
      U->>W: Open page
      W->>+API: GET /orders
      API-->>-W: 200 OK<br/>orders
      W-)Q: publish event
      Q--)W: ack
      W->W: render
      Note right of W: Cached for 5 min
      loop Every minute
        W->>API: poll
      end
      alt success
        API-->W: data
      else failure
        API--xW: error
      end
      activate W
      deactivate W
  `;

  it("reads participants and messages", () => {
    const result = importMermaid(source);
    expect(result.kind).toBe("sequence");
    expect(result.spec).toEqual({ nodes: [], edges: [] });
    expect(result.direction).toBeUndefined();
    expect(result.sequence!.participants).toEqual([
      { id: "U", name: "End user", kind: "actor" },
      { id: "W", name: "Web app", kind: "participant" },
      { id: "API", name: "API", kind: "participant" },
      { id: "Q", name: "Q" },
    ]);
    expect(result.sequence!.messages).toEqual([
      { from: "U", to: "W", kind: "sync", text: "Open page" },
      { from: "W", to: "API", kind: "sync", text: "GET /orders" },
      { from: "API", to: "W", kind: "return", text: "200 OK\norders" },
      { from: "W", to: "Q", kind: "async", text: "publish event" },
      { from: "Q", to: "W", kind: "async", text: "ack" },
      { from: "W", to: "W", kind: "sync", text: "render" },
      { from: "W", to: "API", kind: "sync", text: "poll" },
      { from: "API", to: "W", kind: "return", text: "data" },
      { from: "API", to: "W", kind: "return", text: "error" },
    ]);
  });

  it("reports skipped statements in one warning", () => {
    const { warnings } = importMermaid(source);
    expect(warnings).toEqual([
      "Sequence statements without an equivalent were skipped: autonumber (1), Note (1), loop (1), alt (1), else (1), activate (1), deactivate (1). Messages inside loop/alt/opt/par blocks were kept.",
    ]);
  });

  it("feeds buildSequence", () => {
    const { sequence } = importMermaid(source);
    const built = buildSequence(sequence!);
    expect(built.warnings).toEqual([]);
    expect(built.patch.nodes!.set).toHaveLength(4);
    expect(built.patch.edges!.set).toHaveLength(9);
    expect(built.patch.nodes!.set![0]).toMatchObject({ shape: "uml/actor-lifeline", text: "End user" });
  });
});

/* -------------------------------------------------------------- other input */

describe("importMermaid: everything else", () => {
  it.each(["classDiagram", "erDiagram", "stateDiagram-v2", "gantt", "pie", "mindmap", "journey", "gitGraph", "timeline"])(
    "rejects %s with a clear warning",
    (type) => {
      const result = importMermaid(`${type}\n  some content\n  A --> B`);
      expect(result.kind).toBe("flowchart");
      expect(result.spec).toEqual({ nodes: [], edges: [] });
      expect(result.sequence).toBeUndefined();
      expect(result.warnings).toEqual([`Unsupported Mermaid diagram type "${type}". Only flowchart (graph) and sequenceDiagram can be imported.`]);
    },
  );

  it("never throws on junk", () => {
    // Callers outside TypeScript may pass anything.
    const inputs: unknown[] = ["", "   \n\n", "%% only a comment", "???", "<xml/>", "graph", "flowchart TD\n[[[", "sequenceDiagram\n->>", null, 42];
    for (const input of inputs) {
      const result = importMermaid(input as string);
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(result.spec.edges).toEqual([]);
    }
    expect(importMermaid("").warnings[0]).toMatch(/empty/);
    expect(importMermaid("???").warnings[0]).toMatch(/does not look like a Mermaid diagram/);
    expect(importMermaid("graph").warnings).toEqual([]);
  });
});

/* ------------------------------------------------------------------- export */

const FLOW_NODES: DNode[] = [
  { id: "start", shape: "flowchart/terminator", x: 100, y: 0, w: 140, h: 52, z: 1, text: "Start" },
  { id: "zone", shape: "basic/frame", x: 0, y: 100, w: 500, h: 400, z: -2, text: "Checkout" },
  { id: "inner", shape: "basic/group", x: 20, y: 300, w: 300, h: 150, z: -1, parent: "zone", text: "Payment" },
  { id: "valid", shape: "flowchart/decision", x: 100, y: 150, w: 150, h: 100, z: 2, parent: "zone", text: "Valid?\n(strict)" },
  { id: "charge card", shape: "flowchart/process", x: 40, y: 340, w: 150, h: 64, z: 3, parent: "inner", text: 'Charge "card" & <log>; #1' },
  { id: "db", shape: "basic/cylinder", x: 600, y: 340, w: 100, h: 110, z: 4, text: "Orders" },
  { id: "end", shape: "basic/rounded", x: 100, y: 600, w: 140, h: 60, z: 5, text: "" },
  { id: "empty-frame", shape: "basic/frame", x: 600, y: 600, w: 200, h: 100, z: -3, text: "Unused" },
];

const FLOW_EDGES: DEdge[] = [
  { id: "e1", from: { node: "start" }, to: { node: "valid" }, routing: "orthogonal" },
  { id: "e2", from: { node: "valid" }, to: { node: "charge card" }, routing: "orthogonal", text: "yes | ok" },
  { id: "e3", from: { node: "charge card" }, to: { node: "db" }, routing: "orthogonal", style: { dash: "dashed" }, text: "write" },
  { id: "e4", from: { node: "valid" }, to: { node: "end" }, routing: "orthogonal", style: { strokeWidth: 4 } },
  { id: "e5", from: { node: "db" }, to: { node: "end" }, routing: "straight", style: { endMarker: "none" } },
  { id: "e6", from: { node: "zone" }, to: { node: "db" }, routing: "straight", style: { startMarker: "arrow", endMarker: "triangle" } },
  { id: "e7", from: { node: "end" }, to: { point: { x: 0, y: 900 } }, routing: "straight" },
];

describe("exportMermaid", () => {
  it("writes a flowchart with shapes, nested subgraphs and link styles", () => {
    expect(exportMermaid(makeDoc(FLOW_NODES, FLOW_EDGES))).toBe(
      [
        "%% Order flow",
        "flowchart TD",
        '  start(["Start"])',
        '  subgraph zone ["Checkout"]',
        '    valid{"Valid?<br/>(strict)"}',
        '    subgraph inner ["Payment"]',
        '      charge_card["Charge #quot;card#quot; #amp; #lt;log#gt;; #35;1"]',
        "    end",
        "  end",
        '  db[("Orders")]',
        '  end_(" ")',
        '  empty_frame["Unused"]',
        "  start --> valid",
        '  valid -->|"yes | ok"| charge_card',
        '  charge_card -.->|"write"| db',
        "  valid ==> end_",
        "  db --- end_",
        "  zone <--> db",
        "  %% 1 connector with a free end omitted",
        "",
      ].join("\n"),
    );
  });

  it("uses the document's layout direction", () => {
    const layout = { algorithm: "layered", direction: "right" } as const;
    const text = exportMermaid(makeDoc(FLOW_NODES.slice(0, 1), [], { layout }));
    expect(text).toBe('%% Order flow\nflowchart LR\n  start(["Start"])\n');
    expect(exportMermaid(makeDoc([], []))).toBe("%% Order flow\nflowchart TD\n");
  });

  it("is read back by the importer with the same nodes, edges and labels", () => {
    const doc = makeDoc(FLOW_NODES, FLOW_EDGES);
    const result = importMermaid(exportMermaid(doc));
    expect(result.warnings).toEqual([]);
    expect(result.kind).toBe("flowchart");
    expect(result.direction).toBe("down");

    expect(result.spec.nodes).toHaveLength(FLOW_NODES.length);
    const texts = result.spec.nodes!.map((node) => node.text).sort();
    expect(texts).toEqual(FLOW_NODES.map((node) => node.text ?? "").sort());
    const nodes = byId(result.spec.nodes);
    expect(nodes.get("zone")).toMatchObject({ shape: "basic/group", text: "Checkout" });
    expect(nodes.get("inner")).toMatchObject({ shape: "basic/group", parent: "zone" });
    expect(nodes.get("valid")).toMatchObject({ shape: "flowchart/decision", parent: "zone" });
    expect(nodes.get("charge_card")).toMatchObject({ shape: "flowchart/process", parent: "inner", text: 'Charge "card" & <log>; #1' });
    expect(nodes.get("db")).toMatchObject({ shape: "basic/cylinder" });
    expect(nodes.get("start")).toMatchObject({ shape: "flowchart/terminator" });

    const attached = FLOW_EDGES.filter((edge) => edge.from.node && edge.to.node);
    expect(result.spec.edges).toHaveLength(attached.length);
    expect(result.spec.edges!.map((edge) => edge.text ?? "")).toEqual(attached.map((edge) => edge.text ?? ""));
    expect(result.spec.edges!.map((edge) => edge.kind)).toEqual(["flow", "flow", "dashed", "flow", "line", "bidirectional"]);
    expect(result.spec.edges![3].style).toEqual({ strokeWidth: 3 });
  });

  it("exports lifelines as a sequence diagram ordered by position", () => {
    const built = buildSequence({
      participants: [
        { id: "user", name: "User", kind: "actor" },
        { id: "api", name: "Order API" },
        { id: "db", name: "Database" },
      ],
      messages: [
        { from: "user", to: "api", text: "Place order" },
        { from: "api", to: "db", text: "INSERT; COMMIT", kind: "async" },
        { from: "db", to: "api", text: "ok", kind: "return" },
        { from: "api", to: "api", text: "audit" },
        { from: "api", to: "user", text: "Created\n#42", kind: "return" },
      ],
    });
    // Shuffle the edges: order must come from the vertical position, not from storage order.
    const patch = { nodes: built.patch.nodes, edges: { set: [...built.patch.edges!.set!].reverse() } };
    const doc = applyPatch(createDoc({ id: "seq", name: "Checkout sequence" }, new Date(0)), patch).doc;

    const text = exportMermaid(doc);
    expect(text).toBe(
      [
        "%% Checkout sequence",
        "sequenceDiagram",
        "  actor user as User",
        "  participant api as Order API",
        "  participant db as Database",
        "  user->>api: Place order",
        "  api-)db: INSERT#59; COMMIT",
        "  db-->>api: ok",
        "  api->>api: audit",
        "  api-->>user: Created<br/>#35;42",
        "",
      ].join("\n"),
    );

    const result = importMermaid(text);
    expect(result.warnings).toEqual([]);
    expect(result.kind).toBe("sequence");
    expect(result.sequence!.participants).toEqual([
      { id: "user", name: "User", kind: "actor" },
      { id: "api", name: "Order API", kind: "participant" },
      { id: "db", name: "Database", kind: "participant" },
    ]);
    expect(result.sequence!.messages).toEqual([
      { from: "user", to: "api", kind: "sync", text: "Place order" },
      { from: "api", to: "db", kind: "async", text: "INSERT; COMMIT" },
      { from: "db", to: "api", kind: "return", text: "ok" },
      { from: "api", to: "api", kind: "sync", text: "audit" },
      { from: "api", to: "user", kind: "return", text: "Created\n#42" },
    ]);
  });

  it("is deterministic", () => {
    const doc = makeDoc(FLOW_NODES, FLOW_EDGES);
    expect(exportMermaid(makeDoc([...FLOW_NODES].reverse(), FLOW_EDGES))).toBe(exportMermaid(doc));
  });
});
