# Routing agent hand-off (connector routing)

State at pause: the new router is DONE and WIRED (not behind a flag). `tsc` clean on `src/core`, `npx vitest run src/core` green (3190 tests), eslint clean on my paths.

## Done
- `src/core/edges/router/` (new): `scene.ts` (RoutingScene: window, lazy obstacle set, fast path, fallback, centering), `search.ts` (sparse grid + weighted A*, pooled typed arrays), `cost.ts` (cost model, `Problem`, `evaluate`), `candidates.ts`, `nudge.ts`, `polyline.ts`, `spatial.ts`, `routed.ts`, `types.ts` (all tuning constants), `index.ts`.
- `src/core/edges/geometry.ts`: `planEdge` / `routeEdge` / `routeEdges` rewritten around the scene; old heuristic removed (kept only as baseline in `router.fixtures.ts`). Port selection, fanning, `flow` unchanged; fanning now treats fixed-anchor ports as occupied; alternative sides only when blocked / 3+ bends.
- Tests: `src/core/edges/router.test.ts` (21). `core.test.ts` untouched and passing.
- Docs: `docs/routing.md`. Minimal edit to the "Connectors" line in `README.md` Limits.
- Gallery: `scripts/routing-gallery.ts`.

## Half-done
Nothing. No scratch servers, no `.next-*` of mine (`.next-chat`, `.next-dev.log` belong to others).

## Remaining, priority order
1. Eyeball in the real editor (never ran the app): drag a node in an ELK-laid-out diagram, add an edge via MCP, layout tween; check frame time (`useDisplay` re-routes on every tween frame; est. 20-30 ms at 300 connectors).
2. Cache live routes between frames in `World.tsx`/`useDisplay` if drag feels slow (not needed for correctness).
3. Port alignment: a fanned port next to an unfanned one leaves a 6-8 px jog (visible in uml-activity "Cancel and notify" -> final node). Needs a rule in `routeEdges` slot assignment, not the router.
4. Connector labels are not obstacles; nudging ignores neighbours' ports.
5. Side-header lanes: title-strip penalty assumes header on top (`sceneBoxes` in geometry.ts).
6. Dense windows (>48 relevant obstacles) fall back to simple shapes and may cross a node; raise `MAX_OBSTACLES`/`MAX_VERTICES` in `router/types.ts` if worth the time.

## Measured (laptop, node, warm)
- 300 nodes / 400 connectors, layered scene (typical): ~15-35 ms (first call ~60 ms JIT).
- 300 / 400, random long-range pairs (adversarial): ~110-160 ms. 150 / 200: ~30 ms.
- 1790 random connectors, 60 scenes of 5-40 boxes: 0 node crossings; free route always found by the lattice oracle.
- Bends <= old heuristic in ~97.7% of cases where the old route was obstacle-free (rest = clearance instead of hugging).
- Weighted A* (GREED 1.25) cut the dense case 330 -> 120 ms with identical property results.

## How to run
```
npx tsx scripts/routing-gallery.ts [name...] [--before] [--templates]   # -> .gallery/routing/*.png (git-ignored; deleted for the pause, regenerate)
npx vitest run src/core/edges/router.test.ts
npx tsc --noEmit ; npx eslint src/core/edges scripts/routing-gallery.ts
```
Scenes, `legacyRoute` baseline and the lattice oracle live in `src/core/edges/router.fixtures.ts`.

## Gotchas
- Output must stay deterministic (ties by id/index; no Map-order dependence). Tests cover it.
- `Cost.penalty` feeds the simple-shape shortcut (`SIMPLE_SLACK`); new cost terms must add to it.
- Unrelated failures seen in the full suite: `src/server/chat/route.test.ts` (409 vs 403), not routing.
