# Layout, positions and x/y

How nodes get their position, when to leave it to the engine and when to give coordinates yourself.

## The default: no coordinates

Omit `x`, `y`, `w` and `h` on every node. Each node is sized to its text (never smaller than its shape's default size, rounded up to a 10 px grid; labels wrap at about 220 px) and the layout engine places nodes and routes connectors. The diagram type sets the default algorithm and direction (`c4-container` is layered, top to bottom; `system-architecture` is layered, left to right). `diagram_read` prints the current one: `layout: layered/down`.

## What `layout` does on `diagram_add_elements`

| Value | Effect |
| --- | --- |
| `"auto"` (default) | New nodes without `x`/`y` are positioned. If the diagram was empty, or auto-layout is on (nobody arranged it by hand), the whole diagram is re-laid-out with the diagram's layout. If a person arranged it (`diagram_read` says "auto-layout off"), only the new nodes are placed, next to the nodes they connect to, and nothing else moves. |
| `"none"` | Keep the `x`/`y` you gave; nodes without them stack in a row to the right of existing content. Use it when position is the meaning. |
| `{ algorithm, direction, spacing?, rankSpacing? }` | Force a full re-layout with these options. |

`diagram_update_elements` defaults to `"none"`: renaming a node makes it grow but does not move its neighbours. If the result overlaps, call `diagram_layout`.

## `diagram_layout`

- `options.algorithm`: `layered` (flows, architectures, dependencies, class hierarchies), `tree` (org charts, mind maps, decision trees), `force` (networks without a clear direction), `radial` (hub and spoke), `grid` (unconnected items).
- `options.direction`: `down`, `right`, `up`, `left`. A wide diagram (many stages in a row) is easier to read as `right` in a landscape window; a deep hierarchy as `down`.
- `options.spacing` and `rankSpacing` (px) loosen or tighten a crowded or sparse result.
- No options: re-applies the diagram's current layout, which is what "tidy this up" means.
- `ids`: arrange only those nodes. The result stays where that region was.
- Only `layered` honours containers: it sizes a container around its children. With `tree`, `force`, `radial` or `grid`, children simply follow their parent, so keep grouped diagrams on `layered`.

## When to give coordinates

Position carries the meaning in: roadmap, timeline, Gantt chart, kanban board, wireframe, swimlane, layered architecture, event storming, comparison table. The catalog guide of those types says so; pass `layout: "none"` and set `x`, `y`, `w`, `h` yourself.

- Units are canvas pixels. The origin is wherever the content starts; `y` grows downward. Round to multiples of 10.
- A container draws its title in a 32 px header strip and wants about 20 px of padding on every side. Size it to its children yourself (children need `parent`); `layered` layouts do this for you.
- Give a row of nodes the same `y` and `h`, a column the same `x` and `w`, and a constant gap (40-60 px) between neighbours.
- `diagram_read` shows each node's position and size, so you can place new nodes relative to existing ones.

## Connectors

Connectors are routed by the layout (orthogonal by default) and re-routed on every layout. After a person moves shapes by hand they are not re-routed around unrelated shapes. Set `routing` (`orthogonal`, `straight`, `curved`) on an edge only if the preview shows a problem. `fromAnchor` / `toAnchor` (`top`, `right`, `bottom`, `left`) pin the side where a connector leaves or enters; they matter mostly in diagrams with explicit coordinates, such as stacked layers or swimlanes.

## Sequence diagrams

`diagram_build_sequence` computes its own coordinates: lifelines spaced so labels fit, one row per message, and the diagram is marked as hand-arranged. Do not call `diagram_layout` on it: a graph layout would pull the lifelines out of their rows. If the diagram already has content the sequence is placed below it.

## Hand-arranged diagrams

Dragging, nudging, aligning or distributing nodes in the browser switches auto-layout off (so do imports and sequence diagrams). From then on:

- add nodes freely: they are placed near their neighbours;
- do not call `diagram_layout` without `ids` unless asked, because it discards the person's arrangement (save a `diagram_checkpoint` first if you must);
- to tidy only a messy corner, pass `ids` or move single nodes with `diagram_update_elements` (`x`, `y`).
