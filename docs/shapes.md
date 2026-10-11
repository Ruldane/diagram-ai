# Authoring shapes

A shape is a plain object (`ShapeDef`) that turns a node into a list of drawing
primitives. There is no React, DOM or canvas involved: the same primitives are
rendered by the editor, the SVG / PDF / PowerPoint exporters and the server-side
PNG preview, so a shape written once looks identical everywhere.

## Where things live

| File | Purpose |
| --- | --- |
| `src/core/shapes/kit.ts` | **Import everything from here.** Path builders, paint helpers, text helpers, icons. |
| `src/core/shapes/types.ts` | `ShapeDef`, `ShapeCtx`, `Prim` contracts. |
| `src/core/shapes/compartments.ts` | `compartmentBox` (header + `---` sections) and `stackText` (title / subtitle groups). |
| `src/core/shapes/icon-shapes.ts` | `iconTile`, `iconCard`, `iconShape`, `iconBadge` preset builders. |
| `src/core/shapes/libraries/*.ts` | One file per library. `basic.ts` and `flowchart.ts` are the reference examples. |
| `src/core/shapes/libraries/index.ts` | Library list (palette order). |
| `src/core/shapes/icon-data.ts` | Generated icon set (`npm run icons`). Keys are the valid `data.icon` names. |

## Rules

1. **Local coordinates.** Draw inside `0..w` × `0..h`. Never assume the default
   size: every coordinate must derive from `ctx.w` / `ctx.h` (clamp decorations
   with `Math.min(...)` so tiny and huge nodes both look right).
2. **Only two primitives**: paths (`body`, `line`, `solid`) and text (`text`,
   `stackText`). Paths use the `Path` IR (`M`/`L`/`C`/`Z`); build them with
   `rectPath`, `ellipsePath`, `polyPath`, `roundedPolyPath`, `linePath`, or
   `parseSvgPath("M… SVG path …")` + `fitPath` for artwork authored in a viewBox.
3. **Respect the node style.** Use `body(ctx, path)` for the main fill+stroke so
   the user's fill, stroke, width and dash apply. Use `line(ctx, path)` for inner
   strokes, `solid(path, color)` for flat fills, `tint` / `shade` to derive
   colours from `ctx.style.fill` / `ctx.style.stroke`. Colours are `#rrggbb` or
   `"none"` — always handle `fill === "none"`.
4. **Labels.** By default the node text is drawn centred in the box (shrunk by
   `inset`, a per-side fraction). Override with `label: (ctx) => ({ box, align,
   valign, padding, font })`, or return `null` when the shape draws its own text.
   A label box may sit outside the node (e.g. below an icon: `y: ctx.h + 4`).
5. **Structured text.** `ctx.sections` is the label split on `---` lines. Use it
   for compartments (`compartmentBox`) instead of inventing `data` fields, so
   people can simply type and agents can simply send text.
6. **Parameters** come from `node.data` via `param(ctx, "key", fallback)`.
   Declare defaults in `data: { … }` on the shape.
7. **Outline.** `outline(w, h, style)` must return a *closed* path inside the
   box. Connectors are clipped against it and it is the click target.
   `simpleShape({ path })` sets it automatically.
8. **Auto-size.** Provide `fit(ctx)` when the size depends on content
   (`compartmentFit`, `stackHeight`, `measureText`). Otherwise the generic fit
   uses `size`, `inset` and the label.
9. **Containers** (`container: true` or `{ header, padding }`) hold child nodes;
   keep their fill light or `"none"` and put the title in the header strip.
10. **Metadata matters.** `id` is `library/kebab-name`; `name` is the palette
    label; `aliases` are what a person or an AI agent would naturally type;
    `description` is one line saying when to use it. `text` is the default label.

## Checklist

```bash
npx vitest run src/core/shapes        # invariants for every registered shape
npx tsx scripts/gallery.ts <library>  # renders .gallery/<library>.png — look at it
npx tsc --noEmit
```

The gallery scales down shapes wider than ~290 px, so text in very wide shapes
can look cramped there; judge those at their natural size.
