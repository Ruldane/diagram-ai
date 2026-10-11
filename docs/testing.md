# Testing and verification

Commands, conventions and how to look at your work.

## Gate

```bash
npm run typecheck && npm run lint && npm test     # unit tests (Vitest, node environment)
npm run test:db                                   # database tests; needs DATABASE_URL_TEST
```

Database tests are described in [database.md](database.md). Tests live beside the code as `*.test.ts`. `src/core` code is tested without a browser; React code is tested through the pure helpers it uses.

## What the suites enforce

- `src/core/shapes/shapes.test.ts` runs the same invariants over **every registered shape**: finite geometry at default, large and tiny sizes, with and without text; closed outline near the box; sane auto-size. A new shape is covered automatically.
- `src/core/catalog/catalog.test.ts` checks every diagram type's ids, shapes, edge kinds, template warnings, containment and overlap.
- `src/core/core.test.ts`, `src/core/agent-input.test.ts` hold regression tests for routing, layout, the spec builder, label wrapping, link safety.

Add a regression test with the fix for any bug found by looking at a render.

## Look at it

Visual work is not done until you have seen the PNG.

| Command | Output |
| --- | --- |
| `npm run gallery -- <library…>` | `.gallery/<library>.png` contact sheets of every shape |
| `npm run templates -- <type-id…>` (or `@category`) | `.gallery/templates/<id>.png` and `_sheet-<category>.png` |
| `npx tsx scripts/smoke-export.ts [type]` | SVG, PNG, PDF (fit and A4), PPTX in `.gallery/` |
| `npx tsx scripts/routing-gallery.ts` | connector-routing scenarios in `.gallery/routing/` |

Read the PNGs (they are images the model can view). `.gallery/` is git-ignored.

## End-to-end through MCP

`node scripts/mcp-smoke.mjs <baseUrl> [agent]` creates diagrams, draws, comments, previews, exports and checks each response against the real server. Run it against a scratch server (below), never against someone's workspace.

## Scratch servers and data hygiene

`./data` holds the user's diagrams and port 3000 is their dev server. For your own runs:

```bash
NEXT_DIST_DIR=.next-scratch DIAGRAM_DATA_DIR=/tmp/diagram-scratch npx next dev -p 3101
```

`NEXT_DIST_DIR` keeps build output apart (two dev servers cannot share `.next`); `DIAGRAM_DATA_DIR` keeps test diagrams out of the workspace. Delete what you create when you finish.

## Browser checks

Drive the real editor with a Playwright script or the Playwright MCP tools against the scratch server. Useful probes: read the viewport from `document.querySelector('.canvas-world > g').getAttribute('transform')`, find elements by `data-id`, `data-handle`, `data-port`; fetch the document from `/api/diagrams/<id>` to assert what the server stored. The Playwright MCP browser is a single shared instance: one agent at a time, and say so when delegating.

## Production build

`npx next build` runs type checks and prerenders. Run it before handing work over; it exercises the Cache Components rules that `next dev` is lenient about.
