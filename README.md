# Diagram AI

A live diagramming canvas for people **and** AI agents. Draw any technical diagram by hand, or connect Claude Code, Codex or another MCP client and watch it draw, edit and export alongside you — in real time.

- **Human-first editor** — shape libraries, drag / resize / rotate, smart guides, one-click connected nodes, in-place text editing, comments, undo/redo, auto-layout.
- **Agent-native** — the app is its own MCP server. Agents draw without computing coordinates, see a rendered picture of their work, read what you have selected and answer your comments.
- **Faithful, scalable exports** — SVG, PNG, JPEG, vector PDF with selectable text, PowerPoint (editable shapes or exact image), draw.io, Mermaid and JSON, all produced from one rendering pipeline so every format matches the canvas.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires Node.js 20.9 or newer. Diagrams are stored as plain JSON files in `./data` (set `DIAGRAM_DATA_DIR` to move them).

## Connect an agent

The MCP endpoint is served by the app itself at `/api/mcp` (Streamable HTTP, stateless).

| Client | Command / config |
| --- | --- |
| Claude Code | `claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp` |
| Codex | `codex mcp add diagram-ai --url http://localhost:3000/api/mcp/codex` or, in `~/.codex/config.toml`:<br>`[mcp_servers.diagram-ai]`<br>`url = "http://localhost:3000/api/mcp/codex"` |
| Cursor, VS Code, Gemini CLI… | `{ "mcpServers": { "diagram-ai": { "url": "http://localhost:3000/api/mcp" } } }` |
| stdio-only clients | `{ "command": "npx", "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp"] }` |

A `.mcp.json` is included, so Claude Code started in this folder picks the server up automatically. Appending a name to the URL (`/api/mcp/my-agent`) labels that agent on the canvas; otherwise it is detected from the MCP client name.

Then ask, for example: *"Draw the architecture of this repo as a C4 container diagram"* and open the URL the agent prints.

### How people and agents work together

