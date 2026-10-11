# Hand-off: brand logos and icon packs (agent "icons")

Full design and rules: `docs/icons.md`. This note is only state and next steps.

## Done (compiling, tests green)

- `brands` library: `scripts/gen-brand-icons.mjs` -> `src/core/shapes/brand-data.ts` (231 logos), `libraries/brands.ts`, tile in `glyph-tile.ts`, glyph helpers in `glyph.ts` (re-exported by `kit.ts`). Registered after `icons`.
- Registry runtime API in `registry.ts` (`registerLibrary`, `unregisterLibrary`, `isRuntimeLibrary`, `registryVersion`, `subscribeRegistry`).
- `packs.ts` (format, zod limits, `packToLibrary`, `iconMarkup`), `svg-import.ts`, `pack-import.ts` (zip/folder, sync + async).
- Server: `src/server/packs/{store,runtime,service}.ts`, routes `src/app/api/packs/**`, `ensurePacks()` in `DiagramService.get` and `diagram_list_shapes`.
- Client: `src/features/editor/packs/{PacksDialog,use-packs,read-files}`, palette section + footer button, command `packs.open`, `usePacksSync()` in `Editor.tsx`.
- CLI `scripts/import-icon-pack.ts`; docs `docs/icons.md`.
- Tests: `src/core/shapes/{svg-import,pack-import,packs}.test.ts`, `src/server/packs/packs.test.ts`.

## Shared files I edited (minimal edits, all intentional)

registry.ts, kit.ts, libraries/index.ts, ShapePalette.tsx, commands.ts, service.ts, mcp/tools/catalog.ts, core/render/scene.ts (prim cache resets on `registryVersion`), canvas/markup.ts (same), canvas/World.tsx (redraw on registry change), Editor.tsx (mount sync).

## Half-done

Nothing is half-built. The dialog is fully wired; no guarded or unwired code.

## Remaining, in priority order

1. Try a real AWS / Azure / GCP download (not available here; only synthetic fixtures were tested) and tune `CONTAINER`, `FILE_PREFIXES`, `ACRONYMS` in `pack-import.ts` if categories or names come out wrong.
2. Postgres `PackStore`: implement the four methods (`list/get/save/delete`) and return it from `getPackStore()` in `src/server/packs/store.ts`; coordinate with the database agent.
3. Optional: cheap bare-icon variant for packs (today: set node fill and line to none); gradients are flattened to the mean stop colour.
4. Optional: push `packs` change events over SSE instead of focus/1 s polling.
5. Run `npm run icons:brands` again if simple-icons is upgraded (it warns for missing slugs; AWS/Azure use generic-glyph fallbacks, see `FALLBACKS` in the script).

## Commands

- Regenerate brand data: `npm run icons:brands`
- Look at it: `npx tsx scripts/gallery.ts brands` (writes `.gallery/brands.png`, very tall)
- Tests: `npx vitest run src/core/shapes src/server/packs`
- Import a pack: `npm run icons:import -- <folder|zip|svg...> --name "AWS Architecture Icons" [--dry-run] [--data-dir C:/...]`
- Scratch server: `NEXT_DIST_DIR=.next-icons DIAGRAM_DATA_DIR=C:/... npx next dev -p 3104` (Windows paths with `C:/`, not `/c/`). Remove `.next-icons` and its two entries that next adds to `tsconfig.json` afterwards.

## State at pause

No scratch servers running; `.next-icons` removed; no packs in `./data`. Known failures outside my files: chat agent's `src/features/editor/chat` / `src/server/chat` (tsc errors, `route.test.ts`).
