# Notation cheat sheet

Which diagram type, shapes and edge kinds express each notation correctly. Every id below is checked against the shape registry, the edge kinds and the diagram catalog by `src/server/mcp/guide.test.ts`, so it is safe to use as written. `diagram_create` returns the same guidance for the type you pick, and `diagram_list_shapes` with a `library` lists every shape of a library.

Conventions for all notations: omit x/y; give each node a short kebab-case `id`; `\n` breaks a line in a label; an edge's `kind` defaults to `flow`.

## Flowchart

- Types: `flowchart`, `decision-tree`, `user-flow`
- Shapes: `flowchart/terminator`, `flowchart/process`, `flowchart/decision`, `flowchart/data`, `flowchart/document`, `flowchart/predefined-process`, `flowchart/connector`
- Edge kinds: `flow`
- Text: short verb phrases for steps ("Validate order"), a question for a decision ("In stock?").
- Tips: one terminator at the start and one per outcome at the end. Label every edge that leaves a decision (Yes / No). Keep one main direction; the default layout is top to bottom.

## UML class

- Types: `uml-class`
- Shapes: `uml/class`, `uml/interface`, `uml/enum`, `uml/package`, `uml/note`
- Edge kinds: `inheritance`, `implementation`, `association`, `aggregation`, `composition`, `dependency`
- Text: `Name\n---\n+ id: UUID\n- email: string\n---\n+ login(): void`. Visibility is `+`, `-` or `#`. `data: { abstract: true }` italicises the name.
- Tips: inheritance points child to parent; implementation points class to interface; aggregation and composition point whole to part. Multiplicities go in `startText` / `endText`, a role or verb in `text`. The default layout puts parents at the top.

## UML sequence

- Types: `uml-sequence`, `tool-calling-sequence`
- Shapes: `uml/lifeline`, `uml/actor-lifeline`, `uml/fragment`, `uml/activation`
- Edge kinds: `message`, `async`, `return`
- Text: participants and messages are arguments of `diagram_build_sequence`, not nodes.
- Tips: participants in the order they first act; `kind: "actor"` for people and outside callers. Messages are `sync` (solid arrow), `async` (open arrow) or `return` (dashed); a message from a participant to itself draws a self-call. Fragments (alt, opt, loop) and activation bars are shapes you add by hand afterwards. Never run `diagram_layout` on it.

## UML activity and state machine

- Types: `uml-activity`, `uml-state-machine`
- Shapes: `uml/initial-state`, `uml/action`, `uml/choice`, `uml/fork-join`, `uml/object-node`, `uml/activity-final`, `uml/flow-final`, `uml/swimlane`, `uml/state`, `uml/final-state`, `uml/history`
- Edge kinds: `flow`
- Text: guards in square brackets on the outgoing edge of a `uml/choice` ("[in stock]"); transitions as `event [guard] / action`; state internals after a `---` line ("entry / reserveStock()").
- Tips: activity diagrams start at `uml/initial-state` and end at `uml/activity-final`; `uml/fork-join` bars split and rejoin parallel flows; `uml/swimlane` containers group actions by role. State machines use `uml/state` for states and `uml/choice` for branching on guards.

## UML use case, component and deployment

- Types: `uml-use-case`, `uml-component`, `uml-deployment`
- Shapes: `uml/actor`, `uml/use-case`, `uml/system-boundary`, `uml/component`, `uml/interface`, `uml/package`, `uml/node`, `uml/artifact`
- Edge kinds: `line`, `include`, `inheritance`, `dependency`, `implementation`
- Tips: use cases sit inside a `uml/system-boundary` (set `parent`), actors outside it, joined with `line`. Use `include` with the text "include" or "extend" between use cases. Components point at what they require with `dependency`, labelled with the interface or protocol. Deployment nodes are `uml/node` containers holding `uml/artifact` nodes.

## ER diagram and database schema

