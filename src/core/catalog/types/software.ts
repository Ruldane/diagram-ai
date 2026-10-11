import type { EdgeSpec, NodeSpec } from "../../spec/apply";
import { FREEFORM, label, layered, MUTED_TEXT } from "../presets";
import type { DiagramTypeDef } from "../types";

/* ---------------------------------------------------- layered architecture */

const BAND = { w: 620, h: 110, gap: 40, partW: 160, partH: 50, partGap: 30 };

const BANDS: { id: string; title: string; color: string; parts: string[] }[] = [
  { id: "presentation", title: "Presentation layer", color: "blue", parts: ["Web UI", "REST API", "Admin console"] },
  { id: "application", title: "Application layer", color: "teal", parts: ["Checkout service", "Catalogue service", "Account service"] },
  { id: "domain", title: "Domain layer", color: "green", parts: ["Order", "Product", "Pricing rules"] },
  { id: "infrastructure", title: "Infrastructure layer", color: "gray", parts: ["SQL repositories", "Payment client", "Email sender"] },
];

/** Stacked bands, each holding a row of evenly spaced parts. */
const bandNodes: NodeSpec[] = BANDS.flatMap((band, row) => {
  const y = row * (BAND.h + BAND.gap);
  const rowW = band.parts.length * BAND.partW + (band.parts.length - 1) * BAND.partGap;
  return [
    { id: band.id, shape: "basic/group", text: band.title, x: 0, y, w: BAND.w, h: BAND.h, color: band.color },
    ...band.parts.map((text, column) => ({
      id: `${band.id}-${column + 1}`,
      shape: "basic/rounded",
      text,
      parent: band.id,
      x: (BAND.w - rowW) / 2 + column * (BAND.partW + BAND.partGap),
      y: y + 44,
      w: BAND.partW,
      h: BAND.partH,
      color: band.color,
    })),
  ];
});

const bandEdges: EdgeSpec[] = BANDS.slice(1).map((band, index) => ({ from: BANDS[index].id, to: band.id, fromAnchor: "bottom", toAnchor: "top" }));

/* ------------------------------------------------------- CI/CD pipeline */

const STAGE = { w: 190, gap: 20, h: 260, jobW: 166, jobH: 52, jobGap: 12 };

const STAGES: { id: string; title: string; color: string; jobs: { title: string; detail: string; icon: string }[] }[] = [
  { id: "source", title: "Source", color: "gray", jobs: [{ title: "Merge to main", detail: "pull request", icon: "git-merge" }] },
  {
    id: "build",
    title: "Build",
    color: "blue",
    jobs: [
      { title: "Compile", detail: "npm run build", icon: "hammer" },
      { title: "Build image", detail: "docker build", icon: "package" },
    ],
  },
  {
    id: "test",
    title: "Test",
    color: "purple",
    jobs: [
      { title: "Unit tests", detail: "2 min", icon: "test-tube" },
      { title: "Lint", detail: "30 s", icon: "list-checks" },
      { title: "Security scan", detail: "dependencies", icon: "shield-check" },
    ],
  },
  {
    id: "staging",
    title: "Staging",
    color: "orange",
    jobs: [
      { title: "Deploy", detail: "to staging", icon: "rocket" },
      { title: "Smoke tests", detail: "end to end", icon: "flask-conical" },
    ],
  },
  {
    id: "production",
    title: "Production",
    color: "green",
    jobs: [
      { title: "Approval", detail: "release manager", icon: "user-check" },
      { title: "Deploy", detail: "rolling update", icon: "rocket" },
    ],
  },
];

/** One column per stage, its jobs stacked inside. */
const stageNodes: NodeSpec[] = STAGES.flatMap((stage, column) => {
  const x = column * (STAGE.w + STAGE.gap);
  return [
    { id: stage.id, shape: "basic/group", text: stage.title, x, y: 0, w: STAGE.w, h: STAGE.h, color: stage.color },
    ...stage.jobs.map((job, row) => ({
      id: `${stage.id}-${row + 1}`,
      shape: "icons/card",
      text: `${job.title}\n${job.detail}`,
      icon: job.icon,
      parent: stage.id,
      x: x + (STAGE.w - STAGE.jobW) / 2,
      y: 48 + row * (STAGE.jobH + STAGE.jobGap),
      w: STAGE.jobW,
      h: STAGE.jobH,
      color: stage.color,
    })),
  ];
});

const stageEdges: EdgeSpec[] = STAGES.slice(1).map((stage, index) => ({ from: STAGES[index].id, to: stage.id, fromAnchor: "right", toAnchor: "left" }));

/* ----------------------------------------------------------- git branching */

const BRANCH_ROWS = { main: 50, release: 130, develop: 210, feature: 290 } as const;
const BRANCH_COLORS = { main: "blue", release: "green", develop: "purple", feature: "orange" } as const;
type Branch = keyof typeof BRANCH_ROWS;

