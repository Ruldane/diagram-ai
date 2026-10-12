import { describe, expect, it } from "vitest";

import { planCodeApply } from "../code/apply";
import { placePlan } from "../code/layout";
import { loadElk } from "../layout/engine";
import { createDoc } from "../model/defaults";
import { isEmptyPatch, applyPatch } from "../model/patch";
import type { DiagramDoc } from "../model/types";
import { importPlantUml } from "./plantuml";
import { exportPlantUml, plantUmlOperator } from "./plantuml-export";

const empty = (): DiagramDoc => createDoc({ id: "doc", name: "Diagram", type: "blank" }, new Date(0));

/** The document PlantUML text produces on an empty canvas, laid out. */
async function drawn(text: string): Promise<DiagramDoc> {
  const imported = importPlantUml(text);
  expect(imported.warnings).toEqual([]);
  const doc = empty();
  const plan = planCodeApply(doc, imported, "replace");
  return applyPatch(doc, await placePlan(plan, await loadElk())).doc;
}

function exported(doc: DiagramDoc) {
  const result = exportPlantUml(doc);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

/** text → canvas → text → canvas: the second canvas must already match, so applying it is a no-op. */
async function expectStable(source: string) {
  const doc = await drawn(source);
  const result = exported(doc);
  const again = importPlantUml(result.text);
  expect(again.warnings, result.text).toEqual([]);
  expect(again.kind).toBe(result.kind);
  const plan = planCodeApply(doc, again, "replace");
  expect(isEmptyPatch(plan.patch), `${result.text}\n${JSON.stringify(plan.patch)}`).toBe(true);
  return { doc, result };
}

describe("exportPlantUml: round trips", () => {
  it("sequence diagram", async () => {
    const { result } = await expectStable(`@startuml
actor Customer
participant "Web app" as Web
participant Orders
Customer -> Web : place order
Web ->> Orders : POST /orders
Orders --> Web : 201 Created
Web --> Customer : confirmation
@enduml`);
    expect(result.kind).toBe("sequence");
    expect(result.text).toContain('actor "Customer" as customer');
    expect(result.text).toMatch(/"web" ->> "orders" : POST \/orders/);
  });

  it("class diagram with members, stereotypes, abstract classes, multiplicities and packages", async () => {
    const { result } = await expectStable(`@startuml
package shop {
  class Order {
    +id: int
    -items: List
    +total(): Money
  }
  abstract class Payment {
    +amount: Money
    {abstract} +pay()
  }
}
interface Shippable {
  +ship()
}
enum Status {
  OPEN
  PAID
}
class Customer <<entity>>
Customer "1" --> "0..*" Order : places
Order *-- Payment
Order ..|> Shippable
Payment --|> Customer
Order o-- Status
@enduml`);
    expect(result.kind).toBe("class");
    expect(result.text).toContain("abstract class");
    expect(result.text).toContain('"1" -->');
  });

  it("use case diagram with a system boundary and include", async () => {
    const { result } = await expectStable(`@startuml
left to right direction
actor Customer
actor Clerk
rectangle Checkout {
  usecase "Pay" as Pay
  usecase "Verify card" as Verify
}
Customer --> Pay
Clerk --> Pay
Pay ..> Verify : <<include>>
@enduml`);
    expect(result.kind).toBe("usecase");
    expect(result.text).toContain("left to right direction");
  });

  it("component diagram", async () => {
    const { result } = await expectStable(`@startuml
package "Backend" {
  component API
  database Store
  queue Jobs
}
cloud CDN
interface HTTP
CDN --> API
API --> Store
API ..> Jobs
API -- HTTP
@enduml`);
    expect(result.kind).toBe("component");
  });

  it("activity diagram: if / else, while, repeat and fork", async () => {
    const { result } = await expectStable(`@startuml
start
:Receive order;
if (In stock?) then (yes)
  :Pick items;
  while (More items?) is (yes)
    :Scan;
  endwhile (no)
else (no)
  :Back-order;
  stop
endif
fork
  :Pack;
fork again
  :Print label;
end fork
repeat
  :Hand over;
repeat while (Delivered?) is (no) not (yes)
stop
@enduml`);
    expect(result.kind).toBe("activity");
    expect(result.text).toContain("while (More items?) is (yes)");
    expect(result.text).toContain("endwhile (no)");
    expect(result.text).toContain("repeat while (Delivered?) is (no) not (yes)");
    expect(result.text).toContain("fork again");
  });

  it("an if without else keeps its branch labels", async () => {
    const { result } = await expectStable(`@startuml
start
if (Valid?) then (yes)
  :Save;
endif
:Notify;
stop
@enduml`);
    expect(result.text).toContain("if (Valid?) then (yes)");
    expect(result.text).not.toContain("else");
  });
});

describe("exportPlantUml: what it refuses", () => {
  it("names the shapes it cannot express", async () => {
    const doc = await drawn("@startuml\nclass A\nclass B\nA --> B\n@enduml");
    const note = { id: "n1", shape: "uml/note", x: 0, y: 0, w: 100, h: 60, z: 99, text: "remember" };
    const withNote = applyPatch(doc, { nodes: { set: [note] } }).doc;
    const result = exportPlantUml(withNote);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/note/i);
      expect(result.example).toContain("@startuml");
    }
  });

  it("refuses an activity flow with two starting points", async () => {
    const doc = await drawn("@startuml\nstart\n:A;\nstop\n@enduml");
    const extra = { id: "x", shape: "uml/action", x: 0, y: 500, w: 100, h: 50, z: 50, text: "Orphan" };
    const result = exportPlantUml(applyPatch(doc, { nodes: { set: [extra] } }).doc);
    expect(result.ok).toBe(false);
  });

  it("is empty-safe", () => {
    const result = exportPlantUml(empty());
    expect(result.ok).toBe(true);
  });
});

