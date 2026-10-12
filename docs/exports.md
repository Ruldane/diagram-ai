# Export and import

How a diagram becomes SVG, PNG, PDF, PowerPoint, draw.io, Mermaid or JSON — and back.

## One pipeline

```
DiagramDoc ──exportPages(scope)──▶ ExportPage[] { name, scene, view }
                                      │
        ┌─────────────┬───────────────┼───────────────┬───────────────┐
   renderSvg      resvg/canvas     renderPdf       renderPptx
   (core)         → PNG/JPEG       (core, jsPDF)   (core, pptxgenjs)
```

`src/core/export/pages.ts` decides **what** is exported: the whole diagram, the selection, or one page per top-level frame (`basic/frame`). Everything downstream draws the same `Scene` the canvas shows, so exports cannot drift from the editor.

| Format | Code | Notes |
| --- | --- | --- |
| SVG | `src/core/render/svg.ts` | fonts embedded as base64 `@font-face` (only variants used) so the file renders anywhere |
| PNG / JPEG | server: `@resvg/resvg-js` in `src/server/render/export.ts`; browser: SVG → `<img>` → canvas in `src/features/editor/export/client-export.ts` | scale 1–8×, capped at ~64 MP; JPEG never transparent |
| PDF | `src/core/export/pdf.ts` | vector paths and real text with embedded TTFs; `fit` sizes the page to the diagram, sheet sizes scale and centre without cropping; one page per frame |
| PPTX | `src/core/export/pptx.ts` | `editable`: custom-geometry shapes + text boxes (text uses Office-safe fonts, spacing may differ); `image`: one PNG per slide |
| draw.io | `src/core/io/drawio.ts` | uncompressed `.drawio`; unmapped shapes become rectangles |
| Mermaid | `src/core/io/mermaid.ts` | flowcharts and sequence diagrams only |
| PlantUML | `src/core/io/plantuml-export.ts` | sequence, class, use case, component, structured activity; text editor only (see [code-editor.md](code-editor.md)) |
| JSON | the document itself | lossless, re-importable |

## Where it runs

- **Browser** (`ExportDialog`): renders locally from the live document, so unsaved state exports correctly. Fonts are fetched from `/fonts/*.ttf` once and cached.
- **Server** (`GET /api/diagrams/[id]/export`, MCP `diagram_export`, thumbnails, `diagram_preview`): `src/server/render/export.ts`, fonts read from `public/fonts`.

## Fonts and text

The same four families (`public/fonts/*.ttf`, metrics in `src/core/text/font-metrics.json`) are used by canvas, SVG, resvg, PDF and the measurer. Regenerate both with `npm run fonts` when the set changes. PowerPoint maps them to Arial, Georgia, Courier New and Comic Sans MS (`FONT_FAMILIES[...].office`) so a machine without the bundled fonts still renders.

## Import

`DiagramService.importDiagram` accepts `json` (validated with `docSchema`), `drawio` and `mermaid`.

- **draw.io** → `ElementsSpec`: shapes by style → our shape ids (`drawio.ts` mapping table), nested geometry made absolute, HTML labels flattened, compressed pages inflated with `DecompressionStream`. Routes are dropped and recomputed.
- **Mermaid** → spec (flowchart) or `SequenceSpec`; flowcharts are then auto-laid-out. Other diagram types return a warning, never an exception.
- **PlantUML** (`plantuml.ts`) → spec or `SequenceSpec`, with per-line diagnostics. Used by the Code tab, which applies it to the open diagram ([code-editor.md](code-editor.md)); not an `importDiagram` format.

Imports never throw on bad input: they return an empty spec and warnings.

## Adding a format

1. Pure writer in `src/core/export/` or `src/core/io/` taking `ExportPage[]` or a `DiagramDoc` (no DOM, no Node APIs).
2. Add it to `ExportFormat`, `EXPORT_MIME` and `EXPORT_EXTENSION` in `src/core/protocol.ts`.
3. Server: a branch in `exportDiagram` (`src/server/render/export.ts`). Browser: a branch in `client-export.ts` and a card in `ExportOptions.tsx`.
4. Test the writer on a document with a container, a decision, a database, a labelled connector and non-Latin text; render or open the result.

## Known limits

Rotated text is unsupported. PowerPoint cannot share a shape's text with its outline, so labels are separate text boxes. Mermaid export drops positions and styles. SVG exports carry whole font files (hundreds of KB). draw.io round-trips visually twin shapes (pill/terminator, diamond/decision) to the flowchart variant.