- Types: `er-diagram`, `database-schema`, `er-chen`
- Shapes: `er/entity`, `er/view`, `er/strong-entity`, `er/weak-entity`, `er/relationship`, `er/attribute`, `er/key-attribute`, `er/multivalued-attribute`, `er/derived-attribute`
- Edge kinds: `one-to-many`, `zero-to-many`, `many-to-one`, `one-to-one`, `zero-to-one`, `many-to-many`, `dashed`, `line`
- Text: `er/entity` is `table_name\n---\nPK id: uuid\nFK customer_id: uuid\nstatus: varchar` (one column per line). For `database-schema` add a second `---` section for indexes and constraints.
- Tips: draw each edge from the referenced table to the table that holds the foreign key. `zero-to-many` is the safe default for a parent and its children; `one-to-many` when at least one child is required; `one-to-one` or `zero-to-one` for a unique foreign key. Resolve many-to-many through a junction table. Views (`er/view`) link to their source tables with `dashed`. `er-chen` uses `line` edges with the cardinality (1, N, M) as edge text.

## C4 model

- Types: `c4-context`, `c4-container`, `c4-component`
- Shapes: `c4/person`, `c4/external-person`, `c4/software-system`, `c4/external-system`, `c4/container`, `c4/web-app`, `c4/mobile-app`, `c4/database`, `c4/queue`, `c4/component`, `c4/system-boundary`, `c4/container-boundary`, `c4/enterprise-boundary`
- Edge kinds: `flow`, `dashed`
- Text: `Name\n[Container: technology]\ndescription`; at context level `Name\n[Software System]\ndescription`; at component level `Name\n[Component: technology]\nresponsibility`.
- Tips: context shows the system and its neighbours only, no technology. Container diagram: deployable units inside a `c4/system-boundary` (set `parent`), people and external systems outside it. Component diagram: `c4/component` nodes inside a `c4/container-boundary`. Label every edge with what is exchanged and the protocol ("JSON/HTTPS"); `dashed` for asynchronous links.

## BPMN and workflows

- Types: `bpmn-process`, `approval-workflow`, `swimlane`
- Shapes: `bpmn/start-event`, `bpmn/end-event`, `bpmn/intermediate-event`, `bpmn/timer-intermediate-event`, `bpmn/task`, `bpmn/user-task`, `bpmn/service-task`, `bpmn/send-task`, `bpmn/receive-task`, `bpmn/script-task`, `bpmn/subprocess`, `bpmn/gateway-exclusive`, `bpmn/gateway-parallel`, `bpmn/gateway-inclusive`, `bpmn/gateway-event`, `bpmn/data-object`, `bpmn/data-store`, `bpmn/pool`, `bpmn/lane`, `bpmn/annotation`, `uml/swimlane`, `flowchart/process`, `flowchart/decision`
- Edge kinds: `flow`, `dashed`
- Tips: one `bpmn/start-event` and one `bpmn/end-event` per outcome. `bpmn/gateway-exclusive` takes one path (label the outgoing edges), `bpmn/gateway-parallel` takes all. Group by participant with a `bpmn/pool` holding `bpmn/lane` containers (set `parent`); message flows between pools use `dashed`. The `swimlane` type uses `uml/swimlane` containers with explicit coordinates and `layout: "none"`; every edge crossing a lane border is a handoff.

## Infrastructure, cloud and network

- Types: `system-architecture`, `microservices`, `cloud-architecture`, `kubernetes`, `network-topology`, `api-request-flow`, `data-pipeline`, `infrastructure-deployment`
- Shapes: `infra/browser`, `infra/mobile-app`, `infra/users`, `infra/api-gateway`, `infra/load-balancer`, `infra/service`, `infra/worker`, `infra/function`, `infra/sql-database`, `infra/nosql-database`, `infra/cache`, `infra/object-storage`, `infra/queue`, `infra/event-bus`, `infra/stream`, `infra/cdn`, `infra/identity-provider`, `infra/external-service`, `infra/region`, `infra/vpc`, `infra/subnet`, `infra/cluster`, `infra/namespace`, `infra/pod`, `basic/group`
- Edge kinds: `flow`, `dashed`, `bidirectional`, `line`
- Text: `Name\ndetail` ("Orders API\nNode.js").
- Tips: tiles are colour coded by category (compute, data, messaging, network, security); keep the default colours unless you need a highlight. Nest `infra/region` > `infra/vpc` > `infra/subnet` with `parent`. Edges follow the call direction and carry the protocol; `dashed` for asynchronous flows and replication; `line` for network links. Microservices: one `basic/group` per bounded context holding its service and its own data store.

