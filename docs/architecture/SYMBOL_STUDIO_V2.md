# Symbol Studio V2 — product and acceptance contract

Status: specification and UX test contract. **Not yet implemented.**

## Primary user task

"As a substation HMI engineer, I can draw a breaker myself, select which graphic elements move or change color for each state, test the sequence and quality offline, save it into My Symbols, export the portable definition, drag another instance to the main HMI, and bind one SP/DP tag — without writing code."

## Workspace layout

A dedicated **Symbol Studio** workspace/window, not a popover of five fields:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ← HMI Studio  /  Symbol Studio > My CB      Undo Redo  Grid Snap  Preview  Save Export │
├────────────────┬───────────────────────────────────────────┬───────────────────────────┤
│ TOOLS          │                                           │ INSPECTOR                 │
│ Select / Node  │        VECTOR ARTBOARD                    │ Geometry | Appearance     │
│ Line / Pen     │        grid + rulers                      │ X Y W H, fill/stroke,    │
│ Rect / Ellipse │        zoom / pan                         │ opacity, pivot, rotation  │
│ Text / Group   │        handles & connection ports         │                           │
│                │                                           │ STATES                    │
│ OBJECT TREE    │        live state appearance              │ + state / duplicate state │
│ ▾ Breaker      │        selected-object outlines           │ 0 Intermediate            │
│   ├─ terminals │                                           │ 1 Open     ◉             │
│   └─ blade     │                                           │ 2 Closed                  │
│ + ports        │                                           │ 3 Bad                     │
│                │                                           │ Per-node property toggles │
├────────────────┴───────────────────────────────────────────┴───────────────────────────┤
│ State scrub/test   0  1  2  3      Quality GOOD/UNCERTAIN/BAD/STALE     Animate ▶       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Use low visual noise: small consistent tool icons, sensible default widths, no permanent dozens of inputs. Keep selection controls contextual. An unselected artboard shows only artboard properties and guidance. States panel highlights only *changes* from the base geometry, with per-property reset buttons. One primary Save action and one Export secondary action. Do not repurpose normal project Export.

## Specific expected interactions

| Interaction | Expected behavior |
| --- | --- |
| Single click | Select object; show 8 sensible bounding handles + rotate handle when applicable |
| Click near either end of line | Show two explicit endpoint handles and edit endpoints independently; preserve arbitrary slope, negative direction, and 0-width or 0-height lines |
| Drag empty artboard | Rubber-band selection (in Select tool); Space+drag pans |
| Drag selected object | Move with optional snap, live guides and one Undo transaction |
| Shift click | Toggle object selection; Shift+drag supports axis lock |
| Ctrl/Cmd click | Additive selection without deselecting others |
| Double-click a group/symbol instance | Enter *isolation mode*, edit children, breadcrumbs `Back to page`, Esc exits one level |
| Right-click element | Object context menu (Edit, Group/Ungroup, Duplicate, Copy/Paste, Bring Forward/Send Back, Lock/Unlock, Save as Symbol) |
| Right-click empty canvas | Canvas context menu (Paste, Select All, Grid, Zoom to Fit) |
| Ctrl/Cmd+G / Ctrl/Cmd+Shift+G | Group / Ungroup; children and transforms preserved |
| Ctrl/Cmd+C, V, D, Z, Shift+Z | Clipboard, duplicate, Undo, Redo; browser clipboard fallback where permission is unavailable |
| Delete/Backspace | Delete selected editable nodes; locked node is protected |
| Esc while dragging | Cancel without changing persisted document |
| Esc in isolation | Exit the current group level, preserving edits |
| Rotate handle | Explicit pivot marker, angle feedback, 15° modifier snap; no rotating whole switchgear bus by accident |
| Drag port handle | Edit port coordinate, snap to electrical connection anchors |
| Edit node in a particular state | Modify just that state override, not the base and other states |
| Reset override | Revert one changed property to inherited base; no value smearing |
| Preview state + quality | Per-part appearance computed with the same resolver used in HMI Runtime |
| Save/Export | Validated standalone symbol file and permanent project library reference |

