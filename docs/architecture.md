# Architecture

Where code belongs and how one change travels from a click (or an MCP call) to disk and back to every viewer.

## Layers

```
src/core        pure TypeScript engine — runs in browser, server and tests
src/server      Node only: storage, realtime hub, DiagramService, MCP, PNG rendering
src/features    React UI: editor (store, sync, canvas, panels, dialogs), home, agents
src/components  UI primitives (button, menu, dialog, fields)
src/app         Next.js routes: pages and every REST / SSE / MCP endpoint
```

Dependencies point downward only: `app` → `features`/`server` → `core`. `core` imports nothing from the others, which is why exporters, the layout engine and the spec builder are testable without a browser or a server.

`src/core` map:

| Folder | Holds |
| --- | --- |
| `model/` | document types, `Patch`, validation (`schema.ts`), integrity rules, palette, ids |
| `geometry/` | points, matrices, the path IR every shape reduces to (`path.ts`) |
| `text/` | font metrics, measuring, wrapping |
| `shapes/` | shape contract, authoring kit, registry, libraries (one file each) |
| `edges/` | connector routing, markers, relationship presets (`kinds.ts`) |
| `render/` | `scene.ts` (display list) and `svg.ts` — what every output consumes |
| `layout/` | ELK auto-layout (`layout.ts`), incremental placement (`place.ts`) |
| `spec/` | the forgiving input format agents and templates use (`apply.ts`, `sequence.ts`) |
| `catalog/` | diagram types and starter templates |
| `export/`, `io/` | PDF/PPTX writers and paging; draw.io and Mermaid import/export |
| `protocol.ts` | types shared by REST, SSE and the browser |

## One change, end to end

1. **Origin.** A person edits on the canvas, or an agent calls an MCP tool. Both produce a `Patch` (`src/core/model/types.ts`): sets and removals of nodes, edges and comments, plus document metadata.
2. **Browser.** `store.apply(patch)` (`src/features/editor/store/editor-store.ts`) applies it optimistically, records the inverse for undo, and `emit`s it. `src/features/editor/sync/client.ts` queues and POSTs it to `/api/diagrams/[id]/ops`.
3. **Server.** The route validates with `patchSchema` and calls `DiagramService.commit` (`src/server/service.ts`). The service holds a per-diagram lock, completes the patch with `withIntegrity` (removing a node removes its connectors, frees its children), applies it, bumps `version`, saves through the repository, and publishes events on the `Hub`.
4. **Everyone.** Every open tab receives the `patch` event over SSE (`/api/diagrams/[id]/events`). The originating tab ignores its own echo (`origin` = `clientId`). Patches from agents also drive the draw-in animation (`sync/playback.ts`).
5. **Gaps.** Events carry a `version`. A tab that sees a gap reloads the document; reconnecting SSE sends `hello` with the current version.

MCP tools skip steps 1–2: they call `DiagramService` methods directly (`applyElements`, `buildSequence`, `layout`, …), which publish the same events.

## Rendering

A shape is a function from a node to primitives (`path`, `text`) in local coordinates. `buildScene` (`src/core/render/scene.ts`) turns a document into layers in paint order: containers → connectors → nodes → raised connectors → connector labels. The canvas serialises elements with the same `primToSvg` the SVG exporter uses; PDF and PPTX walk the same layers. Consequence: a visual bug is fixed once, in the shape or the scene, and shows up fixed everywhere.

## Ideas worth keeping

- **Element-level last-writer-wins.** Concurrent edits to different elements never conflict; the same element takes the last write. There is no CRDT.
- **`autoLayout`** (document setting) says positions are still machine-computed. Any manual move clears it, so agents stop re-flowing a hand-arranged diagram and new nodes are placed beside their neighbours (`place.ts`).
- **`autoRoute`** (edge flag) marks anchors and bend points computed by a layout; they are dropped as soon as an end moves.
- **Specs, not coordinates.** Agents send `ElementsSpec` (ids, shape names, labels); sizes come from text measurement and positions from the layout engine.
- **Ids are readable.** Agents choose short ids (`auth-service`); nodes created without one get a slug of their label.
- **Fallbacks everywhere.** Unknown shape ids render as `basic/rect`, unknown diagram types as the generic type, so older files and removed shapes never break a page.

## Where does my change go?

| You are adding… | Put it in |
| --- | --- |
| a shape or library | `src/core/shapes/libraries/` ([shapes.md](shapes.md)) |
| a diagram type or template | `src/core/catalog/types/` ([diagram-types.md](diagram-types.md)) |
| an export format | `src/core/export/` or `src/core/io/`, wired in `src/server/render/export.ts` ([exports.md](exports.md)) |
| an MCP tool | `src/server/mcp/tools/` ([mcp.md](mcp.md)) |
| a REST endpoint | `src/app/api/...` over a `DiagramService` method ([server.md](server.md)) |
| an editor command, panel or dialog | `src/features/editor/` ([editor.md](editor.md)) |
| storage | implement `DiagramRepository` ([database.md](database.md)) |
