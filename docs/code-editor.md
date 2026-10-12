# Diagram as code

The **Code** tab of the side panel shows the open diagram as Mermaid or PlantUML text and applies edited text back to the canvas as one undoable step.

Code: UI `src/features/editor/code/`; pure logic `src/core/code/` (parse, plan, layout, generate); text formats `src/core/io/mermaid.ts`, `plantuml.ts` (import), `plantuml-export.ts`.

## Flow

```
canvas ──generateCode(doc, language)──▶ text            (exportMermaid / exportPlantUml)
text ──parseCode──▶ CodeImport + diagnostics ──planCodeApply(doc, import, mode)──▶ CodePlan
CodePlan ──placePlan (ELK)──▶ Patch ──store.apply──▶ ONE undo entry
```

- `parseCode` never throws; it returns the importer's result, per-line diagnostics (1-based lines) and counts. The panel parses after a short pause (`use-parsed-code.ts`, idle callback) so typing never waits for the parser.
- `planCodeApply` is pure. **Replace** matches elements by id and leaves matched shapes' position, size, style, notes and links alone; shapes the text no longer names are removed. **Insert beside** adds the text's diagram next to existing content under fresh ids. `run-code.ts` redoes the plan if the document changed while layout ran, and defers while a drag is in progress.
- A connector whose look the text cannot say (a filled arrowhead, a custom colour) keeps its style when the text reads the same (`plantUmlOperator` / `mermaidLinkOf` equality).
- **Comments**: they stay. Comments pinned to a shape the text removes are unpinned (they keep their position and stay in the Comments tab); the preview line says how many.
- **Live** mode applies automatically after the text settles with no errors, and only ever removes shapes the code itself created (`managed`), never what was drawn by hand.

## The panel

| Element | Behaviour |
| --- | --- |
| Mermaid / PlantUML toggle | language of the editor; the draft per language survives tab switches and reloads (sessionStorage, `drafts.ts`) |
| First open | an empty editor is filled with the diagram in the first language that can express it (Mermaid, else PlantUML) |
| "X cannot express this diagram" | shown when the current language cannot say the open diagram, with a one-click switch when the other can. **Generate** then explains why and offers a small valid example |
| Generate from diagram | replaces the editor text (toast with Undo) and notes what the text leaves out |
| Stale banner | the diagram, written as text again, differs from the text that was last written or applied. **Regenerate** replaces the editor text; the banner also says when the editor text was edited too |
| Status | kind, counts, line-numbered errors (click jumps to the line), warnings, and "Applying will add 2 shapes, update 1, remove 1" |
| Apply to canvas / Insert beside | Ctrl/⌘+Enter applies. Disabled for view-only access |

## What each language can express

`generateCode` refuses (with a reason and an example) rather than writing text that silently loses shapes.

| Language | Diagram kinds written | Needs |
| --- | --- | --- |
| Mermaid | flowchart, sequence | every shape has a Mermaid bracket form (or is a container → `subgraph`), or all shapes are lifelines |
| PlantUML | sequence, class, use case, component, activity | all shapes in one kind's table below |

### PlantUML subset (read in full; export writes the forms that round-trip, which are tested)

| Kind | Elements | Relations |
| --- | --- | --- |
| Sequence | `participant`, `actor`, aliases, quoted names; messages `->` call, `->>` async, `-->` return, self messages | blocks (`alt`, `loop`…) are flattened with a warning; notes, activations and dividers are skipped with a warning |
| Class | `class`, `abstract class`, `interface`, `enum`, `object`, `package`; members with `{field}`/`{method}`, `<<stereotype>>` | `--\|>` inheritance, `..\|>` realisation, `*--` composition, `o--` aggregation, `-->` association, `..>` dependency, `--`, `..`, multiplicities `"1" -- "0..*"`, labels |
| Use case | `actor`, `usecase`, `rectangle { }` (system boundary), `(Name)` and `:Actor:` shorthand | `-->`, `..>` with `<<include>>` / `<<extend>>` (read as «include» / «extend») |
| Component | `component`, `interface`, `node`, `package`, `cloud`, `database`, `queue`, `artifact`, `rectangle`, `hexagon`, `actor`, `[Name]` shorthand | as class |
| Activity (new syntax) | `start`, `stop`, `end`, `:action;`, `fork` / `fork again` / `end fork` | `if (c) then (l)` / `else (l)` / `endif`, `elseif`, `while (c) is (l)` / `endwhile (l)`, `repeat` / `repeat while (c) is (l) not (l)` |

Not supported (reported per line, never an exception): state diagrams, gantt and the other `@start…` types, the old activity syntax `(*) -->`, swimlanes and partitions (skipped), notes, `skinparam`, `title` (the title is written but not read back).

**Export limits.** Positions, sizes and colours are not text. Activity export needs one start and a flow it can write structurally; a diagram with a jump into the middle of a branch, two starts or three-way decisions is reported, not guessed. Merge diamonds are implied by `endif`.

**Element ids.** Every element is declared with its document id as alias (`class "Order" as order`), which is how applying text finds the same shape. Activity elements have no names in PlantUML, so where the importer would number a shape differently (`stop`, `stop-2`) the export writes an ordinary comment line before it, `' @id stop-2`, which the importer reads. Keep those lines when editing; delete them to let ids be numbered again.

## Adding a language or a diagram kind

1. Importer returning `CodeImport` (`kind`, `spec` or `sequence`, `warnings`) and, ideally, per-line `ImportDiagnostic`s; add the language to `CodeLanguage` and `parseCode`.
2. Exporter and a `Generation` branch in `generate.ts`. Test the loop: text → canvas → text → canvas must make an **empty patch** (`plantuml-export.test.ts` `expectStable`).
3. If the kind needs another matching rule for ids, extend `matchCodeIds` in `apply.ts`.
4. Check in a browser, light and dark, with errors, a stale diagram and a pinned comment ([testing.md](testing.md)).
