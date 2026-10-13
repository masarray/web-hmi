# ADR-002 — Professional SVG Editor Engine for Web HMI Studio

Status: **Accepted target architecture; partially implemented via Symbol Studio V2 and wiring milestones** (2026-10-13). The SVG.js plugin adapter described below is **not yet integrated**, and full native editor parity is not claimed.
Historical baseline for this design decision: `8b57fa835123feed37b67732096f349459d4d2ef` (CP-15). **Do not use this SHA as a code base**; read [HANDOFF.md](../../HANDOFF.md), latest `main`, Issue #19 and the actual source code before continuing.

## Problem statement / evidence from code

The current SVG editor is an Angular template with one hand-built selection / move / resize interaction. A selected object only exposes a bottom-right resize handle; lines use a size box instead of individually editable endpoints. There is no native double-click edit context, right-click object menu, nested grouping, point editing, rotation UI or drag-to-create affordance. The DYN-01 `symbol-builder` is a narrow configuration strip: its schema only accepts line primitives, one movingPartId, one pivot and one angle/color per logical state. It cannot express per-part state-dependent fill/stroke/transform/visibility.

**Do not keep extending the old toolbar and inspector with ad-hoc cases.** Create one reusable graphical interaction layer and a dedicated editing workspace.

## Selection (legal and technical)

| Candidate | Assessment |
| --- | --- |
| SVG.js 3.x + official select / resize / draggable plugins | **Chosen:** MIT, keeps editable/native SVG vector DOM, selection/rotate/resize/draggable building blocks, Angular-independent, well-aligned with runtime SVG |
| Fabric.js | MIT, rich native editing and grouping, but uses raster canvas and forces a second scene representation plus import/export normalization against existing SVG |
| SVG-Edit / @svgedit/svgcanvas | Powerful MIT editor; borrow architecture/concepts or vetted permissive modules but a full application fork would bring much UI and incompatible data-model coupling |
| Konva | MIT, strong controls, canvas-based scene/serialisation mismatch |
| tldraw current SDK | Not default: production use requires a license; React-oriented. May use as interaction inspiration only |

Sources: https://github.com/svgdotjs/svg.js, https://github.com/svgdotjs/svg.select.js,
https://github.com/svgdotjs/svg.resize.js, https://github.com/svgdotjs/svg.draggable.js,
https://github.com/fabricjs/fabric.js, https://github.com/SVG-Edit/svgedit,
https://tldraw.dev/community/license.

**License discipline:** import audited, version-pinned npm packages under their MIT licenses, retain copyright/license notices in `THIRD_PARTY_NOTICES.md`; do not bulk-copy FUXA, SVG-Edit or commercial SDK files or paste unfamiliar code without checking provenance, dependencies and test coverage.

## Mandatory architectural boundary

The *editor-only canvas* is a dedicated `VectorCanvasAdapter`, which owns all SVG DOM nodes in an isolated host; Angular owns surrounding UI/state but must **not** try to reconcile nodes owned by SVG.js. One adapter creates/updates the scene from a serializable document and emits typed interaction transactions. Do **not** use a mutable SVG.js DOM as source-of-truth.

```text
Angular Workspace UI (tools, object tree, Inspector, States)
     | commands + immutable SymbolDocument
     v
Editor Session / Command Stack (begin / preview / commit / rollback)
     | serialized data, stable node IDs
     v
VectorCanvasAdapter (SVG.js + select/resize/draggable plugins)
     | pointer events, keyboard focus, ephemeral control handles
     +---> normalized edit transactions ---> Document model
     |
     +---> SVG scene preview (isolated editor DOM)

Project Symbol Registry  --- references ---> SymbolDocument V2
                                             |
Telemetry TagValue + Quality --- resolver --> V2 appearance per node
                                             |
                                      existing runtime SVG renderer
```

The runtime and Editor operate on the same **validated declarative V2 model** but have different adapters. Runtime never imports SVG.js or editor dependencies. Telemetry changes must not mutate project JSON or generate Undo history. No inline JavaScript, event handlers, remote script or arbitrary CSS may enter an imported symbol. Rendering must not require localStorage, worker, network or any industrial gateway.

**One geometry engine, two views:** hit testing/control handles belong to the isolated authoring adapter, SVG appearance rendering belongs to the production runtime; both consume identical geometry/pivot/transform values. Test parity for each primitive and transform.