const COMMIT = 24;

const branchName = (branch: Branch, text: string): NodeSpec => ({
  id: `${branch}-name`,
  shape: "basic/pill",
  text,
  x: 0,
  y: BRANCH_ROWS[branch] - 3,
  w: 120,
  h: 30,
  color: BRANCH_COLORS[branch],
  style: { fontFamily: "mono", fontSize: 12, bold: true },
});

const commit = (id: string, branch: Branch, x: number): NodeSpec => ({
  id,
  shape: "basic/circle",
  x,
  y: BRANCH_ROWS[branch],
  w: COMMIT,
  h: COMMIT,
  color: BRANCH_COLORS[branch],
  style: { strokeWidth: 2.5 },
});

/** Consecutive commits on one branch. */
const history = (branch: Branch, from: string, to: string): EdgeSpec => ({
  from,
  to,
  kind: "line",
  routing: "straight",
  color: BRANCH_COLORS[branch],
  style: { strokeWidth: 2.5 },
});

/** A branch being created or merged, drawn in the colour of the short-lived branch. */
const branchOrMerge = (branch: Branch, from: string, to: string): EdgeSpec => ({ from, to, kind: "flow", color: BRANCH_COLORS[branch], style: { strokeWidth: 2 } });

/* ----------------------------------------------------------- event storming */

const STICKY = { size: 110, step: 120 };

const STICKY_KINDS = {
  event: "orange",
  command: "blue",
  aggregate: "yellow",
  policy: "purple",
  external: "pink",
  "read-model": "green",
} as const;

const sticky = (id: string, kind: keyof typeof STICKY_KINDS, text: string, column: number, y: number): NodeSpec => ({
  id,
  shape: "basic/note",
  text,
  x: 40 + column * STICKY.step,
  y,
  w: STICKY.size,
  h: STICKY.size,
  color: STICKY_KINDS[kind],
  style: { fontSize: 14 },
});

/* -------------------------------------------------------------- module map */

const folder = (id: string, name: string, purpose: string, color = "blue"): NodeSpec => ({ id, shape: "icons/card", text: `${name}\n${purpose}`, icon: "folder", color });
const sourceFile = (id: string, name: string, purpose: string): NodeSpec => ({ id, shape: "icons/card", text: `${name}\n${purpose}`, icon: "file-code", color: "gray" });

/* ------------------------------------------------------------------ types */

