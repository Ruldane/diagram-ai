<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Diagram AI

A live diagramming canvas that people and AI agents (over MCP) edit together. Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Zustand, Zod 4. Diagrams are JSON files in `./data`, or PostgreSQL when `DATABASE_URL` is set.

## Invariants

1. **`src/core` is pure TypeScript.** No React, DOM or Node APIs: the same code runs in the browser, on the server and in tests.
2. **A `Patch` is the only unit of change.** UI edits, undo/redo, REST, SSE and MCP tools all produce and consume patches; on the server only `DiagramService` applies them.
3. **A shape is a function returning path and text primitives.** Canvas, SVG, PDF, PPTX and PNG draw the same scene. Build shapes with the kit in `src/core/shapes/kit.ts`.
4. **Text width comes from bundled font metrics**, so every output wraps identically.
5. **Pages are synchronous static shells** (Cache Components). Fetch data on the client or behind `<Suspense>`.
6. **Server state that survives hot reload is plain data on `globalThis`**; classes are re-created per call (`src/server/context.ts`).
7. **Agent-facing text is product surface**: tool descriptions, catalog `agentGuide`, warnings. Keep it precise and actionable.

## Working here

- `./data` and port 3000 belong to the person running the app. Give scratch servers and scripts their own `DIAGRAM_DATA_DIR`, and start extra dev servers with `NEXT_DIST_DIR=.next-<name>` on another port.
- Finish with `npm run typecheck && npm run lint && npm test`.
- Render to PNG and look at it for any visual change (shapes, routing, templates, exports). [docs/testing.md](docs/testing.md) has the commands.
- Update the matching doc in the same change as the code. One topic per file, under 150 lines; put detail in `docs/`, not in this file.

## Read before…

| Doc | Read when |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | **placing** new code, or tracing one change from UI to disk |
| [docs/editor.md](docs/editor.md) | **editor UI**: store, canvas interactions, commands, panels, dialogs |
| [docs/server.md](docs/server.md) | **server**: service layer, REST/SSE routes, realtime hub, new endpoint |
| [docs/mcp.md](docs/mcp.md) | **MCP**: connecting a client, adding or changing a tool |
| [docs/agent-skill.md](docs/agent-skill.md) | **prompts**: MCP prompts and resources, the Claude Code skill |
| [docs/shapes.md](docs/shapes.md) | **shapes**: adding or changing a shape or library |
| [docs/icons.md](docs/icons.md) | **icons**: brand logos, importable packs (AWS, GCP, Azure) |
| [docs/diagram-types.md](docs/diagram-types.md) | **diagram types**: catalog entries, templates, the spec agents send |
| [docs/routing.md](docs/routing.md) | **routing**: connector routes, auto-layout |
| [docs/exports.md](docs/exports.md) | **export/import**: SVG, PNG, PDF, PPTX, draw.io, Mermaid |
| [docs/database.md](docs/database.md) | **database**: PostgreSQL in Docker, env vars, migrations, importing files |
| [docs/review.md](docs/review.md) | **review**: accept or reject agent changes, checkpoint comparison |
| [docs/assistant.md](docs/assistant.md) | **assistant**: the in-app "Ask" panel running on the Claude API |
| [docs/code-editor.md](docs/code-editor.md) | **code**: the Mermaid / PlantUML panel |
| [docs/presentation.md](docs/presentation.md) | **presentation**: slide mode |
| [docs/testing.md](docs/testing.md) | **testing**: commands, galleries, smoke scripts, browser checks |
