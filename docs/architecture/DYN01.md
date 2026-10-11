# DYN-01 — Portable stateful electrical symbols

## Compatibility and scope
Base: CI-green CP-13 `main` e0140804d2be2000ee402e04314584b27d4af498.
Keep Editor, Devices & Tags, WebSocket, Modbus and Pages deployment unchanged. This feature is renderer-only; **no PLC writes**.

## Architecture
- `dynamic-symbol.ts`: pure, synchronous typed schema validator and state resolver. Device protocol never leaks into SVG renderer.
- `document.ts`: project v1 remains valid. Optional `customSymbols` contains the full definition so exported project can be imported elsewhere without assets. Shape instances keep only `symbolId`, `pointMode`, and `tagId`; there is no copied geometry per instance.
- `editor.component.ts`: one `computed` pass resolves visual states against existing shared per-source samples and freshness clock; no new poll loop, interval or per-CB timer.
- Inline SVG uses one moving line group with an anchored CSS rotation; static lines/ports do not rotate. Animation uses a short transform transition only for GOOD stable SP/DP states, honoring reduced-motion preference.
- Built-in `cb-rotating` is discoverable in Electrical symbols. User symbols are imported into/created inside the current project.
- `composeLineSymbol` captures selected line shapes; select the moving blade, pivot point and open angle. Static parts share local viewBox coordinates. Imported JSON has an allowlist of line primitives and hard limits, no SVG/HTML/script/URL execution.

## IEC double-point semantics
IEC 61850 Dbpos: 0 Intermediate; 1 OFF/Open; 2 ON/Closed; 3 Bad State.
Single point: 0 Open; 1 Closed. These mappings are declarative in the symbol, not hard-coded to every renderer.
Missing, BAD, STALE and UNCERTAIN quality override the displayed logical position to BAD_STATE and display an explicit warning. Other numeric values are BAD_STATE, not generic nonzero=true.
Only GOOD OPEN/CLOSED states animate; no dynamic sample is written to project JSON. A symbol with no tag is a design graphic, not telemetry.

## User workflow
1. Use the built-in CB Rotating via SVG library, choose Single/Double Point and bind a tag.
2. For a custom symbol, select 1–64 existing **line** objects, then **Create Dynamic Symbol from Lines** in multi-select Inspector. Choose a moving line, pivot XY (canvas coordinates), open angle; save.
3. Find new component under **MY DYNAMIC SYMBOLS**, drag/drop onto canvas, choose point encoding, bind tag.
4. Export an individual symbol JSON from its Inspector and import using **My Dynamic Symbols → Import JSON**. Export Project embeds all its custom symbols and all instances for transport.
5. For a new module or custom geometry not expressible with lines, add a new strictly validated primitive type in a later milestone; never allow arbitrary SVG markup or executable code.

## Acceptance, CI and UX gates
- Existing unit, typecheck, production build and Chromium E2E remain green; new tests cover SP/DP truth table, failures, JSON schema, v1 backward compatibility, and browser authoring.
- Main CI success is a hard gate before GitHub Pages sees the change; no deployment of unmerged PR.
- Browser profile must show compact controls only where relevant; do not clutter top toolbar.
- All 36 prior FUXA symbols, Part Rules, multi PLC mapping and WebSocket preview behavior must remain unchanged.

## Deferred improvements
- Dedicated rich pivot dragging / anchor handles in Symbol Builder and visual rotation preview.
- Alternate primitives (rect, ellipse, path) with safe bounded schema, and explicit port-connector snapping.
- Symbol package/catalog sharing across projects independent of an active project.
- No real mechanical actuation or remote control implied by visual state transitions.
