# V2-S1A: coordinate math for native editing controls

**Scope:** pure math substrate only; the visible SVG.js canvas adapter and interaction UI are V2-S1B.

## Why this exists
Native canvas gestures must operate on independent line endpoints and resize handles in nested groups with rotation, zoom and custom pivots. Shape box width/height is insufficient, and using screen coordinates directly corrupts geometry.

## Features
- Typed 2D affine matrices with composition, inverse and singular guard.
- Parent-child world transforms for any nested Symbol Studio V2 group.
- World-to-local pointer conversion, arbitrary-slope/reverse-direction line endpoint editing.
- Bounding handle positions (8 resize directions), zoom-aware radius hit testing.
- Rect/ellipse edge-preserving resize in original local coordinates even when rotated.
- Rotation about stored custom pivot and modifier snapping to 15 degrees.
- Parent-local translation for dragging objects within transformed groups.
- Grid snapping in world coordinates, undo history cancellation/one-commit gesture acceptance.

## Perf, safety, integration
These are pure, DOM-free functions that are reusable from SVG.js and unit tested without browser. No new per-object polling, no repaint timer, no backend/industrial changes.

**This stage does not yet ship the Symbol Studio GUI.** S1B adds the actual pinned, licensed SVG.js interaction adapter, drag handles and Playwright mouse tests. S2 adds dedicated full-window interface, group edit isolation and context menu. Legacy canvas remains unchanged until parity gates are met.