## Data contract: V2 with V1 read compatibility

`symbolDocument.version=2` is a **new contract**, not an in-place incompatible rewrite of `web-hmi-symbol` V1. Support:
- Stable ID and human name, viewBox/coordinate system; document-level units and connection-port definitions.
- Nodes: `group`, `line`, `rect`, `ellipse`, `circle`, `path` (allowlisted bounded SVG path grammar), `text`. Add polygon/polyline later by explicit schema change. Each node has typed geometry, style, transform, pivot and visibility. No raw embedded SVG/HTML accepted in project JSON.
- Parent/child hierarchy, unique IDs and path-independent references. Groups have transforms; a nested child can be edited via isolation mode.
- Reusable `states[]`: stable state IDs and labels, IEC double point default mapping 0=INTERMEDIATE, 1=OPEN, 2=CLOSED, 3=BAD_STATE; single-point 0=OPEN, 1=CLOSED. Other devices may define custom finite enums. State-value mapping belongs to an instance profile, not baked into every node.
- `overrides[stateId][nodeId]` for **fill, stroke, strokeWidth, opacity, visible, translation, rotation angle, scale, pivot and optionally text**. Styles absent from an override inherit from the base node. The system must support separate node values for each state.
- `transitions` specify allowed named property interpolation, easing and bounded duration, optional per node; warnings/quality fallbacks must not animate to an unverified OPEN/CLOSED visual.
- Connection ports are semantic independent anchor points in symbol coordinates and do not move unless explicitly defined, so switchgear one-line wires do not jump during blade animation.
- Structured `qualityVisuals` with visible BAD, STALE, UNCERTAIN and UNBOUND labels and indicators. No false GOOD state.
- Instance: symbol ID/version + per-instance tag binding, point mode and transform; do not duplicate base geometry across dozens of CBs.
- Portable standalone .json contains symbol schema and associated permitted resources; project export embeds referenced custom symbols. Missing versions and conflicting IDs are explicit recoverable validation errors, never silent substitution.

DYN-01 V1 import migration: deterministic adapter from V1 parts/movingPartId/pivot/state angles -> V2 node definitions and property overrides. Preserve V1 project import and exact visual behavior; do not migrate existing saved user projects eagerly or lose bindings. Regenerate / roundtrip test representative real V1 user exports.

## Command model and performance

Typed commands, e.g. `AddNodes`, `MoveNodes`, `ResizeNodes`, `EditLineEndpoint`, `RotateNodes`, `GroupNodes`, `UngroupNodes`, `SetPivot`, `SetStateOverride`, `ReorderNode`. Each drag is one Undo/Redo transaction: pointer down begins, pointer move previews ephemeral values, pointer up commits once, Esc cancels. Do not JSON.stringify/parse the full project on every pointermove, and do not poll on a per-part timer.

Idle document changes operate incrementally; node lookups and parent hierarchy are indexed by ID; cached hit testing / transforms only invalidate on geometry changes. Keep rendering independent from tag transport. Use RAF only for transient pointer previews; do not use a new background loop per animated object. CSS/SVG compositor handles transitions, respect prefers-reduced-motion. Establish Chromium perf budgets for 100 / 500 / 1000 nodes with tracked frame times and memory snapshots rather than guessing performance.

## Rollout / no-regression gates

1. Create a new `symbol-studio` domain behind a new route/workspace entry; do not rework main Editor and alarming/trending/PLC windows in the same PR.
2. Lock core schema, migration tests, command API and adapter boundaries **before** shipping UI.
3. Add editor adapter with pinned SVG.js plugins and a minimal orthogonal interaction harness; compare expected mouse/keyboard outcomes using Playwright.
4. Implement dedicated Symbol Studio UX; preserve old DYN-01 read/import until feature parity is proven.
5. Switch main editor canvas to shared interaction adapter only **after** equivalent controls have regression coverage.
6. Publish to GitHub Pages only from CI-green `main` via existing workflow; no special demo-only UI.

**Block merge** if: existing CP-01 through CP-15 tests regress, V1 imports break, SVG assets disappear, runtime output is confused with live equipment state, or the symbol editor cannot correctly commit and cancel multi-object transformations.

## Explicit non-goals

This refactor does not change Modbus polling, WebSocket, alarm ACK, trends/historian, PLC networking or industrial control. It will not add new public write-capable PLC commands.