describe("plantUmlOperator", () => {
  it("maps markers and dashes to the relation operators the importer reads", () => {
    expect(plantUmlOperator({ startMarker: "none", endMarker: "triangle-open" })).toBe("--|>");
    expect(plantUmlOperator({ startMarker: "none", endMarker: "triangle-open", dash: "dashed" })).toBe("..|>");
    expect(plantUmlOperator({ startMarker: "diamond", endMarker: "none" })).toBe("*--");
    expect(plantUmlOperator({ startMarker: "diamond-open", endMarker: "none" })).toBe("o--");
    expect(plantUmlOperator({ startMarker: "none", endMarker: "open-arrow", dash: "dashed" })).toBe("..>");
    expect(plantUmlOperator({ startMarker: "arrow", endMarker: "arrow" })).toBe("<-->");
    expect(plantUmlOperator({ startMarker: "none", endMarker: "none" })).toBe("--");
  });
});

describe("activity ids", () => {
  it("pins ids the importer would number differently, and reads them back", async () => {
    const doc = await drawn(`@startuml
start
if (Paid?) then (yes)
  :Ship;
else (no)
  :Cancel;
  stop
endif
:Archive;
stop
@enduml`);
    const { text } = exported(doc);
    expect(text).toContain("' @id stop");
    const ids = (importPlantUml(text).spec.nodes ?? []).map((node) => node.id).sort();
    expect(ids).toEqual(Object.keys(doc.nodes).sort());
  });

  it("an @id comment is only a name for the next element", () => {
    const result = importPlantUml("@startuml\nstart\n' @id begin\n:Work;\n' just a comment\nstop\n@enduml");
    expect(result.warnings).toEqual([]);
    expect((result.spec.nodes ?? []).map((node) => node.id)).toEqual(["start", "begin", "stop"]);
  });
});

describe("styles the text cannot say", () => {
  it("keeps a connector's marker when the text reads the same", async () => {
    const doc = await drawn("@startuml\nclass A\nclass B\nA --> B : uses\n@enduml");
    const [edge] = Object.values(doc.edges);
    // A filled arrowhead is drawn `-->` in PlantUML too, so the text must not restyle it.
    const styled = applyPatch(doc, { edges: { set: [{ ...edge, style: { ...edge.style, endMarker: "arrow", stroke: "#cc0000" } }] } }).doc;
    const plan = planCodeApply(styled, importPlantUml(exported(styled).text), "replace");
    expect(isEmptyPatch(plan.patch)).toBe(true);
  });
});