## AI agents and LLM systems

- Types: `agent-architecture`, `multi-agent-system`, `rag-pipeline`, `llm-chain`, `mcp-topology`, `agent-state-graph`
- Shapes: `ai/agent-boundary`, `ai/agent`, `ai/subagent`, `ai/orchestrator`, `ai/llm`, `ai/system-prompt`, `ai/memory`, `ai/tool`, `ai/mcp-server`, `ai/mcp-client`, `ai/api`, `ai/user`, `ai/vector-store`, `ai/knowledge-base`, `ai/chunker`, `ai/embedding-model`, `ai/retriever`, `ai/reranker`, `ai/guardrail`, `ai/human-in-the-loop`, `ai/output`, `ai/workflow`
- Edge kinds: `flow`, `bidirectional`, `dashed`, `dotted`
- Text: `Title\nsubtitle`.
- Tips: an `ai/agent-boundary` container holds the agent, its model, prompt, memory and one card per tool; the user and the external systems the tools reach stay outside. Use `bidirectional` where data goes both ways (agent and model). In `multi-agent-system`, delegation is `flow` from the orchestrator, shared reads and writes are `dotted`, feedback is `dashed`. `rag-pipeline` uses two `ai/workflow` containers (indexing, answering) with the `ai/vector-store` between them. Tool-calling traces are sequence diagrams: use `tool-calling-sequence` with `diagram_build_sequence`.

## Data flow and threat models

- Types: `data-flow-diagram`, `threat-model`
- Shapes: `dfd/external-entity`, `dfd/process`, `dfd/data-store`, `infra/security-group`
- Edge kinds: `flow`
- Tips: every connector is labelled with the data it carries (a noun: "Order details"); data never flows directly between two stores or two external entities. In a threat model wrap everything sharing a trust level in an `infra/security-group` (the trust boundary).

## Code structure

- Types: `dependency-graph`, `module-map`, `layered-architecture`
- Shapes: `basic/rounded`, `basic/group`, `icons/card`
- Edge kinds: `dependency`, `line`, `flow`
- Text: module-map cards are `name\nwhat it is responsible for` with `icon` set to `folder` or `file-code`.
- Tips: `dependency-graph` points each module at what it imports (entry points at the top); colour third-party packages gray and a forbidden or circular dependency red. `module-map` is a strict tree of folders joined parent to child with `line`, two or three levels deep. `layered-architecture` stacks `basic/group` bands with explicit coordinates and `layout: "none"`.

## Mind maps, org charts and planning

- Types: `mind-map`, `org-chart`, `roadmap`, `timeline`, `gantt-chart`, `kanban-board`
- Shapes: `org/mind-root`, `org/mind-topic`, `org/mind-subtopic`, `org/person`, `org/role`, `org/team`, `strategy/gantt-bar`, `strategy/gantt-milestone`, `strategy/timeline-axis`, `strategy/timeline-milestone`, `strategy/kanban-column`, `strategy/kanban-card`
- Edge kinds: `line`, `flow`, `dotted`
- Tips: mind maps and org charts are strict trees joined with `line` and auto-laid out. Roadmap, timeline, Gantt and kanban put meaning in position: give explicit `x`, `y`, `w`, `h` and pass `layout: "none"`; `diagram_list_types` with a `query` has the exact recipe for each.

## Wireframes and UX

- Types: `wireframe`, `mobile-wireframe`, `sitemap`
- Shapes: `wireframe/browser-window`, `wireframe/phone`, `wireframe/card`, `wireframe/button`, `wireframe/input`, `wireframe/heading`, `wireframe/image`, `basic/rounded`
- Edge kinds: `flow`, `line`
- Tips: every element is placed explicitly with `parent` set to the screen container and `layout: "none"`. A sitemap is a strict tree joined with `line`.
