import type { CodeLanguage } from "./types";

/** Starting points for the code editor's "Examples" menu. Each one parses without warnings (a test enforces it). */
export interface CodeExample {
  id: string;
  title: string;
  code: string;
}

const MERMAID: CodeExample[] = [
  {
    id: "flowchart",
    title: "Flowchart",
    code: `flowchart LR
  request([Request]) --> auth{Signed in?}
  auth -->|no| login[Sign in]
  login --> auth
  auth -->|yes| cache[(Cache)]
  cache -->|hit| respond([Respond])
  cache -->|miss| db[(Database)]
  db --> respond
`,
  },
  {
    id: "sequence",
    title: "Sequence diagram",
    code: `sequenceDiagram
  actor User
  participant Web as Web app
  participant API as Order API
  participant Pay as Payment gateway
  User->>Web: Place order
  Web->>API: POST /orders
  API->>Pay: charge(total)
  Pay-->>API: approved
  API-->>Web: 201 Created
  Web-->>User: Confirmation
`,
  },
  {
    id: "subgraphs",
    title: "Flowchart with groups",
    code: `flowchart TD
  subgraph client [Client]
    browser[Browser] --> spa[Single page app]
  end
  subgraph backend [Backend]
    api[API] --> queue[(Queue)]
    queue --> worker[Worker]
  end
  spa -->|HTTPS| api
  worker -->|SQL| store[(Database)]
`,
  },
];

const PLANTUML: CodeExample[] = [
  {
    id: "sequence",
    title: "Sequence diagram",
    code: `@startuml
actor Customer
participant "Web app" as Web
participant "Order service" as Orders
database "Order store" as DB

Customer -> Web : Place order
Web -> Orders : POST /orders
Orders -> DB : insert
DB --> Orders : id
Orders --> Web : 201 Created
Web --> Customer : Confirmation
@enduml
`,
  },
  {
    id: "class",
    title: "Class diagram",
    code: `@startuml
interface Priced {
  + price(): Money
}
abstract class CatalogItem {
  # sku: String
  # name: String
  + isAvailable(): boolean
}
class Product {
  - unitPrice: Money
  - stock: int
}
class Bundle {
  - discount: Percent
}
class Cart {
  + total(): Money
}
class CartLine {
  - quantity: int
}

CatalogItem ..|> Priced
Product --|> CatalogItem
Bundle --|> CatalogItem
Bundle o-- "2..*" CatalogItem : contains
Cart *-- "0..*" CartLine
CartLine --> "1" CatalogItem
@enduml
`,
  },
  {
    id: "usecase",
    title: "Use case diagram",
    code: `@startuml
left to right direction
actor Customer
actor "Payment provider" as Provider
rectangle "Online shop" {
  usecase "Browse catalogue" as Browse
  usecase "Place order" as Order
  usecase "Pay for order" as Pay
  usecase "Sign in" as SignIn
}
Customer --> Browse
Customer --> Order
Order ..> Pay : include
Order ..> SignIn : include
Pay -- Provider
@enduml
`,
  },
  {
    id: "component",
    title: "Component diagram",
    code: `@startuml
node "Kubernetes cluster" {
  component "Order API" as API
  component "Mail worker" as Worker
}
database "Order store" as DB
cloud "Payment provider" as Provider
[Storefront] --> API : HTTPS
API --> DB : SQL
API ..> Worker : order.confirmed
API --> Provider : charge
@enduml
`,
  },
  {
    id: "activity",
    title: "Activity diagram",
    code: `@startuml
start
:Receive order;
if (In stock?) then (yes)
  fork
    :Pack items;
  fork again
    :Charge card;
  end fork
  :Ship order;
else (no)
  :Cancel and notify;
endif
stop
@enduml
`,
  },
];

export const CODE_EXAMPLES: Record<CodeLanguage, CodeExample[]> = { mermaid: MERMAID, plantuml: PLANTUML };

/** What the editor shows for a language that has no text yet. */
export const PLACEHOLDERS: Record<CodeLanguage, string> = {
  mermaid: "flowchart TD\n  A[Start] --> B{Valid?}\n  B -->|yes| C[Done]\n  B -->|no| A",
  plantuml: "@startuml\nAlice -> Bob : Hello\nBob --> Alice : Hi\n@enduml",
};
