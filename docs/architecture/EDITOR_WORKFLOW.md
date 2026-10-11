# Editor workflow checkpoint — 2026-10-11

Reference: FUXA at https://github.com/frangoteam/FUXA, audited upstream
commit a7705f084c1439edf1b27c1f69c737b8d6de0e00 (MIT).

## Practical workflow

1. Click or drag a shape from the left library onto the SVG canvas.
2. Click an object to edit it; Shift/Ctrl+click to select several, either on
   canvas or in Layers. Ctrl+A selects all; Escape clears selection.
3. When multiple objects are selected, the right panel shows six align
   commands and horizontal/vertical distribute for three or more.
4. Drag any selected object to move the entire selected set.
5. Undo reverts an alignment/distribution/move as one document action.
6. Export a JSON backup; the editor also saves browser-local state.

## Grounded engineering difference

FUXA's editor wraps SVG editor globals and uses jQuery helpers. This
implementation instead stores positions, identities and tag metadata in
versioned typed JSON. Pure functions compute geometry and never mutate a
rendered SVG element to persist data. Multi-object operations produce a
single undo-history entry. Drag previews update graphics in memory; only
the pointer-end commits to the saved project.

Angular selection membership is a computed Set rather than repeated array
search on every SVG element. This reduces the per-element membership
lookup from linear to constant-time on average; it is **not** a measured
FUXA comparative speedup. Browser rendering performance remains to be
benchmarked using equivalent documents on identical hardware.

## Acceptance

- Node unit tests cover immutable operation, metadata preservation,
  alignment/distribution idempotency, atomic move, validation.
- Chromium Playwright covers shift selection, layer selection, align,
  distribute, bulk movement, delete, undo, redo, reload and visual screenshot.
- GitHub CI executes exactly once per PR event; push to main also triggers CI.
- No PLC/IED live data or control in editor-only checkpoint.
- Real persistent SVG grouping, copy/paste, path tools and FUXA import are
  separately tracked for later milestones and are not presented as done.
