---
name: diagram-ai
description: Draw, edit, review and explain diagrams on the live Diagram AI canvas through its MCP tools (diagram_create, diagram_add_elements, diagram_preview...). Use when the user asks to draw, diagram, sketch, visualise or map something - a repository's architecture, a C4, cloud or network layout, a request or code flow, a sequence, flowchart, class, state, BPMN or AI-agent diagram, a database schema as an ER diagram - or to review a diagram, address its comments, tidy it up, explain it or convert it to another type. Also use when the user mentions Diagram AI.
---

# Diagram AI

Draws on the user's live canvas through the `diagram-ai` MCP server: they watch every change in their browser and can select, edit and comment alongside you. Use it instead of Mermaid text or ASCII art whenever a diagram is wanted.

## First: check the server is connected

Call `diagram_list` (Claude Code names it `mcp__diagram-ai__diagram_list`).

- It answers: carry on.
- The tool is missing or the call fails: the app is not running or the server is not registered. Tell the user, then:
  1. Start the app in the Diagram AI repository: `npm run dev` (serves `http://localhost:3000`).
  2. Register it once: `claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp`, then restart the session or reconnect with `/mcp`.
  3. Codex instead: `codex mcp add diagram-ai --url http://localhost:3000/api/mcp/codex`.
  More cases in `references/troubleshooting.md`. Do not substitute another format unless the user agrees.

## Workflow

1. **Find or create.** `diagram_list`; update an existing diagram rather than duplicating it. New: `diagram_create` with `name` and `type`. Give the user the URL straight away.
2. **Read first.** `diagram_read` anything you did not just create; `diagram_list_comments` for review notes; `diagram_get_selection` when they say "this".
3. **Draw in one batch.** One `diagram_add_elements` call: nodes with short kebab-case `id`s, edges with `from`, `to`, `text` and `kind`, containers via `parent`. Never x/y. Sequence diagrams: `diagram_build_sequence`.
4. **Look.** `diagram_preview`, then fix with `diagram_update_elements`, `diagram_delete_elements` or `diagram_layout` until the checklist in `references/guide.md` passes (two rounds is normal).
5. **Report.** The URL, two lines on what it shows, and what you assumed or could not verify.

## Pick the type

| The user wants | `type` |
| --- | --- |
| Architecture of a repo or system | `c4-container` (context: `c4-context`, detail: `c4-component`) |
| Infrastructure, services, cloud | `system-architecture`, `microservices`, `cloud-architecture`, `kubernetes` |
| Request or call flow over time | `uml-sequence` |
| Logic, algorithm, process | `flowchart`, `uml-activity`, `bpmn-process`, `swimlane` |
| Database tables | `er-diagram`, `database-schema` |
| Classes, states | `uml-class`, `uml-state-machine` |
| Agents, RAG, MCP | `agent-architecture`, `multi-agent-system`, `rag-pipeline`, `mcp-topology` |

Anything else: `diagram_list_types` with a `query`. Shape ids, edge kinds and text formats per notation are in `references/notations.md`.

## Recipes

Each has an MCP prompt of the same name that scripts the whole job (`/mcp__diagram-ai__<name>` in Claude Code).

- **"Diagram this repo"** (`diagram_repo_architecture`): explore with your own file tools first - entry points, services, data stores, external APIs, noting the file for each fact. `c4-container`: units inside a `c4/system-boundary`, people and external systems outside, every edge labelled with its protocol, assumptions as comments.
- **"Sequence for this request"** (`diagram_code_flow`): trace the calls, 3-8 participants, `uml-sequence` plus `diagram_build_sequence`; add a `uml-activity` diagram when it branches a lot.
- **"ER diagram from the schema"** (`diagram_er_from_schema`): read migrations or models, `er-diagram`, one `er/entity` per table with `PK`/`FK` lines, crow's-foot kinds from the referenced table to the one holding the foreign key.
- **"Review this diagram"** (`diagram_review`): `diagram_read` and `diagram_preview`, one `diagram_add_comment` per problem with `target`, no edits.
- **"Address the comments"** (`diagram_address_comments`): `diagram_list_comments`, make each change, reply with `reply_to`, `diagram_resolve_comment`.
- Also `diagram_from_description`, `diagram_tidy`, `diagram_explain`, `diagram_convert`.

## Rules that matter most

- Draw only what you verified in the code, schema or description; flag the rest with a `note` or a comment.
- Label every connector in an architecture or process diagram with what flows over it.
- Keep a diagram to about 25 nodes; split by level or domain beyond that.
- Update in place. Do not rebuild a diagram to change it, and do not delete the user's work unless asked; `diagram_checkpoint` before a restructure.
- Never call `diagram_layout` on a sequence diagram, or on a hand-arranged one (`diagram_read` says "auto-layout off") unless asked.
- Read the `Warnings` in add and update replies and fix only the elements they name.
- Do not say "done" before you have looked at a `diagram_preview`.

## References

Load on demand:

- `references/guide.md` - the full drawing guide (same text as the `diagram://guide` resource): conventions, preview checklist, what not to do.
- `references/notations.md` - cheat sheet per notation: flowchart, UML, ER, C4, BPMN, cloud, AI agents and more.
- `references/layout.md` - how auto-layout, `layout` options and explicit `x`/`y` work, and when to use which.
- `references/troubleshooting.md` - connection problems, warnings, overlaps, truncated replies.

The server also serves `diagram://types` (all diagram types), `diagram://shapes` and `diagram://diagram/{id}` as MCP resources.
