# Editor

The browser side of a diagram: store, live sync, canvas, commands, panels and dialogs under `src/features/editor/`.

## Store

`store/editor-store.ts` is a vanilla Zustand store created **per editor mount** (`createEditorStore(diagramId)`), never a module global, so several diagrams can live in kept-alive routes. React reads it through `store/context.tsx` (`useEditor(selector)`, `useEditorStore()`, `useDoc()`).

- **Local edits** go through `apply(patch)`: optimistic, undoable, emitted to the server. Use the helpers in `actions/elements.ts` (`createNode`, `styleSelection`, `commitText`, …) rather than building patches in components.
- **Drags** use `beginGesture` → `applyTransient` (not recorded, not sent) → `endGesture`, which diffs against the document captured at the start and produces ONE undo entry and one emitted patch.
- **Remote patches** use `applyRemote`. Agent patches also enter the undo stack, so the person can undo the agent's last change; patches from the person's other tabs do not.
- **Selectors must return stable references.** Derive arrays with `useMemo` from stable inputs (see `panels/inspector/Inspector.tsx`); `useEditorShallow` covers the rest.
- **Viewport** (`viewport`, `zoomAt`, `zoomTo`, `fit`) is applied imperatively to the DOM in `canvas/Canvas.tsx` and `canvas/Scrollbars.tsx`; panning never re-renders React. `CHROME` in the store holds the space taken by floating panels, so framing keeps content clear of them.

## Sync

`sync/client.ts` (`connectSync`) loads the document, opens the SSE stream, queues local patches (coalesced while a request is in flight, retried, reload on rejection) and posts presence (selection, viewport) so agents can ask "what is selected". `sync/playback.ts` choreographs remote work: new elements draw in one by one under the agent's cursor, moved nodes glide, and the view follows when the agent draws outside it. The document is already up to date when playback starts — playback is presentation only.

## Canvas

| File | Role |
| --- | --- |
| `canvas/World.tsx` | draws elements (memoised per node; markup from `canvas/markup.ts`) |
| `canvas/Overlay.tsx` | selection handles, ports, rubber band, guides, highlight rings |
| `canvas/HtmlOverlay.tsx` | in-place text editor, comment pins, agent cursor — HTML in world space |
| `canvas/use-interactions.ts` | pointer state machine: pan, marquee, move, resize, rotate, connect, re-attach |
| `canvas/snapping.ts` | smart guides, grid snapping, resize maths |
| `canvas/Scrollbars.tsx` | visible scrollbars over the content extent |

Gotchas: the pointer is captured by the canvas root, so hit-testing uses `document.elementFromPoint` (not `event.target`); elements carry `data-id`, handles `data-handle`, ports `data-port`, HTML overlays `data-canvas-ui` (ignored by canvas pointer handlers). Routes stay mounted under React `<Activity>`, so every effect must clean up.

## Commands

`commands/commands.ts` is the single registry: id, title, group, `keys`, `enabled`, `run`. Shortcuts (`use-shortcuts.ts`), the command palette, context menu and shortcut sheet all read it. Add a command there and it appears everywhere. Key strings use `mod+shift+z` form (`mod` = Ctrl/⌘); arrows nudge the selection or, with nothing selected, pan the view.

## Panels and dialogs

- **Side panel tabs**: add the id to `SidePanel` in `store/editor-store.ts`, then register an entry in `TABS` and `PANELS` in `panels/SidePanel.tsx`. Panel components unmount when another tab is chosen; keep conversational or draft state in the store (see `chat`).
- **Dialogs**: add the id to `DialogId`, render it from `dialogs/Dialogs.tsx`, open with `store.setState({ dialog: "…" })`. While a dialog is open canvas shortcuts are suspended; `Dialogs` clears orphaned ids.
- **Floating chrome** lives in `Editor.tsx` (`Workspace`): top bar, palette, side panel, toolbar, zoom controls.

## Verifying UI work

Unit tests cover the pure parts (`actions`, `export`, `palette-search`). For interaction changes, drive a real browser against a scratch server — see [testing.md](testing.md).
