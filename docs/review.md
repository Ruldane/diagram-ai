# Reviewing agent changes

Agents edit the live diagram and their changes land immediately. Review lets the person see what changed, compare before and after, and accept or reject changes one by one. The same diff powers "compare with a checkpoint".

```
 agent change ──► DiagramService.apply ──► baseline taken (first agent change only)
                                              │
 browser ◄── SSE `review` ◄── tracker ◄───────┘
    │ GET /review → baseline ──► diffForReview(baseline, live doc) ──► panel + canvas overlay
    │ Reject: revertPatch ──► store.apply (synced, undoable)
    └ Accept: POST /review ──► baseline moves forward (server only)
```

## Baseline

One baseline per diagram, stored through `DiagramRepository.getReviewBase / setReviewBase` (`data/review/<id>.json` for `FileRepository`): a copy of the document (`nodes`, `edges`, `comments`) as it was before agents started changing it since a person last accepted.

- **Created** lazily by the first change from an actor with `kind === "agent"` that touches nodes, edges or comments, from the document as it is *before* that change. Renames and settings changes alone do not create one. An agent restoring a checkpoint does.
- **Never created or altered by people.** Human edits, undo and reject do not touch it; whatever differs from it, whoever caused it, is shown.
- **Moved forward** only by accepting. When nothing differs any more it is cleared (`null`) and `{ type: "review", review: { active: false } }` is published.
- Deleting the diagram deletes it. Name and settings are not part of the diff.

`ReviewInfo` (`core/protocol.ts`): `{ active, by?, since? }`. `by` is the agent whose change created the baseline, `since` when.

## Diff (`src/core/review/diff.ts`)

`diffForReview(base, current)` returns changes per element: `added`, `removed`, `modified` (with `fields`) and `layout`.

- `layout` is a change that only touches position, size or route: node `x y w h rotation`; connector `waypoints autoRoute from.anchor to.anchor from.point to.point`; comment `x y`. Anything else changed on the element makes it `modified`. The UI folds all layout changes into one "Rearranged N shapes" entry and the canvas draws ghosts for the 30 that moved furthest.
- `fields` names what differs: top-level fields, plus `style.<key>` and `from.<key>` / `to.<key>`. `describeFields` (labels.ts) turns them into words.
- Comparison is structural and treats `undefined` as absent (`equal.ts`), so a document that went through JSON equals the live one. Results are cached per pair of immutable element objects, which keeps re-diffing on every drag frame cheap.
- Comments are included: added, removed, resolved, replied to.

## Revert (`revert.ts`) — reject

`revertPatch(base, current, ids)` builds the patch that puts those elements back. The browser applies it with `store.apply`, so it is validated, synced and undoable (Ctrl+Z). Integrity rules:

| Case | Result |
| --- | --- |
| added node | removed, with the connectors attached to it; a connector that existed in `base` is re-attached to its old ends instead |
| removed node | restored with its removed connectors (when their other end exists or comes back) and with any removed container, first |
| modified element | the `base` version, including what the person changed after the agent |
| changed connector | brings back the nodes it was attached to |
| comment | brings back the element it was pinned to |
| children of a rejected container | go back to the container they had |

Ids that are not part of the difference are ignored. Rejecting everything makes `diffForReview` empty and the content equal to the baseline (tested).

## Accept (`accept.ts`)

`acceptIntoBase(base, current, ids | "all")` rewrites the baseline so those elements equal the current state. It never touches the diagram and is not undoable. The baseline must stay a valid diagram, so accepting can pull related elements in: a connector brings its new nodes, a node its new container, a comment its target, and accepting a removal accepts what that removal detached. The result reports `accepted` and `remaining`.

The panel sends explicit ids even for "Accept all", so something an agent added while the list was on screen stays pending.

## Server

- `src/server/review/tracker.ts` — `ReviewTracker`: `beforeChange` (called from `DiagramService.apply` with the complete patch, before saving), `beforeReplace`, `accept`, `read`, `status`.
- `DiagramService`: `reviewState(id)`, `acceptReview(id, ids)`, `reviewStatus(id)`, `getSnapshot(id, snapshotId)`. `apply` is now async because the baseline is persisted before the change is saved. A failed baseline write is logged and does not block editing.
- `GET /api/diagrams/[id]/review` → `{ review, base }`. `POST` `{ action: "accept", ids?: string[] | "all" }` → `{ review, base }`. Same-origin guarded. An empty `ids` accepts nothing and closes a review that no longer differs.
- `GET /api/diagrams/[id]/snapshots/[snapshotId]` → `{ snapshot: { id, name, createdAt, doc } }`.
- Events: `review` is published when the baseline appears, changes (partial accept) or clears; `hello` carries the current `review`.

## Editor (`src/features/editor/review/`)

| File | Role |
| --- | --- |
| `review-state.ts` | shared memoised diff, server calls, `acceptChanges`, `rejectChanges`, `focusIds`, `compareWithCheckpoint` |
| `use-review.ts` | `useReviewSync` (keeps `store.compare` in step with the baseline; closes a drained review), `useReviewDiff` |
| `ReviewPanel.tsx` | the Review tab: header, summary, grouped rows, accept / reject per row and for all |
| `DiffOverlay.tsx` | canvas overlay, mounted in `Canvas.tsx`; visible while the tab is open or a checkpoint is compared |
| `ReviewPill.tsx` | top-bar pill ("Review 7 changes", or the checkpoint being compared with a close button) |

`store.compare` is `{ base, label, source: "review" | "checkpoint" }`. A checkpoint comparison takes precedence over the review baseline until it is closed. Entry points: the pill, the `review.open` command, and "Compare" per checkpoint in the history dialog.

Overlay colours: added green with a "+", changed amber, removed dashed red ghost with its label at the old position, moved shapes a faint ghost with a thin connector.

## For agents

- `diagram_read` (markdown) adds a `Review:` line while changes are pending.
- `diagram_review_status` (read-only): counts, the pending elements, and which of the agent's elements the person deleted or put back. That last part is kept in memory (`ServiceState.review`), so it resets when the server restarts or the baseline is accepted.

## Known limits

- The review is per diagram, not per agent: `by` is the agent that started it, and later agents' changes join the same list.
- Changes a person made after the agent show up in the same list; there is no "also edited by you" hint because the agent's version of an element is not kept.
- Accept "all" or by id acts on the server's current document; an agent change landing between the list being drawn and the click is covered by sending ids, not by locking.
- A rejected change is an ordinary edit, so the baseline stays until the list is accepted or drains.

## Extending

- **A field that should count as "rearranged"**: add it to `LAYOUT_FIELDS` in `src/core/review/diff.ts`; list it in `FIELD_NAMES` in `src/core/review/labels.ts` if it needs a readable name.
- **A new kind of element** (the model gets a fourth collection): add it to `COLLECTIONS` in `diff.ts`, then handle it in `revert.ts` (restore / remove / dependencies), `accept.ts` (build and closure) and `ReviewPanel.tsx` (icon). The tests in `review.test.ts` fail loudly if the round trip breaks.
- **Another repository**: implement `getReviewBase` / `setReviewBase` from `DiagramRepository`; the tracker needs nothing else.

## Tests

```bash
npx vitest run src/core/review src/server/review
```

`src/core/review/review.test.ts` covers diff classification, revert integrity, accept closure and the round trip. `src/server/review/review.test.ts` runs the service against a temp data directory (`DIAGRAM_DATA_DIR` is set before the config is imported, so the repository never touches `./data`): baseline lifecycle, the exact diff of an agent's `applyElements` calls, rejecting every kind of change, partial and full accept, deleting a diagram, agent status.
