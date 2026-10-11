import { describe, expect, it } from "vitest";

import type { EdgeSpec, NodeSpec } from "../spec/apply";
import { importPlantUml } from "./plantuml";

const nodesById = (nodes: NodeSpec[] | undefined): Map<string, NodeSpec> => new Map((nodes ?? []).map((node) => [node.id!, node]));
const pairs = (edges: EdgeSpec[] | undefined): string[] => (edges ?? []).map((edge) => `${edge.from}>${edge.to}`);

/* ----------------------------------------------------------------- sequence */

describe("importPlantUml: sequence diagrams", () => {
  it("reads participants, aliases, quoted names and message kinds", () => {
    const result = importPlantUml(`
      @startuml
      title Checkout
      actor Customer
      participant "Web app" as Web
      participant Orders as "Order service"
      database DB
      Customer -> Web : place order
      Web ->> Orders: POST /orders
      Orders --> Web : 201 Created
      Web <- Orders : callback
      Orders -> DB : insert
      @enduml
    `);
    expect(result.kind).toBe("sequence");
    expect(result.warnings).toEqual([]);
    expect(result.sequence?.participants).toEqual([
      { id: "Customer", name: "Customer", kind: "actor" },
      { id: "Web", name: "Web app", kind: "participant" },
      { id: "Orders", name: "Order service", kind: "participant" },
      { id: "DB", name: "DB", kind: "participant" },
    ]);
    expect(result.sequence?.messages).toEqual([
      { from: "Customer", to: "Web", kind: "sync", text: "place order" },
      { from: "Web", to: "Orders", kind: "async", text: "POST /orders" },
      { from: "Orders", to: "Web", kind: "return", text: "201 Created" },
      { from: "Orders", to: "Web", kind: "sync", text: "callback" },
      { from: "Orders", to: "DB", kind: "sync", text: "insert" },
    ]);
  });

  it("creates participants on first use, in order of appearance", () => {
    const result = importPlantUml("Alice -> Bob: hi\nBob -> Carol : forward\nCarol --> Alice : done");
    expect(result.kind).toBe("sequence");
    expect(result.sequence?.participants.map((p) => p.id)).toEqual(["Alice", "Bob", "Carol"]);
    expect(result.sequence?.messages).toHaveLength(3);
  });

  it("copes with odd spacing, activation suffixes, styled arrows and self messages", () => {
    const result = importPlantUml(`@startuml
A->B:no spaces
A   ->   B   :   lots   of   space
B -[#red]> A : styled
B -> B ++ : self and activate
B --> A --
@enduml`);
    expect(result.warnings).toEqual([]);
    expect(result.sequence?.messages.map((m) => `${m.from}>${m.to}:${m.text ?? ""}:${m.kind}`)).toEqual([
      "A>B:no spaces:sync",
      "A>B:lots   of   space:sync",
      "B>A:styled:sync",
      "B>B:self and activate:sync",
      "B>A::return",
    ]);
  });

  it("turns \\n into line breaks and drops markup in message text", () => {
    const result = importPlantUml("A -> B : <b>Hello</b>\\nworld");
    expect(result.sequence?.messages[0].text).toBe("Hello\nworld");
  });

  it("flattens blocks with one warning and keeps the messages inside", () => {
    const result = importPlantUml(`@startuml
A -> B : try
alt success
  B --> A : ok
else failure
  B --> A : error
end
loop 3 times
  A -> B : retry
end
opt cache
  A -> A : warm
end
@enduml`);
    expect(result.sequence?.messages).toHaveLength(5);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/flattened: alt, loop, opt/);
    expect(result.diagnostics.map((d) => d.line)).toEqual([3, 8, 11]);
    expect(result.diagnostics.every((d) => d.severity === "warning")).toBe(true);
  });

  it("skips notes (single and multi-line) and reports them once with the other ignored lines", () => {
    const result = importPlantUml(`@startuml
autonumber
participant A
participant B
note over A, B : handshake
A -> B : hello
note left of A
  first line
  second line
end note
hide footbox
B --> A : hi
@enduml`);
    expect(result.sequence?.messages).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBe("4 lines ignored (unsupported: note ×2, autonumber, hide).");
  });

  it("does not take a participant called loop for a block", () => {
    const result = importPlantUml("loop -> worker : tick\nworker --> loop : tock");
    expect(result.sequence?.participants.map((p) => p.id)).toEqual(["loop", "worker"]);
    expect(result.warnings).toEqual([]);
  });

  it("ignores activate / deactivate silently", () => {
    const result = importPlantUml("A -> B : go\nactivate B\nB --> A : done\ndeactivate B");
    expect(result.warnings).toEqual([]);
    expect(result.sequence?.messages).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------- class */

describe("importPlantUml: class diagrams", () => {
  const source = `
@startuml
skinparam classAttributeIconSize 0
' a comment
/' a block
   comment '/
package "Shop domain" as domain {
  abstract class CatalogItem {
    # sku : String
    {static} + count : int
    + price() : Money
    -- internals --
    - audit()
  }
  interface Priced <<capability>>
  enum Status {
    NEW
    PAID
  }
  class Product extends CatalogItem implements Priced
}
class "Shopping cart" as Cart #lightblue
Cart "1" *-- "0..*" Product : contains >
Cart o-- Status
Product ..> Status : uses
Status <|-- Special
Cart --> "*" Product
Cart -- Wishlist
@enduml`;

  it("reads declarations, members, groups, aliases and colours", () => {
    const result = importPlantUml(source);
    expect(result.kind).toBe("class");
    expect(result.warnings).toEqual([]);
    const nodes = nodesById(result.spec.nodes);

    expect(nodes.get("domain")).toMatchObject({ shape: "uml/package", text: "Shop domain" });
    expect(nodes.get("CatalogItem")).toMatchObject({
      shape: "uml/class",
      parent: "domain",
      data: { abstract: true },
      text: "CatalogItem\n---\n# sku : String\n+ count : int\n---\n+ price() : Money\n- audit()",
    });
    expect(nodes.get("Priced")).toMatchObject({ shape: "uml/interface", parent: "domain" });
    expect(nodes.get("Status")).toMatchObject({ shape: "uml/enum", text: "Status\n---\nNEW\nPAID" });
    expect(nodes.get("Product")).toMatchObject({ shape: "uml/class", parent: "domain", text: "Product" });
    expect(nodes.get("Cart")).toMatchObject({ shape: "uml/class", text: "Shopping cart", color: "blue" });
    // Names used only in relations become classes.
    expect(nodes.get("Special")).toMatchObject({ shape: "uml/class" });
    expect(nodes.get("Wishlist")).toMatchObject({ shape: "uml/class" });
  });

  it("maps arrows to edge kinds with the right orientation and multiplicities", () => {
    const edges = importPlantUml(source).spec.edges!;
    expect(edges).toEqual([
      { from: "Product", to: "CatalogItem", kind: "inheritance" },
      { from: "Product", to: "Priced", kind: "implementation" },
      { from: "Cart", to: "Product", kind: "composition", text: "contains", startText: "1", endText: "0..*" },
      { from: "Cart", to: "Status", kind: "aggregation" },
      { from: "Product", to: "Status", kind: "dependency", text: "uses" },
      { from: "Special", to: "Status", kind: "inheritance" },
      { from: "Cart", to: "Product", kind: "association", endText: "*" },
      { from: "Cart", to: "Wishlist", kind: "line" },
    ]);
  });

  it("puts the multiplicities on the right ends when the arrow is reversed", () => {
    const result = importPlantUml(`class A\nclass B\nA "many" --* "1" B : part of`);
    expect(result.spec.edges).toEqual([{ from: "B", to: "A", kind: "composition", text: "part of", startText: "1", endText: "many" }]);
  });

  it("keeps ids stable and readable for names with spaces", () => {
    const result = importPlantUml(`class "Order line"\nclass "Order line item"\n"Order line" --> "Order line item"`);
    expect(result.spec.nodes?.map((n) => n.id)).toEqual(["Order-line", "Order-line-item"]);
    expect(result.spec.edges).toEqual([{ from: "Order-line", to: "Order-line-item", kind: "association" }]);
  });

  it("handles object diagrams and relations written with direction hints", () => {
    const result = importPlantUml(`object "alice : Customer" as alice {
  name = "Alice"
}
object order
alice -down-> order : places
alice -[#red,dashed]-> order`);
    expect(result.kind).toBe("class");
    expect(result.spec.nodes?.[0]).toMatchObject({ shape: "uml/object", text: "alice : Customer\n---\nname = \"Alice\"" });
    expect(pairs(result.spec.edges)).toEqual(["alice>order", "alice>order"]);
  });

  it("flags unsupported lines once and survives unclosed bodies", () => {
    const result = importPlantUml(`@startuml
class Broken {
  + a(): void
hide empty members
note "n" as N1
class Other
N1 .. Other
@enduml`);
    expect(result.kind).toBe("class");
    expect(result.spec.nodes?.map((n) => n.id)).toEqual(["Broken"]);
    expect(result.warnings).toHaveLength(1);
  });
});

/* ----------------------------------------------------------------- use case */

describe("importPlantUml: use case diagrams", () => {
  it("reads actors, use cases, boundaries and include / extend", () => {
    const result = importPlantUml(`@startuml
left to right direction
actor Customer
actor "Payment provider" as Provider
:Admin: as A
rectangle "Online shop" {
  usecase "Place order" as UC1
  usecase UC2 as "Pay"
  (Sign in) as UC3
  (Manage products)
}
Customer --> UC1
UC1 .> UC2 : include
UC1 .> UC3 : <<include>>
(Manage products) .> UC1 : extends
UC2 -- Provider
A --> (Manage products)
Customer <|-- A
@enduml`);
    expect(result.kind).toBe("usecase");
    expect(result.direction).toBe("right");
    expect(result.warnings).toEqual([]);
    const nodes = nodesById(result.spec.nodes);
    expect(nodes.get("Customer")).toMatchObject({ shape: "uml/actor" });
    expect(nodes.get("Provider")).toMatchObject({ shape: "uml/actor", text: "Payment provider" });
    expect(nodes.get("A")).toMatchObject({ shape: "uml/actor", text: "Admin" });
    expect(nodes.get("Online-shop")).toMatchObject({ shape: "uml/system-boundary" });
    expect(nodes.get("UC1")).toMatchObject({ shape: "uml/use-case", text: "Place order", parent: "Online-shop" });
    expect(nodes.get("UC2")).toMatchObject({ text: "Pay", parent: "Online-shop" });
    expect(nodes.get("UC3")).toMatchObject({ text: "Sign in", parent: "Online-shop" });
    expect(nodes.get("Manage-products")).toMatchObject({ shape: "uml/use-case", parent: "Online-shop" });

    expect(result.spec.edges).toEqual([
      { from: "Customer", to: "UC1", kind: "association" },
      { from: "UC1", to: "UC2", kind: "include", text: "«include»" },
      { from: "UC1", to: "UC3", kind: "include", text: "«include»" },
      { from: "Manage-products", to: "UC1", kind: "include", text: "«extend»" },
      { from: "UC2", to: "Provider", kind: "line" },
      { from: "A", to: "Manage-products", kind: "association" },
      { from: "A", to: "Customer", kind: "inheritance" },
    ]);
  });

  it("reads a diagram made only of colon actors and parenthesised use cases", () => {
    const result = importPlantUml(":User: --> (Log in)\n(Log in) --> (Check password) : include");
    expect(result.kind).toBe("usecase");
    expect(result.spec.nodes?.map((n) => `${n.id}:${n.shape}`)).toEqual(["User:uml/actor", "Log-in:uml/use-case", "Check-password:uml/use-case"]);
  });
});

/* ---------------------------------------------------------------- component */

describe("importPlantUml: component and deployment diagrams", () => {
  it("reads components, nodes, databases and inline brackets", () => {
    const result = importPlantUml(`@startuml
node "Web server" {
  component "Order API" as API
  [Mail worker] as Worker
}
database "Order store" as DB
cloud Provider
interface Payments
[Storefront] --> API : HTTPS
API --> DB : SQL
API ..> Worker : order.confirmed
API -- Provider
Provider -up- Payments
@enduml`);
    expect(result.kind).toBe("component");
    expect(result.warnings).toEqual([]);
    const nodes = nodesById(result.spec.nodes);
    expect(nodes.get("Web-server")).toMatchObject({ shape: "uml/node" });
    expect(nodes.get("API")).toMatchObject({ shape: "uml/component", text: "Order API", parent: "Web-server" });
    expect(nodes.get("Worker")).toMatchObject({ shape: "uml/component", text: "Mail worker", parent: "Web-server" });
    expect(nodes.get("DB")).toMatchObject({ shape: "basic/cylinder", text: "Order store" });
    expect(nodes.get("Provider")).toMatchObject({ shape: "basic/cloud" });
    expect(nodes.get("Payments")).toMatchObject({ shape: "uml/interface" });
    expect(nodes.get("Storefront")).toMatchObject({ shape: "uml/component" });
    expect(result.spec.edges).toEqual([
      { from: "Storefront", to: "API", kind: "association", text: "HTTPS" },
      { from: "API", to: "DB", kind: "association", text: "SQL" },
      { from: "API", to: "Worker", kind: "dependency", text: "order.confirmed" },
      { from: "API", to: "Provider", kind: "line" },
      { from: "Provider", to: "Payments", kind: "line" },
    ]);
  });

  it("opens a block on the next line and skips what it does not know", () => {
    const result = importPlantUml(`package Backend
{
  component Api
}
Api --> Db
legend right
  made with care
end legend`);
    expect(result.kind).toBe("component");
    expect(nodesById(result.spec.nodes).get("Api")).toMatchObject({ parent: "Backend" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/legend/);
  });
});

/* ----------------------------------------------------------------- activity */

describe("importPlantUml: activity diagrams", () => {
  it("builds a flow with decisions, loops and forks", () => {
    const result = importPlantUml(`@startuml
start
:Receive order;
if (In stock?) then (yes)
  fork
    :Pack items;
  fork again
    :Charge card;
  end fork
else (no)
  :Cancel and notify;
  stop
endif
while (More lines?) is (yes)
  :Scan line;
endwhile (no)
:Ship;
stop
@enduml`);
    expect(result.kind).toBe("activity");
    expect(result.warnings).toEqual([]);
    const nodes = nodesById(result.spec.nodes);
    expect(nodes.get("start")).toMatchObject({ shape: "uml/initial-state" });
    expect(nodes.get("a-Receive-order")).toMatchObject({ shape: "uml/action", text: "Receive order" });
    expect(nodes.get("d-In-stock")).toMatchObject({ shape: "flowchart/decision", text: "In stock?" });
    expect(nodes.get("fork")).toMatchObject({ shape: "uml/fork-join" });
    expect(nodes.get("join")).toMatchObject({ shape: "uml/fork-join" });

    expect(result.spec.edges).toEqual([
      { from: "start", to: "a-Receive-order" },
      { from: "a-Receive-order", to: "d-In-stock" },
      { from: "d-In-stock", to: "fork", text: "yes" },
      { from: "fork", to: "a-Pack-items" },
      { from: "fork", to: "a-Charge-card" },
      { from: "a-Pack-items", to: "join" },
      { from: "a-Charge-card", to: "join" },
      { from: "d-In-stock", to: "a-Cancel-and-notify", text: "no" },
      { from: "a-Cancel-and-notify", to: "stop" },
      { from: "join", to: "d-More-lines" },
      { from: "d-More-lines", to: "a-Scan-line", text: "yes" },
      { from: "a-Scan-line", to: "d-More-lines" },
      { from: "d-More-lines", to: "a-Ship", text: "no" },
      { from: "a-Ship", to: "stop-2" },
    ]);
  });

  it("handles elseif chains and repeat loops", () => {
    const result = importPlantUml(`start
if (a?) then (1)
  :A;
elseif (b?) then (2)
  :B;
else (3)
  :C;
endif
repeat
  :Try;
repeat while (again?) is (yes) not (no)
:Done;
stop`);
    expect(result.kind).toBe("activity");
    expect(result.warnings).toEqual([]);
    const edges = pairs(result.spec.edges);
    // Every branch reaches the repeat start, and the loop edge goes back to it.
    expect(edges).toContain("a-A>repeat");
    expect(edges).toContain("a-B>repeat");
    expect(edges).toContain("a-C>repeat");
    expect(edges).toContain("d-again>repeat");
    expect(edges).toContain("d-again>a-Done");
  });

  it("reads multi-line actions and coloured actions", () => {
    const result = importPlantUml(`start
:first line
second line;
#palegreen:Colourful;
stop`);
    const nodes = result.spec.nodes!;
    expect(nodes[1]).toMatchObject({ text: "first line\nsecond line" });
    expect(nodes[2]).toMatchObject({ text: "Colourful", color: "green" });
  });

  it("ignores swimlanes and partitions with one warning but keeps the flow", () => {
    const result = importPlantUml(`start
|Customer|
:Order;
partition Fulfilment {
  :Pack;
}
stop`);
    expect(result.spec.nodes?.map((n) => n.text ?? "")).toEqual(["", "Order", "Pack", ""]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/swimlane/);
    expect(result.warnings[0]).toMatch(/partition/);
  });
});

/* ------------------------------------------------------------------ the rest */

describe("importPlantUml: everything else", () => {
  it("says what it cannot read instead of failing", () => {
    expect(importPlantUml("").kind).toBe("unknown");
    expect(importPlantUml("").warnings[0]).toMatch(/empty/);
    expect(importPlantUml("@startmindmap\n* root\n** child\n@endmindmap").warnings[0]).toMatch(/@startmindmap diagrams are not supported/);
    expect(importPlantUml("flowchart TD\n A --> B").warnings[0]).toMatch(/looks like Mermaid/);
    expect(importPlantUml("[*] --> Idle\nIdle --> [*]").warnings[0]).toMatch(/state diagrams/);
    expect(importPlantUml("(*) --> \"First\"\n\"First\" --> (*)").warnings[0]).toMatch(/old activity syntax/);
    expect(importPlantUml("just some words").kind).toBe("unknown");
  });

  it("reads only the first diagram and says so", () => {
    const result = importPlantUml("@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml");
    expect(result.sequence?.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(result.warnings.join(" ")).toMatch(/first diagram/);
  });

  it("aggregates unreadable lines into one warning with line numbers", () => {
    const result = importPlantUml(`@startuml
A -> B : fine
this is not plantuml at all
A ->
B -> C : ok
@enduml`);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/2 lines ignored \(not understood: line 3 "this is not plantuml at all", line 4 "A ->"\)/);
    expect(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.line)).toEqual([3, 4]);
    expect(result.sequence?.messages).toHaveLength(2);
  });

  it("never throws, whatever it is fed", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      "@startuml",
      "@startuml\n",
      "\u0000\u0001\u0002",
      "-> -> ->",
      "class",
      "class {",
      "}",
      "{",
      ":;",
      "if (",
      "while",
      '"unterminated',
      "/' never closed",
      "A -> B : " + "x".repeat(50000),
      "(".repeat(5000),
      "-".repeat(5000) + ">",
      "[" + "a".repeat(3000),
      Array.from({ length: 3000 }, (_, i) => `n${i} --> n${i + 1}`).join("\n"),
      "@startuml\nclass A {\n" + "+ m()\n".repeat(2000),
    ];
    for (const input of inputs) {
      expect(() => importPlantUml(input as string)).not.toThrow();
      const result = importPlantUml(input as string);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  it("survives truncation at every position of a realistic diagram", () => {
    const full = `@startuml
actor "A user" as U
participant Web
alt ok
  U -> Web : go\\nnow
end
class Foo<T> extends Bar {
  + run(): void
}
usecase (X) as X
[Comp] --> (X) : <<include>>
start
:action;
if (c) then (yes)
:y;
endif
@enduml`;
    for (let i = 0; i <= full.length; i += 3) {
      expect(() => importPlantUml(full.slice(0, i))).not.toThrow();
    }
  });
});