**Line editing is a blocker.** Existing editor line `x,y,width,height` construction assumes positive dimensions and does not represent backward/rising line correctly. New vector node uses two independent endpoints and a transform matrix. Do not special-case with negative width fields in the old Shape model.

## Per-state example (for understanding, not final schema)

Base CB has nodes `terminalA`, `terminalB`, `blade`, `statusIndicator`.

| Node | Base | OPEN | CLOSED | BAD |
| --- | --- | --- | --- | --- |
| terminalA/B | neutral stroke | inherited | inherited | inherited |
| blade | x1/x2 + pivot | rotation -60°; stroke amber | rotation 0°; stroke green | neutral angle; stroke magenta; no optimistic animation |
| statusIndicator | hidden | optional OPEN label | optional CLOSED label | visible BAD/INVALID marker |

The user must be able to change e.g. `terminalA.fill` in OPEN, `blade.stroke` in CLOSED and `statusIndicator.visibility` in BAD completely independently. No hard-coded breaker-specific renderer.

## CI acceptance checklist

1. **Document model:** schema V2 parse and canonical serialization, v1 migration, cycle-free group hierarchy, bounded transforms, safe path grammar, bounded JSON import, stable IDs, duplicate-ID rejection, no arbitrary SVG/HTML/JS.
2. **Interaction:** point handles, all-resize edges and corners, rotation around custom pivot, selection isolation, context menu coordinates, group/ungroup, snapping and zoom-scaled pointer precision, Esc cancellation, Undo/Redo one transaction per gesture.
3. **State engine:** 0/1 and 0/1/2/3 distinct, state overrides per node + per property, inheritance/reset, quality priority, no uncontrolled writes to document on telemetry update.
4. **Portability:** save-> reload-> export-> import-> instance binding; arbitrary state-specific colors/transforms preserved; projects with old V1 symbols still load.
5. **Accessibility:** keyboard navigation and visible focus for tree/menu/inspector; context menu also accessible from keyboard; no trapped focus; reduced-motion respected.
6. **UX visual:** screenshot diff at 1366x768 and 1920x1080; no overlapping inspector, menu, canvas handles; editing context discoverable without reading documentation.
7. **Performance:** automated browser-based benchmarks with realistic 100/500/1000 nodes; avoid accidental O(n²) lookup and full-document save on pointer move.
8. **Regression:** CP-14 alarm center, CP-15 trends/historian, editor import, all existing FUXA assets, multi-PLC setup and GitHub Pages workflow untouched.

**Definition of Done:** a user can create an original valve, motor, or breaker (not one of the built-in presets) with at least two differently animated/colored sub-elements across four states; save, export, re-import, drag/drop, bind, and preview the same appearance. Screenshots plus browser E2E evidence are required. Passing compilation alone is not sufficient.

## Phased implementation / PR boundaries

- **V2-S0: Contracts, data model, migration** — schema V2 and resolver pure functions with exhaustive property and quality tests. No visible changes.
- **V2-S1: Editor engine substrate** — add pinned SVG.js plugins, isolated adapter, multi-handle geometry, endpoints, rotate/pivot, pan/zoom/snap, event to commands. Strong E2E.
- **V2-S2: Symbol Studio workspace** — separate full-size view, object tree, group isolation, context menu, double-click, undo/redo, creation tools, compact inspector.
- **V2-S3: State authoring** — state tabs, per-node editable property overrides, visual test controls, per-property interpolation and quality behavior.
- **V2-S4: Save/library/portability** — create/rename/version, project references, import/export, drag-drop main HMI, missing refs resolution.
- **V2-S5: Main HMI canvas migration** — adopt proven adapter for ordinary scene editing, delete old pointer code only after regression and parity tests. No blind wholesale replacement.

Use the same state and geometry contracts across S1–S5. Reuse code, never create a second data model per step. No phase considered done without passing CI + interactive evidence.
