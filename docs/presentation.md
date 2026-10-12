# Presentation mode

A full-window slide show of the open diagram. It is the live canvas with the editor's chrome swapped for a small overlay, so what the audience sees is exactly what the editor draws (same scene, same text metrics, vector-crisp at any zoom).

Code: `src/features/editor/present/`. Store fields: `presenting` (`{ frame } | null`) in `store/editor-store.ts`.

## What a slide is

| Diagram has | Slides |
| --- | --- |
| top-level frames (`basic/frame`) | one per frame, in reading order (rows top to bottom, left to right; the order PDF and PPTX export use) |
| no frames | one slide: the whole diagram |
| nothing | nothing to present; a toast says so and the show does not start |

`slides.ts` holds the pure parts (ordering, `fitSlide` framing maths, `blendViewport` for the camera move) and is unit-tested. A frame's `note` (the inspector's note field) is the speaker note, shown with `N`.

## Starting and leaving

| Way in | Notes |
| --- | --- |
| `view.present` (Ctrl/⌘+Alt+P, command palette, top-bar button) | starts at the selected frame, or the frame that holds the selection, else slide 1 |
| `view.present-frame` (context menu on a frame) | starts at that frame |
| `/d/<id>?present=1` (`&slide=3`, 1-based) | starts as soon as the diagram has loaded. The parameter is removed from the address when the show ends on purpose, so a reload does not start it again |

Leave with Esc, the X button or the same shortcut. Fullscreen is requested on entry; browsers refuse it outside a user gesture (a `?present=1` link), then the show runs in the window and **F** goes fullscreen. Leaving fullscreen with Esc ends the show too. The previous viewport is restored on exit.

## Controls

| Key | Action |
| --- | --- |
| → ↓ PageDown Space Enter | next slide |
| ← ↑ PageUp Backspace | previous slide |
| Home / End | first / last slide |
| click right / left third, swipe | next / previous |
| **L** (hold) or the crosshair button | laser pointer (red dot; the button keeps it on) |
| **H** or the ring button | highlight ring that follows the cursor |
| **D** | dim everything outside the current slide's frame (on by default) |
| **N** | speaker notes strip |
| **F** | fullscreen |

The overlay (title, controls, dots or a bar for more than 14 slides) fades after two seconds without pointer movement; a 3 px progress line along the bottom edge stays. Everything uses the editor's light/dark tokens; the dimming sheet is the page colour, so dark diagrams dim to dark.

## Read-only, live

- The canvas is covered by a pointer-capturing layer and a window-level key handler stops every editor shortcut, so nothing can be moved, typed or deleted.
- `apply()` in the store also refuses local edits while `presenting` is set (belt and braces: a stray dialog or panel effect cannot write).
- Remote patches still arrive through `applyRemote`: an agent can keep drawing, and a new frame appears as a new slide. The current slide is tracked by frame id, so inserted or reordered frames do not jump the view.

## Motion

The camera glides between slides (`animateViewport`, ~450 ms ease in-out; the centre travels in a straight line while zoom changes by a constant factor). With `prefers-reduced-motion` the move is immediate and the overlay does not fade. Resizing (entering fullscreen) re-frames at once.

## Gotchas

- `watchPresentation` is mounted by `PresentMode` and its cleanup ends the show, so a hidden (kept-alive) or unmounted editor never keeps a fullscreen session. In dev, StrictMode runs that cleanup once; that is why entry from the URL is an effect that can run again rather than a once-only flag.
- The overlay hides `[data-layer="overlay"]`, the grid and toasts with a scoped `<style>` while presenting; selection handles, comment pins and agent cursors never reach an audience.
- Verify with a real browser: `?present=1`, light and dark, a diagram with frames and one without. See [testing.md](testing.md).