- You talk to the agent in its own window; the canvas updates live as it calls tools. New elements draw in one by one under the agent's labelled cursor, layouts animate, and the **Activity** tab lists every step.
- **Selection** — select shapes, then say "make *these* green": the agent reads your selection (`diagram_get_selection`).
- **Comments** — pin a note on a shape; the agent lists comments, replies in the thread and resolves it.
- **Undo** — agent edits land in your undo history (`Ctrl+Z` undoes the agent's last change).
- MCP is pull-based: an agent sees your edits and comments the next time it reads the diagram (normally on your next message to it). The app cannot wake an idle agent.

### MCP tools

| Tool | Purpose |
| --- | --- |
| `diagram_list`, `diagram_create`, `diagram_read`, `diagram_configure`, `diagram_delete` | Find, create, inspect and manage diagrams |
| `diagram_add_elements`, `diagram_update_elements`, `diagram_delete_elements` | Draw and edit nodes and connectors (no coordinates needed) |
| `diagram_layout` | Auto-arrange (layered, tree, force, radial, grid) |
| `diagram_build_sequence` | Generate a sequence diagram from participants and messages |
| `diagram_list_types`, `diagram_list_shapes` | Browse diagram types, shapes, icons, edge kinds and colours |
| `diagram_preview` | Get a PNG of the diagram so the agent can check its own work |
| `diagram_get_selection`, `diagram_highlight` | Act on what the user selected; point at elements for the user |
| `diagram_list_comments`, `diagram_add_comment`, `diagram_resolve_comment` | Review threads |
| `diagram_export`, `diagram_import` | SVG / PNG / PDF / PPTX / draw.io / Mermaid / JSON out; Mermaid / draw.io / JSON in |
| `diagram_checkpoint` | Save, list and restore named checkpoints |

### MCP prompts, resources and the skill

Clients list prompts as slash commands (Claude Code: `/mcp__diagram-ai__diagram_repo_architecture`). Each scripts a whole job with this server's tools: `diagram_repo_architecture`, `diagram_code_flow`, `diagram_er_from_schema`, `diagram_from_description`, `diagram_review`, `diagram_address_comments`, `diagram_tidy`, `diagram_explain`, `diagram_convert`.

Resources are read-only markdown: `diagram://guide` (how to draw well), `diagram://types`, `diagram://shapes` and `diagram://shapes/{library}`, `diagram://diagrams` and `diagram://diagram/{id}`.

A Claude Code skill lives in `.claude/skills/diagram-ai`; copy it to `~/.claude/skills/` to use it in any project. Installation, the prompt arguments and an `AGENTS.md` snippet for Codex are in [`docs/agent-skill.md`](docs/agent-skill.md).

`node scripts/mcp-smoke.mjs http://localhost:3000` exercises the tools, prompts and resources against a running app.

## Exports

Every format is produced from the same display list as the canvas (`src/core/render/scene.ts`), so there is no "export looks different" class of bug.

| Format | Notes |
| --- | --- |
| SVG | Vector. Fonts are embedded, so the file renders identically anywhere. |
| PNG / JPEG | 1×–4× pixel density; PNG can be transparent. |
| PDF | Vector paths and real, selectable text with embedded fonts. Page fits the diagram exactly, or the diagram is scaled to fit A4 / A3 / Letter / Legal / Tabloid, centred, never cropped. One page per frame when requested. |
| PowerPoint | *Editable*: native shapes and text boxes (text uses common system fonts, so spacing can differ slightly). *Image*: one pixel-exact picture per slide. One slide per frame when requested. |
| draw.io | Opens in diagrams.net with editable shapes; shapes without a draw.io equivalent fall back to rectangles. |
| Mermaid | Flowcharts and sequence diagrams. |
| JSON | The lossless native format; re-importable. |

Import: Diagram AI JSON, draw.io files (shapes, labels, positions, connectors) and Mermaid flowcharts / sequence diagrams.

## Project layout

```
src/
  core/        Framework-agnostic engine — no React, DOM or Node APIs. Runs in the browser, on the server and in tests.
    model/       Document types, patches (the single unit of change), validation, integrity rules
    geometry/    Points, matrices and the path IR every shape reduces to
    text/        Font metrics and line breaking (identical everywhere, no DOM)
    shapes/      Shape contract, authoring kit and the libraries (one file each)
    edges/       Connector routing, markers and relationship presets
    render/      Scene (display list) and SVG serializer
    layout/      Auto-layout (ELK) and incremental placement
    spec/        The forgiving input format agents and templates use
    catalog/     Diagram types and starter templates
    export/      PDF and PowerPoint writers, paging
    io/          draw.io and Mermaid import / export
    protocol.ts  Types shared by REST, server-sent events and the browser
  server/      Node-only: file storage, realtime hub, the service layer, MCP tools, PNG rendering
  features/    React UI: editor (store, sync, canvas, panels, dialogs, commands), home, agents
  components/  Reusable UI primitives
  app/         Next.js routes: pages and the REST / SSE / MCP endpoints
scripts/       Font + icon generators, shape and template galleries, smoke tests
docs/          Contributor guides
```

Key ideas:

- **One change format.** Local edits, undo/redo, the REST API, live events and MCP tools all exchange the same `Patch`. `DiagramService` (`src/server/service.ts`) is the only place diagrams change on the server; REST handlers and MCP tools are thin adapters over it.
- **One renderer.** A shape is a function returning path and text primitives. The canvas, SVG, PDF, PowerPoint and the server-side PNG preview all consume that same list.
- **One text measurer.** Line breaks come from a bundled metrics table, so the browser, exports and the agent's preview wrap text identically.

## Extending

- **Shapes** — see [`docs/shapes.md`](docs/shapes.md). Add a `ShapeDef` to a library file; `npm run gallery -- <library>` renders a contact sheet to check it.
- **Diagram types** — add an entry under `src/core/catalog/types/`; the catalog test verifies its shapes and template.
- **Editor commands** — add to `src/features/editor/commands/commands.ts`; it becomes available as a shortcut, in the command palette and in menus.
- **MCP tools** — add a `registerTool(...)` call under `src/server/mcp/tools/`, implemented on top of `DiagramService`.
- **Storage** — implement `DiagramRepository` (`src/server/store/repository.ts`) to replace the JSON files with a database.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck`, `npm run lint` | TypeScript, ESLint |
| `npm run gallery -- [library…]` | Render shape contact sheets to `.gallery/` |
| `npm run fonts`, `npm run icons` | Regenerate bundled fonts + metrics, and the icon set |

## Limits worth knowing

- **Single process.** Live sync uses in-memory pub/sub and server-sent events, which suits `next dev` / `next start` on one machine. Running several instances or on serverless needs a shared pub/sub and database behind the existing `Hub` and `DiagramRepository` interfaces.
- **No accounts.** The app trusts whoever can reach it and only blocks cross-origin browser requests. Do not expose it to the internet as is.
- **Concurrent editing** is last-writer-wins per element — fine for one person plus agents, not a CRDT.
- **Connectors** are routed by the layout engine, or live around every unrelated shape (see [`docs/routing.md`](docs/routing.md)); in very dense windows the router falls back to simpler shapes and may cross a node, and there are no line "jumps" over crossings.
- **Sequence diagrams** are generated with lifelines and messages; activation bars and fragments exist as shapes but are placed by hand.
- **Labels are horizontal** (vertical text inside a rotated shape works, but there is no vertical label for pool or lane headers).
- **Some notations are approximated** with general-purpose shapes — each diagram type is marked *dedicated* or *generic* in the catalog (`diagram_list_types` reports it).
