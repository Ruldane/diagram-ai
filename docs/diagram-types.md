# Diagram types and the spec format

The catalog of diagram types (103), their starter templates, and the input format agents and templates share.

## Catalog (`src/core/catalog/`)

One `DiagramTypeDef` per notation (`types.ts`): id, name, category, description, search keywords, pinned shape `libraries`, `defaultShape`, `routing`, `edgeKind`, `layout`, `agentGuide`, `support` and an optional `template`.

- **Files.** Entries live in `types/<category>.ts`, most common first. `diagram-types.ts` aggregates them; the first five of the array are the home page's quick start (`QUICK_START`). `presets.ts` holds layout presets and text helpers shared by templates.
- **`agentGuide`** is read by agents before drawing (`diagram_create`, `diagram_list_types`): name exact shape ids and edge kinds, one to three sentences.
- **`support`**: `dedicated` when purpose-built shapes exist; `generic` when the notation is approximated with basic shapes. Mark generic honestly — the catalog test cannot.
- **`libraries`** decide palette order and which library wins when a short name is ambiguous (`resolveShape(name, libraries)`).
- **Lookups** always return something: `getDiagramType(id)` falls back to a generic type so unknown or legacy ids never break rendering.

### Adding a type

1. Add the entry to the right `types/<category>.ts` (shape ids in templates must be exact ids, not aliases).
2. Give it a template that teaches the notation: 5–12 nodes of meaningful content (an online shop, a login flow), not "Node 1".
3. `layout: "auto"` templates carry no coordinates and are arranged by the type's `layout`; `layout: "none"` templates (matrices, timelines, wireframes) give every node explicit `x/y/w/h` on a 10px grid, children inside their container with `parent` set.
4. Run `npm test` (`catalog.test.ts` checks ids, libraries, shapes, edge kinds, warnings, containment, overlap) and render with `npx tsx scripts/template-gallery.ts <type-id>`; look at `.gallery/templates/<id>.png`.

## The spec (`src/core/spec/apply.ts`)

`ElementsSpec { nodes?: NodeSpec[]; edges?: EdgeSpec[] }` is the forgiving format behind MCP tools, templates and importers. `applySpec(doc, spec, options)` returns a `Patch` plus `created`, `updated`, `unplaced` and `warnings`.

- **Nodes**: `id` (optional, normalised to a safe slug), `shape` (id, short name or alias), `text` (`\n` for lines; a line of only `---` separates compartments), `parent`, `color` (palette name or `#rrggbb` fill), `icon`, `style`, `data`, optional `x/y/w/h`. Size defaults to the text-fitted size (`fitSize`).
- **Edges**: `from`/`to` (ids, or the label/original id of a normalised node), `kind` (relationship preset from `src/core/edges/kinds.ts`), `text`, `startText`/`endText`, `routing`, `color`, `fromAnchor`/`toAnchor`.
- **Modes**: `create` rejects existing ids, `update` rejects unknown ones, `upsert` accepts both.
- **Warnings, not failures.** Unknown shapes fall back to the diagram's default shape with a "did you mean" hint; edges to missing nodes are skipped and reported. Agents fix just the listed items.
- **`options`**: `defaultShape`, `preferLibraries` (disambiguates aliases), `defaultEdgeKind` (applied to new edges that name no kind; templates are created without it).

Sequence diagrams are not graphs: `buildSequence` (`spec/sequence.ts`) turns participants and messages into lifelines and rows.

## Relationship presets (`edges/kinds.ts`)

`flow`, `dashed`, `bidirectional`, UML (`inheritance`, `implementation`, `aggregation`, `composition`, `dependency`, `association`), messages (`message`, `async`, `return`) and ER cardinalities (`one-to-many`, …). Each maps to start/end markers plus dash; the inspector and `matchEdgeKind` use the same table.