export const SOFTWARE_TYPES: DiagramTypeDef[] = [
  {
    id: "system-architecture",
    name: "System architecture",
    category: "software",
    description: "The main building blocks of a system (clients, services, data stores, queues) and how requests and data move between them.",
    keywords: ["architecture", "system design", "boxes and arrows", "high-level design", "hld", "components", "backend", "infrastructure", "tech stack"],
    libraries: ["infra", "icons", "basic"],
    defaultShape: "infra/service",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 32, 56),
    agentGuide:
      "Use the infra tiles for each building block: infra/browser and infra/mobile-app for clients, infra/api-gateway or infra/load-balancer for the entry point, infra/service and infra/worker for code you run, infra/sql-database, infra/cache and infra/object-storage for data, infra/queue or infra/event-bus for messaging, infra/external-service for third parties (icons/tile with any icon covers the rest). Group a subsystem in a basic/group container (set `parent`), connect with flow edges in the direction of the call, use dashed for asynchronous flows and label edges with the protocol or payload.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "web", shape: "infra/browser", text: "Web shop" },
        { id: "mobile", shape: "infra/mobile-app", text: "Mobile app" },
        { id: "gateway", shape: "infra/api-gateway", text: "API gateway" },
        { id: "catalogue", shape: "infra/service", text: "Catalogue service" },
        { id: "orders", shape: "infra/service", text: "Order service" },
        { id: "cache", shape: "infra/cache", text: "Product cache" },
        { id: "database", shape: "infra/sql-database", text: "Orders database" },
        { id: "queue", shape: "infra/queue", text: "Job queue" },
        { id: "payments", shape: "infra/external-service", text: "Payment provider" },
        { id: "mailer", shape: "infra/worker", text: "Email worker" },
      ],
      edges: [
        { from: "web", to: "gateway", text: "HTTPS" },
        { from: "mobile", to: "gateway", text: "HTTPS" },
        { from: "gateway", to: "catalogue" },
        { from: "gateway", to: "orders" },
        { from: "catalogue", to: "cache" },
        { from: "catalogue", to: "database" },
        { from: "orders", to: "database" },
        { from: "orders", to: "queue", kind: "dashed" },
        { from: "orders", to: "payments" },
        { from: "queue", to: "mailer", kind: "dashed" },
      ],
    },
  },
  {
    id: "c4-context",
    name: "C4 system context",
    category: "software",
    description: "C4 level 1: one software system in the middle, the people who use it and the other systems it talks to.",
    keywords: ["c4", "c4 model", "context diagram", "system context", "level 1", "simon brown", "landscape"],
    libraries: ["c4", "basic"],
    defaultShape: "c4/software-system",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 48, 40),
    agentGuide:
      "Use c4/person for users, one c4/software-system for the system in scope and c4/external-system (or c4/external-person) for everything outside your control; write each text as 'Name\\n[Person]' or 'Name\\n[Software System]' followed by a one-line description. Connect with flow edges labelled with a verb phrase (\"Places orders using\"); do not show containers or technology at this level.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "customer", shape: "c4/person", text: "Customer\n[Person]\nBrowses products and places orders." },
        { id: "shop", shape: "c4/software-system", text: "Online Shop\n[Software System]\nLets customers buy products and track their deliveries." },
        { id: "payments", shape: "c4/external-system", text: "Payment Provider\n[Software System]\nAuthorises and captures card payments." },
        { id: "email", shape: "c4/external-system", text: "Email Service\n[Software System]\nDelivers order confirmations." },
        { id: "warehouse", shape: "c4/external-system", text: "Warehouse System\n[Software System]\nPicks, packs and ships parcels." },
      ],
      edges: [
        { from: "customer", to: "shop", text: "Places orders using" },
        { from: "shop", to: "payments", text: "Takes payments with" },
        { from: "shop", to: "email", text: "Sends emails with" },
        { from: "shop", to: "warehouse", text: "Sends orders to" },
      ],
    },
  },
  {
    id: "c4-container",
    name: "C4 container diagram",
    category: "software",
    description: "C4 level 2: the applications, services and data stores that make up one software system, and the technology each one uses.",
    keywords: ["c4", "c4 model", "container diagram", "level 2", "applications", "deployable units", "simon brown"],
    libraries: ["c4", "basic"],
    defaultShape: "c4/container",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 48, 28),
    agentGuide:
      "Draw the system as a c4/system-boundary container and put its deployable units inside (set `parent`): c4/web-app, c4/mobile-app, c4/container for services and APIs, c4/database, c4/queue. Text is 'Name\\n[Container: technology]\\ndescription'. Keep c4/person and c4/external-system outside the boundary and label every flow edge with what is exchanged and the protocol (\"JSON/HTTPS\").",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "customer", shape: "c4/person", text: "Customer\n[Person]\nBrowses products and places orders." },
        { id: "staff", shape: "c4/person", text: "Shop Staff\n[Person]\nManages products and orders." },
        { id: "shop", shape: "c4/system-boundary", text: "Online Shop\n[Software System]" },
        { id: "web", shape: "c4/web-app", text: "Web Shop\n[Container: React]\nThe storefront.", parent: "shop" },
        { id: "admin", shape: "c4/web-app", text: "Admin Console\n[Container: React]\nBack-office screens.", parent: "shop" },
        { id: "api", shape: "c4/container", text: "Shop API\n[Container: Node.js]\nCatalogue and checkout.", parent: "shop" },
        { id: "database", shape: "c4/database", text: "Database\n[Container: PostgreSQL]\nProducts and orders.", parent: "shop" },
        { id: "events", shape: "c4/queue", text: "Order Events\n[Container: RabbitMQ]\nOrders to fulfil.", parent: "shop" },
        { id: "warehouse", shape: "c4/external-system", text: "Warehouse System\n[Software System]\nPicks, packs and ships parcels." },
      ],
      edges: [
        { from: "customer", to: "web", text: "Shops using" },
        { from: "staff", to: "admin", text: "Manages with" },
        { from: "web", to: "api", text: "JSON/HTTPS" },
        { from: "admin", to: "api", text: "JSON/HTTPS" },
        { from: "api", to: "database", text: "SQL" },
        { from: "api", to: "events", text: "Publishes" },
        { from: "events", to: "warehouse", text: "Orders to ship" },
      ],
    },
  },
  {
    id: "c4-component",
    name: "C4 component diagram",
    category: "software",
    description: "C4 level 3: the components inside one container, their responsibilities and how they collaborate.",
    keywords: ["c4", "c4 model", "component diagram", "level 3", "modules", "internal structure", "simon brown"],
    libraries: ["c4", "basic"],
    defaultShape: "c4/component",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 36),
    agentGuide:
      "Draw the container being zoomed into as a c4/container-boundary and put c4/component nodes inside (set `parent`), each written as 'Name\\n[Component: technology]\\nresponsibility'. Show the neighbouring containers (c4/web-app, c4/database, c4/queue) and c4/external-system nodes outside the boundary, and label the flow edges with what one element asks of the other.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "web", shape: "c4/web-app", text: "Web Shop\n[Container: React]\nThe storefront in the browser." },
        { id: "api", shape: "c4/container-boundary", text: "Shop API\n[Container: Node.js]" },
        { id: "sign-in", shape: "c4/component", text: "Sign-in Controller\n[Component: REST controller]\nSigns customers in.", parent: "api" },
        { id: "checkout", shape: "c4/component", text: "Checkout Controller\n[Component: REST controller]\nTurns a basket into an order.", parent: "api" },
        { id: "security", shape: "c4/component", text: "Security Component\n[Component: Service]\nChecks passwords and tokens.", parent: "api" },
        { id: "repository", shape: "c4/component", text: "Order Repository\n[Component: Repository]\nReads and writes orders.", parent: "api" },
        { id: "client", shape: "c4/component", text: "Payment Client\n[Component: HTTP client]\nWraps the provider API.", parent: "api" },
        { id: "database", shape: "c4/database", text: "Database\n[Container: PostgreSQL]\nCustomers and orders." },
        { id: "payments", shape: "c4/external-system", text: "Payment Provider\n[Software System]\nAuthorises card payments." },
      ],
      edges: [
        { from: "web", to: "sign-in", text: "JSON/HTTPS" },
        { from: "web", to: "checkout", text: "JSON/HTTPS" },
        { from: "sign-in", to: "security", text: "Uses" },
        { from: "checkout", to: "repository", text: "Uses" },
        { from: "checkout", to: "client", text: "Uses" },
        { from: "security", to: "database", text: "SQL" },
        { from: "repository", to: "database", text: "SQL" },
        { from: "client", to: "payments", text: "REST/HTTPS" },
      ],
    },
  },
  {
    id: "microservices",
    name: "Microservices architecture",
    category: "software",
    description: "Independently deployable services, each owning its data, behind an API gateway and talking through events.",
    keywords: ["microservices", "services", "service mesh", "event-driven", "distributed system", "api gateway", "database per service", "soa"],
    libraries: ["infra", "icons", "basic"],
    defaultShape: "infra/service",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 32, 48),
    agentGuide:
      "Draw each bounded context as a basic/group container holding its infra/service and the data store it owns (infra/sql-database, infra/nosql-database, infra/cache); never share a database between groups. Put infra/api-gateway in front, use flow edges for synchronous calls and dashed edges through infra/event-bus, infra/queue or infra/topic for asynchronous events, labelled with the event name.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "clients", shape: "infra/users", text: "Web and mobile clients" },
        { id: "gateway", shape: "infra/api-gateway", text: "API gateway" },
        { id: "ordering", shape: "basic/group", text: "Ordering" },
        { id: "order-service", shape: "infra/service", text: "Order service", parent: "ordering" },
        { id: "order-db", shape: "infra/sql-database", text: "Orders", parent: "ordering" },
        { id: "inventory", shape: "basic/group", text: "Inventory" },
        { id: "stock-service", shape: "infra/service", text: "Stock service", parent: "inventory" },
        { id: "stock-db", shape: "infra/nosql-database", text: "Stock levels", parent: "inventory" },
        { id: "bus", shape: "infra/event-bus", text: "Event bus" },
        { id: "notifications", shape: "infra/function", text: "Notification function" },
        { id: "analytics", shape: "infra/data-warehouse", text: "Analytics" },
      ],
      edges: [
        { from: "clients", to: "gateway" },
        { from: "gateway", to: "order-service" },
        { from: "gateway", to: "stock-service" },
        { from: "order-service", to: "order-db" },
        { from: "stock-service", to: "stock-db" },
        { from: "order-service", to: "bus", kind: "dashed" },
        { from: "stock-service", to: "bus", kind: "dashed" },
        { from: "bus", to: "notifications", kind: "dashed" },
        { from: "bus", to: "analytics", kind: "dashed" },
      ],
    },
  },
  {
    id: "layered-architecture",
    name: "Layered architecture",
    category: "software",
    description: "An application sliced into horizontal layers (presentation, application, domain, infrastructure) where each layer only depends on the one below.",
    keywords: ["layered architecture", "n-tier", "three-tier", "layers", "onion architecture", "clean architecture", "tiers", "separation of concerns"],
    libraries: ["basic", "icons"],
    defaultShape: "basic/rounded",
    routing: "straight",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Stack one wide basic/group container per layer with explicit coordinates (layout 'none'), top layer first, and place the parts of each layer inside as basic/rounded nodes (set `parent`). Draw a single flow edge from each layer container to the one directly below it to show the allowed dependency direction; a dependency that skips or reverses a layer is drawn node to node with the dependency edge kind.",
    support: "generic",
    template: { layout: "none", nodes: bandNodes, edges: bandEdges },
  },
  {
    id: "hexagonal-architecture",
    name: "Hexagonal architecture",
    category: "software",
    description: "Ports and adapters: the application core in a hexagon, the adapters that drive it on the left and the adapters it drives on the right.",
    keywords: ["hexagonal", "ports and adapters", "clean architecture", "onion architecture", "domain-driven design", "ddd", "adapters", "alistair cockburn"],
    libraries: ["basic", "icons"],
    defaultShape: "basic/rounded",
    routing: "straight",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "There is no dedicated notation: place a large basic/hexagon with style.fill 'none' as the application core (layout 'none', explicit coordinates) and put the use cases, the domain model and the ports (basic/pill) inside it. Driving adapters (REST, CLI, consumers) go on the left with flow edges into the inbound ports; driven adapters (database, payment, email) go on the right with implementation edges pointing at the outbound ports they implement.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        { id: "core", shape: "basic/hexagon", x: 240, y: 0, w: 540, h: 420, style: { fill: "none", stroke: "#2f6fed", strokeWidth: 2 } },
        label("core-title", "Application core", { x: 410, y: 28, w: 200, h: 30 }, { bold: true, fontSize: 16, textColor: "#123a8f" }),
        label("driving-title", "Driving adapters", { x: 0, y: 40, w: 170, h: 24 }, { ...MUTED_TEXT, bold: true }),
        label("driven-title", "Driven adapters", { x: 850, y: 40, w: 170, h: 24 }, { ...MUTED_TEXT, bold: true }),
        { id: "rest", text: "REST controller", x: 0, y: 80, w: 170, h: 50, color: "green" },
        { id: "cli", text: "Admin CLI", x: 0, y: 185, w: 170, h: 50, color: "green" },
        { id: "consumer", text: "Event consumer", x: 0, y: 290, w: 170, h: 50, color: "green" },
        { id: "inbound", shape: "basic/pill", text: "Inbound ports", x: 290, y: 186, w: 130, h: 48, color: "blue" },
        { id: "use-cases", text: "Use cases", x: 440, y: 100, w: 140, h: 56, color: "blue" },
        { id: "domain", shape: "basic/hexagon", text: "Domain model", x: 430, y: 250, w: 160, h: 90, color: "purple" },
        { id: "outbound", shape: "basic/pill", text: "Outbound ports", x: 600, y: 186, w: 130, h: 48, color: "blue" },
        { id: "sql", text: "SQL repository", x: 850, y: 80, w: 170, h: 50, color: "orange" },
        { id: "payment", text: "Payment client", x: 850, y: 185, w: 170, h: 50, color: "orange" },
        { id: "mailer", text: "Email sender", x: 850, y: 290, w: 170, h: 50, color: "orange" },
      ],
      edges: [
        { from: "rest", to: "inbound" },
        { from: "cli", to: "inbound" },
        { from: "consumer", to: "inbound" },
        { from: "inbound", to: "use-cases" },
        { from: "use-cases", to: "domain" },
        { from: "use-cases", to: "outbound" },
        { from: "sql", to: "outbound", kind: "implementation" },
        { from: "payment", to: "outbound", kind: "implementation" },
        { from: "mailer", to: "outbound", kind: "implementation" },
      ],
    },
  },
  {
    id: "api-request-flow",
    name: "API request flow",
    category: "software",
    description: "The path of one request through the system, hop by hop, with numbered steps from the client to the database and back.",
    keywords: ["api", "request flow", "request lifecycle", "rest", "http", "call flow", "round trip", "request path", "endpoint"],
    libraries: ["infra", "icons", "basic"],
    defaultShape: "infra/service",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 48, 64),
    agentGuide:
      "Draw each hop as an infra tile (infra/browser or infra/mobile-app, infra/api-gateway, infra/identity-provider, infra/service, infra/cache, infra/sql-database) and one flow edge per step, labelled with its order and what is sent (\"1 POST /orders\"). Draw responses with the return edge kind (dashed) in the opposite direction; when the exact timing between participants matters more than the components, use a uml-sequence diagram instead.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "browser", shape: "infra/browser", text: "Browser", x: 0, y: 170 },
        { id: "gateway", shape: "infra/api-gateway", text: "API gateway", x: 290, y: 170 },
        { id: "auth", shape: "infra/identity-provider", text: "Auth service", x: 290, y: 0 },
        { id: "orders", shape: "infra/service", text: "Order service", x: 580, y: 170 },
        { id: "cache", shape: "infra/cache", text: "Price cache", x: 860, y: 80 },
        { id: "database", shape: "infra/sql-database", text: "Orders database", x: 860, y: 260 },
      ],
      edges: [
        { from: "browser", to: "gateway", text: "1 POST /orders", fromAnchor: { x: 1, y: 0.3 }, toAnchor: { x: 0, y: 0.3 } },
        { from: "gateway", to: "auth", text: "2 Verify token", fromAnchor: "top", toAnchor: "bottom" },
        { from: "gateway", to: "orders", text: "3 Create order", fromAnchor: "right", toAnchor: "left" },
        { from: "orders", to: "cache", text: "4 Get prices", fromAnchor: { x: 1, y: 0.3 }, toAnchor: "left" },
        { from: "orders", to: "database", text: "5 INSERT", fromAnchor: { x: 1, y: 0.7 }, toAnchor: "left" },
        { from: "gateway", to: "browser", text: "6 201 Created", kind: "return", fromAnchor: { x: 0, y: 0.7 }, toAnchor: { x: 1, y: 0.7 } },
      ],
    },
  },
  {
    id: "data-flow-diagram",
    name: "Data flow diagram",
    category: "software",
    description: "How data moves between external entities, processes and data stores (DFD), without showing control flow or timing.",
    keywords: ["dfd", "data flow", "data flow diagram", "yourdon", "gane sarson", "context diagram", "level 0", "structured analysis"],
    libraries: ["dfd", "basic"],
    defaultShape: "dfd/process",
    routing: "straight",
    edgeKind: "flow",
    layout: layered("down", 64, 32),
    agentGuide:
      "Use dfd/external-entity for people and systems outside the model, dfd/process for each transformation (verb phrase as text, data.number such as '1.0' for its number) and dfd/data-store for data at rest (data.id such as 'D1'). Every connector is a flow edge labelled with the data it carries (a noun: \"Order details\"); data never flows directly between two stores or two external entities.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "customer", shape: "dfd/external-entity", text: "Customer", x: 0, y: 170, w: 140, h: 70 },
        { id: "products", shape: "dfd/data-store", text: "Products", data: { id: "D2" }, x: 250, y: 10, w: 160, h: 50 },
        { id: "take-order", shape: "dfd/process", text: "Take order", data: { number: "1.0" }, x: 270, y: 145, w: 120, h: 120 },
        { id: "bank", shape: "dfd/external-entity", text: "Bank", x: 520, y: 0, w: 140, h: 70 },
        { id: "take-payment", shape: "dfd/process", text: "Take payment", data: { number: "2.0" }, x: 530, y: 145, w: 120, h: 120 },
        { id: "orders", shape: "dfd/data-store", text: "Orders", data: { id: "D1" }, x: 510, y: 350, w: 160, h: 50 },
        { id: "courier", shape: "dfd/external-entity", text: "Courier", x: 780, y: 0, w: 140, h: 70 },
        { id: "ship-order", shape: "dfd/process", text: "Ship order", data: { number: "3.0" }, x: 790, y: 145, w: 120, h: 120 },
      ],
      edges: [
        { from: "customer", to: "take-order", text: "Order details" },
        { from: "products", to: "take-order", text: "Prices" },
        { from: "take-order", to: "take-payment", text: "Amount due" },
        { from: "take-order", to: "orders", text: "New order" },
        { from: "take-payment", to: "bank", text: "Charge" },
        { from: "take-payment", to: "ship-order", text: "Paid order" },
        { from: "orders", to: "ship-order", text: "Address" },
        { from: "ship-order", to: "courier", text: "Parcel label" },
      ],
    },
  },
  {
    id: "dependency-graph",
    name: "Dependency graph",
    category: "software",
    description: "Which modules, packages or services depend on which, to spot coupling, layering violations and cycles.",
    keywords: ["dependency graph", "dependencies", "imports", "module graph", "package graph", "coupling", "call graph", "dag", "build graph"],
    libraries: ["basic", "uml"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "dependency",
    layout: layered("down", 44, 64),
    agentGuide:
      "Draw each module or package as a basic/rounded node and connect it to what it imports with the dependency edge kind (dashed, arrow pointing at the thing depended on). Keep entry points at the top and shared libraries at the bottom, colour third-party packages gray, and highlight a forbidden or circular dependency by giving that edge the colour red.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "web", text: "apps/web", color: "blue" },
        { id: "api", text: "apps/api", color: "blue" },
        { id: "ui", text: "packages/ui", color: "teal" },
        { id: "auth", text: "packages/auth", color: "teal" },
        { id: "db", text: "packages/db", color: "teal" },
        { id: "utils", text: "packages/utils", color: "teal" },
        { id: "react", text: "react", color: "gray" },
        { id: "postgres", text: "pg", color: "gray" },
      ],
      edges: [
        { from: "web", to: "ui", kind: "dependency" },
        { from: "web", to: "auth", kind: "dependency" },
        { from: "api", to: "auth", kind: "dependency" },
        { from: "api", to: "db", kind: "dependency" },
        { from: "ui", to: "react", kind: "dependency" },
        { from: "ui", to: "utils", kind: "dependency" },
        { from: "auth", to: "utils", kind: "dependency" },
        { from: "auth", to: "db", kind: "dependency" },
        { from: "db", to: "postgres", kind: "dependency" },
        { from: "ui", to: "db", kind: "dependency", color: "red", text: "not allowed" },
      ],
    },
  },
  {
    id: "block-diagram",
    name: "Block diagram",
    category: "software",
    description: "A system reduced to its functional blocks and the signals or data passed between them, without committing to any notation.",
    keywords: ["block diagram", "functional block diagram", "boxes", "high level", "overview", "system overview", "schematic", "subsystems"],
    libraries: ["basic", "icons"],
    defaultShape: "basic/rect",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 36, 48),
    agentGuide:
      "Draw every function or subsystem as a basic/rect (basic/rounded for external parts, basic/cylinder for storage) with a short noun as text, and connect them with flow edges labelled with the signal or data passed; use the bidirectional edge kind for two-way links. Group blocks that belong to one unit in a basic/group container. For feedback control loops use the control-block-diagram type instead.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "sensor", shape: "basic/rounded", text: "Temperature\nsensor", color: "green" },
        { id: "buttons", shape: "basic/rounded", text: "Touch buttons", color: "green" },
        { id: "device", shape: "basic/group", text: "Thermostat" },
        { id: "controller", text: "Microcontroller", parent: "device", color: "blue" },
        { id: "display", text: "Display driver", parent: "device" },
        { id: "relay", text: "Relay driver", parent: "device" },
        { id: "wifi", text: "Wi-Fi module", parent: "device" },
        { id: "screen", shape: "basic/rounded", text: "LCD screen", color: "orange" },
        { id: "heater", shape: "basic/rounded", text: "Boiler", color: "orange" },
        { id: "cloud", shape: "basic/cloud", text: "Cloud API", color: "gray" },
      ],
      edges: [
        { from: "sensor", to: "controller", text: "reading" },
        { from: "buttons", to: "controller", text: "set point" },
        { from: "controller", to: "display" },
        { from: "controller", to: "relay", text: "on / off" },
        { from: "controller", to: "wifi", kind: "bidirectional" },
        { from: "display", to: "screen" },
        { from: "relay", to: "heater" },
        { from: "wifi", to: "cloud", kind: "bidirectional" },
      ],
    },
  },
  {
    id: "ci-cd-pipeline",
    name: "CI/CD pipeline",
    category: "software",
    description: "The stages a change goes through from commit to production: build, test, release and deploy, with the jobs in each stage.",
    keywords: ["ci/cd", "cicd", "pipeline", "continuous integration", "continuous delivery", "deployment pipeline", "build pipeline", "devops", "github actions", "release"],
    libraries: ["infra", "icons", "basic"],
    defaultShape: "icons/card",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 24, 56),
    agentGuide:
      "Draw one basic/group container per stage, left to right, and put its jobs inside as icons/card nodes (text 'Job\\ndetail', an `icon` such as hammer, test-tube, shield-check, rocket, user-check); connect consecutive stages container to container with flow edges. Use the infra/git-repo, infra/ci-cd and infra/artifact-registry tiles for the systems around the pipeline, and a dashed edge for manual or optional transitions.",
    support: "generic",
    template: { layout: "none", nodes: stageNodes, edges: stageEdges },
  },
  {
    id: "git-branching",
    name: "Git branching",
    category: "software",
    description: "How branches are created and merged over time (Gitflow, trunk-based, release branches), one row per branch.",
    keywords: ["git", "gitflow", "git flow", "branching strategy", "branches", "merge", "trunk-based", "release branch", "version control", "commits"],
    libraries: ["basic", "icons"],
    defaultShape: "basic/circle",
    routing: "curved",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "There are no dedicated Git shapes: give each branch a row with explicit coordinates (layout 'none'), a basic/pill with the branch name at the left and one small basic/circle (about 24px) per commit, time running left to right and one colour per branch. Join consecutive commits of a branch with straight line edges, draw branching and merging as curved flow edges between rows in the colour of the short-lived branch, and mark tags with basic/text above the commit.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        branchName("main", "main"),
        branchName("release", "release/1.1"),
        branchName("develop", "develop"),
        branchName("feature", "feature/login"),
        commit("main-1", "main", 170),
        commit("main-2", "main", 830),
        commit("develop-1", "develop", 250),
        commit("develop-2", "develop", 410),
        commit("develop-3", "develop", 570),
        commit("develop-4", "develop", 910),
        commit("feature-1", "feature", 330),
        commit("feature-2", "feature", 490),
        commit("release-1", "release", 650),
        commit("release-2", "release", 740),
        label("tag-1", "v1.0", { x: 152, y: 16, w: 60, h: 24 }, { fontFamily: "mono", fontSize: 12, bold: true }),
        label("tag-2", "v1.1", { x: 812, y: 16, w: 60, h: 24 }, { fontFamily: "mono", fontSize: 12, bold: true }),
        label("release-note", "bug fixes only", { x: 652, y: 160, w: 110, h: 20 }, { ...MUTED_TEXT, fontSize: 11 }),
      ],
      edges: [
        history("main", "main-1", "main-2"),
        history("develop", "develop-1", "develop-2"),
        history("develop", "develop-2", "develop-3"),
        history("develop", "develop-3", "develop-4"),
        history("feature", "feature-1", "feature-2"),
        history("release", "release-1", "release-2"),
        branchOrMerge("develop", "main-1", "develop-1"),
        branchOrMerge("feature", "develop-1", "feature-1"),
        branchOrMerge("feature", "feature-2", "develop-3"),
        branchOrMerge("release", "develop-3", "release-1"),
        branchOrMerge("release", "release-2", "main-2"),
        branchOrMerge("release", "release-2", "develop-4"),
      ],
    },
  },
  {
    id: "event-storming",
    name: "Event storming",
    category: "software",
    description: "A domain explored as a timeline of colour-coded sticky notes: commands, aggregates, domain events, policies, external systems and read models.",
    keywords: ["event storming", "domain-driven design", "ddd", "domain events", "big picture", "workshop", "bounded context", "aggregates", "sticky notes"],
    libraries: ["basic", "strategy"],
    defaultShape: "basic/note",
    routing: "curved",
    edgeKind: "flow",
    layout: { algorithm: "grid", direction: "right", spacing: 16 },
    agentGuide:
      "Use basic/note for every sticky, placed left to right in time order with explicit coordinates (layout 'none'), and follow the colour grammar: orange domain event (past tense), blue command, yellow aggregate or actor, purple policy (\"whenever…\"), pink external system, green read model. The usual chain is actor → command → aggregate → event → policy → next command; add a strategy/legend with the colours, and no connectors.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        sticky("place-order", "command", "Place order", 0, 50),
        { id: "customer", shape: "basic/note", text: "Customer", x: 0, y: 0, w: 90, h: 56, color: "yellow", style: { fontSize: 13 } },
        sticky("order", "aggregate", "Order", 1, 50),
        sticky("order-placed", "event", "Order placed", 2, 50),
        sticky("payment-policy", "policy", "Whenever an order is placed, charge the card", 3, 50),
        sticky("charge-card", "command", "Charge card", 4, 50),
        sticky("payment-provider", "external", "Payment provider", 5, 50),
        sticky("payment-received", "event", "Payment received", 6, 50),
        sticky("shipping-policy", "policy", "Whenever a payment is received, ship the order", 0, 210),
        sticky("ship-order", "command", "Ship order", 1, 210),
        sticky("shipment", "aggregate", "Shipment", 2, 210),
        sticky("order-shipped", "event", "Order shipped", 3, 210),
        sticky("tracking", "read-model", "Tracking page", 4, 210),
        {
          id: "legend",
          shape: "strategy/legend",
          text: "Sticky notes\n---\n#e8792a Domain event\n#2f6fed Command\n#d99a00 Aggregate / actor\n#7b4fe0 Policy\n#d6478f External system\n#2f9e44 Read model",
          x: 680,
          y: 190,
          w: 190,
          h: 180,
        },
      ],
      edges: [],
    },
  },
  {
    id: "module-map",
    name: "Module map",
    category: "software",
    description: "A codebase at a glance: its folders and key modules as a tree, with a line on what each one is responsible for.",
    keywords: ["module map", "codebase map", "code structure", "folder structure", "project structure", "repository map", "source tree", "directory tree", "packages"],
    libraries: ["icons", "basic", "uml"],
    defaultShape: "icons/card",
    routing: "orthogonal",
    edgeKind: "line",
    layout: layered("right", 14, 48),
    agentGuide:
      "Draw a strict tree from the repository root: every folder and key file is an icons/card with text 'name\\nwhat it is responsible for' and `icon` 'folder' (folders) or 'file-code' (files), joined parent to child with line edges. Show only what matters for orientation (two or three levels); to show which module imports which, use the dependency-graph type instead.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "repo", shape: "icons/card", text: "shop-app\nrepository root", icon: "folder-tree", color: "dark" },
        folder("app", "src/app", "pages and routes"),
        folder("core", "src/core", "domain logic"),
        folder("server", "src/server", "API and jobs"),
        sourceFile("checkout", "checkout/page.tsx", "checkout screen"),
        sourceFile("catalogue", "products/page.tsx", "product list"),
        sourceFile("pricing", "pricing.ts", "prices and taxes"),
        sourceFile("orders", "orders.ts", "order lifecycle"),
        sourceFile("api", "api.ts", "REST endpoints"),
        sourceFile("worker", "worker.ts", "background jobs"),
      ],
      edges: [
        { from: "repo", to: "app", kind: "line" },
        { from: "repo", to: "core", kind: "line" },
        { from: "repo", to: "server", kind: "line" },
        { from: "app", to: "checkout", kind: "line" },
        { from: "app", to: "catalogue", kind: "line" },
        { from: "core", to: "pricing", kind: "line" },
        { from: "core", to: "orders", kind: "line" },
        { from: "server", to: "api", kind: "line" },
        { from: "server", to: "worker", kind: "line" },
      ],
    },
  },
];
