# Connector routing

How orthogonal connectors get their path, how that interacts with auto-layout, and how to tune or extend the router. Read before touching `src/core/edges/`.

## Who draws which connector

| Connector | Path comes from | Moves when a node moves? |
| --- | --- | --- |
| Layered auto-layout (`computeLayout`, ELK) | `waypoints` + `anchor`s stored on the edge, `autoRoute: true` | No. Moving an end node releases the route (`autoRoute`, waypoints, anchors are dropped by `use-interactions.ts` / `actions/elements.ts`), which makes the edge live-routed. During a layout tween `World.tsx` does the same temporarily. |
| No `waypoints` (manual edge, agent-added after a layout, import, edge whose route was dropped) | Live routing, every call of `routeEdges` | Yes, immediately. |
| `routing: "straight"` / `"curved"` | Straight line / spline through waypoints, no obstacle avoidance | n/a |
| User-fixed `anchor` | Port stays exactly there; the router routes around it | n/a |

Stored routes always win: `planEdge` in `src/core/edges/geometry.ts` clips the polyline to the shapes and stops there. Live routing only ever sees edges with no waypoints, so a diagram laid out by ELK costs almost nothing to render, and a hand-tuned one keeps working after an agent adds three more connectors.

`flow` (derived from `settings.layout.direction`) only matters when two boxes sit diagonally: it decides whether the connector leaves the bottom/top (vertical flow) or the side. It feeds `pickSides`; the router never overrides it unless the preferred sides are blocked (below).

## Pipeline (`routeEdges`)

1. **Ports.** Per node side the live edges are sorted by where their other end is and fanned out `PORT_SPACING` apart. Ports already occupied by fixed anchors (ELK routes, author-chosen anchors) count as taken, so a new edge does not land on top of an existing arrowhead.
2. **Fixed edges first.** Straight, curved, stored-route and loop connectors are built; the orthogonal ones are registered in the scene's `RoutedIndex` so later connectors steer around their channels.
3. **Live edges, shortest first** (tie-break: edge id, so the result does not depend on storage order). Each is `RoutingScene.route`d between its ports.
4. **Alternative sides.** Only when the preferred route crosses a node or needs 3+ bends: every other side combination is tried cheapest-lower-bound first, and taken if it saves more than `PORT_SWITCH`. Fixed anchors and free ends never move. Sharing a channel is *not* a reason to switch.
5. **Nudging** (`router/nudge.ts`): runs of different connectors on one line are fanned `6` px apart, ordered so equal turns stay on one side (no new crossings), and kept 5 px off node walls. Port stubs and ports never move; routes with stored waypoints are pinned references.

## The router (`src/core/edges/router/`)

- **Obstacles** are all non-container nodes except the two ends (rotated bounds). Each has a *soft zone* (12 px, `CLEARANCE`) whose penalty fades linearly to nothing at the edge of the zone, and a *hard core* (node + 4 px) that costs 25 per px to cross. Because crossing is merely expensive, there is always an answer: boxed-in ends get the route that crosses the least. Gaps under 8 px are walls; wider ones are used when cheaper than the detour.
- **End nodes** are obstacles too, with the clearance shrunk to the stub so the route can leave. Ports inside the bounding box (diamond slopes, fanned ports on ellipses) get `depth`: the first run extends to the box border before the stub. An end that starts inside an obstacle's core is let out through it; inside the node itself (interior anchors, sequence lifelines) the node is ignored.
- **Containers** are never walls. Soft costs only: leaving the container both ends live in (`OUTSIDE_PER_PX`) and running along a container's title strip (`HEADER_PER_PX`, horizontal runs only). Assumes the header is on top (all current container shapes except side-lane headers).
- **Cost** = length + 40 per bend + penalties. U-turns are banned in the search (the state has a direction) and cost 3000 anywhere else.
- **Search** (`router/search.ts`): sparse grid whose lines are the ports, the obstacles' zone borders, the middle of the ports and the middle of narrow gaps; A* over (vertex, direction) with a 1.25-weighted distance estimate (`GREED`). The grid holds only the obstacles the answer touches; `RoutingScene.solve` grows that set until the answer touches nothing new, so results equal a search over everything. Over `MAX_OBSTACLES` / `MAX_VERTICES` / `MAX_EXPANSIONS` the search gives up and the best of the open-space shapes plus swings around the cluster is used.
- **Fast path:** `simpleCandidates` (straight, two L, two Z) are scored first; a clean one is accepted without a search. This is most connectors of a typical layout.
- **Window:** obstacles come from a window around the ends; if the answer leaves the window it is widened and the search repeated (obstacles beyond the window were never considered). A route that still crosses a node widens the window up to `ROUNDS` times looking for a detour.
- **Centering** (`RoutingScene.center`): every interior run with free space on both sides slides to the middle of it. The search only decides *topology*; this puts bars in channels instead of on walls.
- **Output** is cleaned (`cleanPolyline`): exactly axis-aligned, no repeated or collinear points, so `roundedPolyPath` never sees a zero-length run.

## Gotchas

- `routeEdges` must stay deterministic: exports, previews and tests compare output. No `Math.random`, no iteration over `Set`/`Map` insertion order that depends on storage order, ties broken by id or index. The A* key folds in `-g * 1e-7` only to prefer deeper states on ties.
- Everything is in world px and independent of zoom. Do not add screen-space tuning.
- The scratch typed arrays in `search.ts` are module-level and reused; the search is not re-entrant (it never calls itself).
- `Cost.penalty` is what the simple-shape shortcut compares against `SIMPLE_SLACK`; a new cost term must feed it or shortcuts will skip it.
- Cheap checks for a new term: `scripts/routing-gallery.ts --before` shows what the old heuristic drew next to the new route.

## Extending

- **New soft cost** (e.g. avoid labels, prefer a layer): add it to `extraCost` / `placementCost` in `router/cost.ts`. It is evaluated per unit grid edge once (cached) and per run in `evaluate`, so keep it a pure function of `(horizontal, fixed, lo, hi)`.
- **New obstacle kind**: add a `SceneBox` in `sceneBoxes` (`geometry.ts`); containers are the template for "not a wall but costs something".
- **Tuning**: constants live in `router/types.ts` with their meaning. Change one at a time and compare galleries; the bend/crossing tests in `router.test.ts` guard the invariants (no crossing when a free route exists, bends no worse than the old heuristic in 95% of cases).

## Commands

```bash
npx tsx scripts/routing-gallery.ts                 # scenarios → .gallery/routing/*.png
npx tsx scripts/routing-gallery.ts --before wall   # also what the old heuristic drew (…-before.png)
npx tsx scripts/routing-gallery.ts --templates     # catalog templates with all stored routes dropped
npx vitest run src/core/edges/router.test.ts
```

Scenes and the old heuristic (kept as a baseline) are in `src/core/edges/router.fixtures.ts`.

## Known limits

- Connector labels are not obstacles; two connectors' labels can still touch.
- Nudging does not know about other connectors' ports: a fanned run can end up one px from a neighbour's arrowhead.
- Dense diagrams (a window with more than ~48 obstacles that all matter) fall back to the open-space shapes plus detours and may cross a node; `ALTERNATIVE_BUDGET` bounds the side-switching work per pass.
- Rotated containers use their bounding box for the title strip.
