/**
 * The drawing guide: how to use the Diagram AI tools well.
 *
 * One source for two readers. The `diagram://guide` MCP resource serves it
 * as is; the Claude Code skill ships it as `references/guide.md`, written by
 * `scripts/sync-skill.ts` and checked by `guide.test.ts`, so the two cannot
 * drift. Keep this module free of imports so the script can load it directly.
 *
 * Every tool, argument, shape id and diagram type named here is verified
 * against the real registries by `guide.test.ts`.
 */
const lines: string[] = [
  "# Drawing with Diagram AI",
  "",
  "Diagram AI is a live canvas: the person watches every change you make in their browser and can select, edit and comment alongside you. Work in visible steps, give them the diagram URL as soon as you have it, and check your own work with `diagram_preview`.",
  "",
  "## Workflow",
  "",
  "1. **Find or create.** `diagram_list` (optionally with `query`) before creating anything: update an existing diagram instead of duplicating it. To start a new one call `diagram_create` with a `name` and the `type` that matches the notation (see \"Choosing a type\"). The reply holds the id, the URL and a \"How to draw\" paragraph for that notation: follow it.",
  "2. **Read before you edit.** `diagram_read` any diagram you did not create in this conversation; the person may have moved, renamed or commented since. Check `diagram_list_comments` for open review notes, `diagram_review_status` for which of your earlier changes they reverted, and, when they say \"this\" or \"these\", `diagram_get_selection`.",
  "3. **Draw in one batch.** A single `diagram_add_elements` call with every node and edge (up to 300 nodes and 600 edges) beats many small calls: the layout engine sees the whole graph. Sequence diagrams are the exception: use `diagram_build_sequence`.",
  "4. **Look.** `diagram_preview` returns the picture the person sees. Run the checklist below, fix with `diagram_update_elements`, `diagram_delete_elements` or `diagram_layout`, and look again. Two rounds of fixes is normal; stop when the checklist passes.",
  "5. **Collaborate.** `diagram_highlight` points at elements, `diagram_add_comment` asks or explains in context, `diagram_checkpoint` (action `save`) before any large restructure so the person can go back.",
  "6. **Deliver.** Reply with the URL and a two-line summary. Call `diagram_export` only when a file was asked for: svg, mermaid, drawio and json come back inline (save them with your own file tools); png, pdf and pptx are written to the app's export folder and the reply gives the path.",
  "",
  "## Choosing a type",
  "",
  "When unsure call `diagram_list_types` with a `query`, or read the `diagram://types` resource. Prefer a dedicated type over `blank`: it brings the right shapes, edge kinds and layout, and `diagram_create` tells you how to draw it.",
  "",
  "| The person wants | Type id | Notes |",
  "| --- | --- | --- |",
  "| Architecture of a system or repository | `c4-container` (zoom out: `c4-context`, zoom in: `c4-component`) | `c4/*` shapes inside a `c4/system-boundary` |",
  "| Infrastructure as boxes and arrows | `system-architecture`, `microservices`, `cloud-architecture`, `kubernetes` | `infra/*` tiles, `basic/group` or `infra/*` containers |",
  "| A request or call flow over time | `uml-sequence` | build with `diagram_build_sequence` |",
  "| The same flow as components | `api-request-flow` | `infra/*` tiles, numbered edge labels |",
  "| Logic, an algorithm or a process | `flowchart`; `uml-activity` when steps run in parallel | `flowchart/*` or `uml/*` shapes |",
  "| A business process with roles | `bpmn-process`, `swimlane` | `bpmn/pool` and `bpmn/lane` containers |",
  "| Database tables | `er-diagram` (logical), `database-schema` (types, indexes) | `er/entity`, crow's-foot edge kinds |",
  "| Classes and interfaces | `uml-class` | `uml/class`, UML edge kinds |",
  "| States and transitions | `uml-state-machine` | `uml/state` |",
  "| Agents, RAG, tool use | `agent-architecture`, `multi-agent-system`, `rag-pipeline`, `tool-calling-sequence` | `ai/*` shapes |",
  "| Brainstorm, plan, schedule | `mind-map`, `roadmap`, `timeline`, `kanban-board` | positions are explicit for the planning types |",
  "",
  "## Nodes",
  "",
  "- `id`: short, stable, lowercase kebab-case (\"auth-service\", \"orders-db\"). Edges and later updates refer to it, so choose it yourself; it must be unique. Without one an id is derived from the first label line.",
  "- `shape`: a shape id (\"c4/container\"), a short name (\"decision\") or an alias (\"postgres\"). Omit it to get the type's default. An unknown shape falls back to the default and is reported as a warning with suggestions.",
  "- `text`: 2-5 words. The first line is the name; a second line holds the technology or a detail (\"Order API\\n[Node.js]\"). `\\n` breaks a line. A line containing only `---` splits the compartments of `uml/class` and `er/entity`.",
  "- `parent`: id of a container node to group under. Only container shapes can be parents (`basic/group`, `basic/frame`, `c4/system-boundary`, `bpmn/pool`, `bpmn/lane`, `infra/vpc`, `ai/agent-boundary`...). Group once a level has more than about six siblings.",
  "- `color`: a palette name; `diagram_list_shapes` with `library: \"colors\"` lists them. Let colour carry meaning (one meaning per colour, four or five colours at most) and explain it in a legend comment.",
  "- `icon`: only for `icons/*`, `infra/*` and `ai/*` shapes; names come from `diagram_list_shapes` with `library: \"icons-list\"`.",
  "- `note`: hidden detail for collaborators. Put sources and assumptions there (\"src/server/orders/\").",
  "- Leave out `x`, `y`, `w` and `h`. Nodes are sized to their text and placed by the layout engine.",
  "",
  "## Edges",
  "",
  "- `from` and `to` are node ids. An edge that names an unknown id is skipped with a warning.",
  "- Label every edge in an architecture or process diagram: `text` is the protocol, event, verb or data that flows (\"HTTPS\", \"publishes OrderPlaced\", \"Yes\").",
  "- `kind` sets the notation. General: `flow` (default, arrow at the target), `dashed` (asynchronous or optional), `bidirectional`, `line`. UML: `inheritance` (child to parent), `implementation`, `association`, `aggregation` and `composition` (whole to part), `dependency`. Sequence: `message`, `async`, `return`. ER: `one-to-one`, `one-to-many`, `many-to-one`, `many-to-many`, `zero-to-one`, `zero-to-many`, drawn from the referenced table to the table holding the foreign key. `diagram_list_shapes` with `library: \"edge-kinds\"` has the full list.",
  "- `startText` and `endText` carry multiplicity or a role near the ends.",
  "- Do not set `routing` or anchors unless the preview shows a problem.",
  "",
  "## Layout",
  "",
  "- Omit coordinates. A new diagram is arranged as a whole. On a diagram a person arranged by hand (`diagram_read` says \"auto-layout off\") new nodes are placed next to the nodes they connect to and nothing else moves.",
  "- `diagram_layout` re-arranges everything. `options.algorithm`: `layered` for flows and architectures, `tree` for hierarchies, `force` for networks, `radial`, `grid`. `options.direction`: `down`, `right`, `up`, `left`; wide diagrams read better with `right`. Pass `ids` to arrange only one region.",
  "- Never call `diagram_layout` on a sequence diagram, or on a diagram a person arranged by hand unless they asked. Save a `diagram_checkpoint` first if you must.",
  "- Planning and wireframe types (`roadmap`, `timeline`, `gantt-chart`, `kanban-board`, `wireframe`) put position in the meaning: give explicit `x`/`y` and pass `layout: \"none\"`.",
  "",
  "## Size and scope",
  "",
  "- One diagram answers one question. Past about 25 nodes, split by level (context, containers, components) or by domain and name the diagrams so they read as a set.",
  "- Accuracy over completeness. Draw what you verified in the code, schema or description, and mark anything inferred with a `note` or a comment instead of presenting it as fact.",
  "- Long tables and classes: show the keys and the few columns that matter, and end with \"+N more\".",
  "",
  "## Preview checklist",
  "",
  "Run this on every `diagram_preview`; fix and look again until nothing fails.",
  "",
  "- No node or label overlaps another and no text is cut off.",
  "- Every node has at least one connector, unless it is a deliberate legend or note.",
  "- Every connector in an architecture or process diagram has a label, and arrows point from caller to callee or from cause to effect.",
  "- Related nodes sit in one container, and no container holds unrelated things.",
  "- Connectors do not cross where another direction or grouping would avoid it.",
  "- Colours mean something and are used the same way everywhere.",
  "- The notation matches the diagram type (UML arrowheads for UML, crow's-foot for ER).",
  "- Zoom into a dense region with `diagram_preview` and `ids`.",
  "",
  "## Working with the person",
  "",
  "- Comments are how they talk to you inside the canvas: `diagram_list_comments`, make the change, `diagram_add_comment` with `reply_to` saying what you did, then `diagram_resolve_comment`. Ask about one element with `diagram_add_comment` and `target` instead of guessing.",
  "- MCP is pull-based: you see their edits and comments only when you read again. Call `diagram_read` before touching something they may have changed; an earlier read can be stale.",
  "- Your changes wait for their review: they can accept or revert each one in the browser. `diagram_read` shows a \"Review:\" line while changes are pending, and `diagram_review_status` lists what is pending and what they reverted or deleted. Do not redraw what they put back or removed unless they ask.",
  "- `diagram_get_selection` and `diagram_highlight` need a browser tab open on the diagram; without one they say so.",
  "- `diagram_import` creates a new diagram from Mermaid, draw.io or JSON text you read from a file.",
  "",
  "## Don't",
  "",
  "- Don't guess coordinates, sizes or connector routes.",
  "- Don't delete diagrams or the person's elements unless asked. `diagram_delete` is irreversible and needs `confirm_name`.",
  "- Don't rebuild a diagram to change it: `diagram_update_elements` edits in place. Running `diagram_build_sequence` again on the same diagram adds a second copy below and fails on duplicate participant ids; delete the old lifelines first or fix labels with `diagram_update_elements`.",
  "- Don't paste paragraphs into labels; use a second line or a `note`.",
  "- Don't ignore warnings. Add and update replies list every element that was skipped and why; fix and resend only those.",
  "- Don't call a diagram done before you have looked at a preview of it.",
  "- Don't read a huge diagram whole: use `ids`, `limit` and `offset` on `diagram_read`.",
  "- Don't start from `with_example` for real work; it fills the canvas with sample content.",
];

/** The guide as plain markdown. Served as the `diagram://guide` resource. */
export const DRAWING_GUIDE = lines.join("\n");

/** Where the guide lands inside the Claude Code skill, relative to the repository root. */
export const SKILL_GUIDE_PATH = ".claude/skills/diagram-ai/references/guide.md";

/** Exact contents of the skill's copy: the guide under a "generated" notice. */
export function skillGuideFile(): string {
  return [
    "<!-- Generated by `npx tsx scripts/sync-skill.ts` from src/server/mcp/guide.ts. Do not edit; change the source and run the script. -->",
    "",
    DRAWING_GUIDE,
    "",
  ].join("\n");
}
