# Web HMI Studio — authoritative thread handoff

> **Read this file first when continuing this project in a new ChatGPT / coding thread.**
> Snapshot: **2026-10-13**, confirmed `main` commit **`fc2ee72bf52d8f69b8a7865a2abfdb5fc72f7611`**.
> This SHA is evidence of the snapshot, **not an instruction to reset or branch from an old SHA**.
> Before changing code, fetch the **current** GitHub `main`, current PRs/issues, and latest CI/Pages runs.
> Repo: https://github.com/masarray/web-hmi · Public UI: https://masarray.github.io/web-hmi/

## 1. The user's actual objective (do not lose it)

Build a **professional native-feeling industrial HMI engineering application**, with a practical self-service **Dynamic Symbol Studio** for substation engineers. An engineer must be able to draw original CB / disconnector / earthing switch / valve / motor graphics (not select from a few pre-coded templates), edit native vector primitives (lines, arbitrary endpoints, shapes, paths and groups), right-click, double-click into symbols/groups, use independent rotation **pivots**, place stationary electrical **ports**, and define **per-element/per-state** fill, stroke, visibility, rotation, translation, scale and animation.

Then: **Save → named project library → portable symbol JSON → import/reuse → drag/drop onto HMI → bind SP/DP tag → Preview/runtime with explicit quality handling**. Wiring between different equipment must attach to fixed terminals while moving/resizing symbols; it must **not** follow an animated breaker blade. UI should feel efficient, beautiful, ergonomic and familiar to engineers using actual graphical editor tools, not a naive stack of configuration fields.

Do **not** regress existing devices/tags, multi-PLC, Alarms, Trends/Historian, FUXA SVG library, or Pages publication. Do not replace the application with a separate web demo. Prefer engineered reusable models and one interaction engine over duplicated state or ad-hoc DOM mutations. Never claim professional editor parity until demonstrated with actual UI tests and user review.

## 2. Exact current release and CI (verified 2026-10-13)

| Resource | Current evidence |
| --- | --- |
| Verified `main` | `fc2ee72bf52d8f69b8a7865a2abfdb5fc72f7611` (PR #30) |
| Post-merge Editor CI | [run 38395415393](https://github.com/masarray/web-hmi/actions/runs/38395415393), **success, 56/56 Chromium tests** |
| Public GitHub Pages | [run 38395690440](https://github.com/masarray/web-hmi/actions/runs/38395690440), **success** for above `main` |
| Public URL | https://masarray.github.io/web-hmi/ |
| Product roadmap / acceptance | [Issue #19](https://github.com/masarray/web-hmi/issues/19) |
| Unresolved CI flake | [Issue #27](https://github.com/masarray/web-hmi/issues/27) |
| Historical editor design | [ADR-002](docs/architecture/ADR-002-professional-svg-editor.md), [UX/acceptance contract](docs/architecture/SYMBOL_STUDIO_V2.md) |

**GitHub Pages is the actual Angular frontend from the successful CI build artifact on `main`** — not a separate demo. It is a static deployment; PLC/Modbus, persistent server state, alarms/trends backed by the Node service require the actual backend and must not be described as live at the static Pages URL. Publication workflow: `.github/workflows/pages.yml` listens for successful `Editor CI` **push to `main`**, downloads that precise `web-hmi-editor` artifact, only adds the Pages HTML `<base>` path, and deploys.

### Significant completed, merged milestones (chronological)

| PR | Main commit | Verified capability |
| --- | --- | --- |
| [#21](https://github.com/masarray/web-hmi/pull/21) | `d1cf8ebd` | V2 typed vector scene graph / migration / immutable edit commands |
| [#22](https://github.com/masarray/web-hmi/pull/22) | `c4c03533` | Geometry: affine transforms, endpoints, resize/rotate, snapping, gesture math |
| [#23](https://github.com/masarray/web-hmi/pull/23) | `9da1a3f9` | Full-screen Symbol Studio alpha: line/rect/ellipse tools, layers, handles, separate editable states, Undo, import/export JSON |
| [#24](https://github.com/masarray/web-hmi/pull/24) | `cd45c7df` | Save V2 to project library, multiple tagged HMI instances, SP/DP state renderer, preview & quality, in-place edit, project portability |
| [#25](https://github.com/masarray/web-hmi/pull/25) | `d5019118` | Multi-select, group/ungroup, nested edit isolation, context menu, deep duplicate with Undo/Redo |
| [#26](https://github.com/masarray/web-hmi/pull/26) | `9558fbdf` | Visual stationary ports and per-node moving pivot, snap line endpoints, HMI port edit-mode overlay |
| [#29](https://github.com/masarray/web-hmi/pull/29) | `75e35c09` | Page-scoped attached wires between V2 instance ports; moves/resizes follow endpoints; Undo, JSON export/import, Preview |
| [#30](https://github.com/masarray/web-hmi/pull/30) | `fc2ee72b` | **Direct click-to-connect terminals on HMI canvas**, with source feedback and Cancel; previous dropdown workflow also works |

**Important branch trap:** [PR #28](https://github.com/masarray/web-hmi/pull/28) remains **OPEN DRAFT** based on old `9558fbdf` (as of snapshot). It implements an overlapping wire milestone that was already delivered via **#29 and #30**. **Do not merge #28, rebase it onto main, or copy it verbatim without an explicit diff and regression audit.** It is a historical parallel implementation, **not** the latest accepted base.

## 3. Code authority / entrypoints

| Concern | Actual source of truth |
| --- | --- |
| Whole project / active page / legacy shape / versioned JSON validation | `src/app/editor/document.ts` |
| Symbol Studio UI, canvas pointer/keyboard interaction, state Inspector | `src/app/editor/symbol-studio.component.{ts,html,css}` |
| Versioned declarative V2 symbol, nodes, states, import rules, quality/state resolver | `src/app/editor/symbol-studio-model.ts` |
| Geometry and transform matrices / resize / endpoints | `src/app/editor/symbol-studio-geometry.ts` |
| One-gesture command history, Undo/Redo, state overrides | `src/app/editor/symbol-studio-commands.ts` |
| Group hierarchy, duplicate / ungroup geometry preservation | `src/app/editor/symbol-studio-grouping.ts` |
| Port bounds, names, nearest-port snapping, pivot reanchoring | `src/app/editor/symbol-studio-anchors.ts` |
| Quality-aware rendering projection / nested SVG nodes | `src/app/editor/vector-runtime.ts` |
| **Wire topology**, references, validation, world endpoint geometry and orthogonal SVG routing | **`src/app/editor/port-wires.ts`** |
| HMI palette, tag binding, wire direct-click mode, Preview, page editor, history | `src/app/editor/editor.component.{ts,html,css}` |
| Legacy V1 dynamic symbols (must remain readable) | `src/app/editor/dynamic-symbol.ts` |
| Preview runtime quality, staleness, tag samples | `src/app/editor/visual-runtime.ts`; `src/shared/tag-protocol.ts` |
| Editor CI and Pages artifact chain | `.github/workflows/ci.yml`, `.github/workflows/pages.yml` |

### Data and interaction contracts (do not silently rewrite)

- Project continues to use **`Project.schemaVersion: 1`**. V2 symbols are **optional `project.vectorSymbols?: VectorSymbol[]`**; wires are **optional `page.wires?: PortWire[]`**. Both are validated on project import/export. **V2 symbol document** itself is separately **version 2**. Do not confuse the two versions or force-migrate legacy projects.
- Shape instances reference one `symbolId`, have their **own position/size, tagId and `pointMode`**; copies share the definition, not duplicated node trees. Library is **project-scoped** (not an account/global database). Save and project export must retain definitions and independent instance bindings.
- Single point default: `0=OPEN, 1=CLOSED`. IEC double point: `0=INTERMEDIATE, 1=OPEN, 2=CLOSED, 3=BAD_STATE`. A valid logical `BAD_STATE` value is distinct from telemetry `quality=BAD`. Bad/uncertain/stale/unbound quality cannot optimistically draw a verified close/open. Never fall back to “all nonzero = true” for V2.
- Ports belong to **definition-local `viewBox`**, independent of moving/rotating blades. V2 symbol validation caps port count at **24**. The main HMI wire model uses `PortRef={shapeId,portId}`, so it tracks **an instance and a named terminal**.
- `port-wires.ts` resolves port coordinates via current symbol instance `x,y,width,height` and **SVG `preserveAspectRatio="xMidYMid meet"`**, including edit-time placements. `routedPageWires` currently draws a deterministic **orthogonal midpoint** route; **no obstacle avoidance**. Current wire list validation caps at **500 per page**. Deleting a connected symbol cleans up its wire references; malformed/dangling imports must fail closed.
- Wiring UI: **“Wire terminals on canvas”** direct interaction, first click chooses source, second a different symbol's port creates the wire; cancel/exit supported. Legacy dual-selected-symbol “PORT WIRES” dropdown remains. No PLC write/control semantics attached to wires.
- All persistent edits use the editor's project `record(...)` history and Symbol Studio's command-history transactions. Pointer gestures commit once; telemetry must not mutate the document or spawn per-symbol polling/timers.
- Imported SVG/doc/path payload is allowlisted and bounded: **do not inject arbitrary HTML, SVG scripts, event handlers, CSS, or plugin code**. Check third-party license before using source/packages. FUXA assets retain attribution.

## 4. What is genuinely working vs what is still absent

**Working/merged:** dedicated Symbol Studio with line/rectangle/ellipse drawing; two line endpoint handles; resize/rotate; group isolation and context actions; per-part BASE + OPEN/CLOSED/INTERMEDIATE/BAD_STATE property overrides; custom pivot; fixed electrical terminals; Undo/Redo; standalone symbol JSON; project library and drag/drop; HMI SP/DP tag Preview with quality guards; **attached V2-to-V2 wires** in HMI, both selection/dropdown and direct terminal-click creation; Undo/Redo and portable wires.

**Not yet working / not done:** arbitrary editable Bézier/path node authoring, robust pan/zoom, clipboard and advanced native editor interaction parity; a vetted pinned SVG.js editor-only adapter; **obstacle-aware routing**, editable elbows/crossings, attachments from generic HMI line endpoints to symbol ports; general component connection semantics; user-designed transition duration/easing/keyframes and richer custom state transitions; shared cross-project symbol library; 100/500/1000-node performance targets and 1366×768 / 1920×1080 visual audit. Existing basic path **rendering/validation** is not the same thing as professional path **editing**. Do not call this application “finished”.

## 5. High-priority next work — use meaningful, separately tested milestones

1. **CI hardening, issue #27 (correctness gate).** The Save→Library E2E has flaked after previous merges. A rerun of a **fixed SHA** passed, but this is not proof of determinism. Capture catalog state, status, rendered sidebar, and Playwright trace/screenshots on failure. Fix lifecycle/state validation, not by adding arbitrary sleep or deleting assertions. Protect newly wired tests and original CP-01..CP-15.
2. **S3D: intelligent but safe HMI wiring editor.** Extend the **already merged** `port-wires.ts` + direct-click UI; offer selection/editable orthogonal bendpoints, near-port magnetic snapping, meaningful terminal labels, robust viewport-scale hitboxes, routes avoiding equipment boxes, crossovers and visual connection state. Start with wire geometry and topology unit tests; add E2E for moving/resizing only one endpoint, Undo/Redo, delete, JSON reload and Preview. Preserve existing wire references and distinguish auto-route preferences from manually pinned points. **Do not reinvent #29/#30**.
3. **Native-quality Symbol Studio interaction adapter** following ADR-002: consider vetted pinned **SVG.js** plus suitable MIT plugins, but confirm license/dependency/maturity against existing native SVG code. The document/command model remains authoritative; do not let plugins create an independent mutable project graph. Build real node/path editing, selection feedback, zoom/pan and context actions with browser tests. Do not import the same plugin into the runtime path.
4. **State animation designer:** user can choose a per-element fill/stroke/line rotation/translation/visibility animation and transition behavior, preview SP/DP values 0–3 and quality states without a PLC, save/export/import all settings. Quality transitions must fail closed; respect reduced motion; no cyclic polls.
5. **Shared symbol library / UX and performance acceptance:** versioning and import conflict policies across projects, keyboard/context-menu accessibility, screenshot audits, realistic 100/500/1000-node benchmarks.

Advance only with actual code + tests + green CI + deployed `main`. Prefer completing one end-to-end milestone over starting five unfinished features.

## 6. Efficient CI and merge procedure

- Start from **current `main`**, **not** from #28 or historical commit hashes. Check `/branches/main`, latest open PRs, Issues #19/#27 and `/actions/runs`; check `git diff`/PR diff before edits.
- Create a focused branch and draft PR. Keep changes local to necessary modules; preserve editor/state/PLC boundaries. Add **pure Node tests** under `tests/` and **real Chromium Playwright tests** under `e2e/` for user-visible gestures, quality, serialization and regression.
- Local checks: Node 24, `npm install --no-audit --no-fund`; `npm test`, `npm run typecheck`, `npm run check:modbus -- modbus-lab.example.json`, `npm run typecheck:server`, `npm run build`, `npm run test:e2e`. `npm run check` covers most frontend gates. CI runs all of these in `.github/workflows/ci.yml`; `test-results/` evidence is uploaded.
- Inspect **the precise PR head SHA** and PR CI result, then mark ready and **squash merge with `expected_head_sha`**. Never merge a red CI or a PR based on stale/unreviewed code. Rerunning an intermittent failure is diagnosis, not a durable fix.
- **Verify after merge**: `main` commit, **Editor CI for that exact SHA**, then **Publish original Web HMI UI** success for the same SHA. Only then direct user to https://masarray.github.io/web-hmi/. The static Page is not an alternative product. Share PR, exact CI run, Pages run, and realistic UI test steps.
- Keep [Issue #19](https://github.com/masarray/web-hmi/issues/19) current, explicitly separating **partially delivered** subfeatures from unchecked full milestone acceptance. Avoid stale “not implemented” statements in historical specs.
- **Never invent CI/artifact links**, test counts, merge results or deployment status. Verify them from GitHub.

## 7. Copyable kickoff for the next ChatGPT thread

> Continue development of `masarray/web-hmi` using the connected GitHub plugin. **Read root `AGENTS.md` and `HANDOFF.md` first**, then the latest `main`, Issues #19 and #27, PRs #29/#30 and any OPEN PRs. Treat `fc2ee72b` as a **2026-10-13 verified snapshot**, **not** necessarily the newest code. Preserve the real CI-green GitHub Pages Angular app, existing Symbol Studio project library, nested state engine, fixed ports and existing attached wire/direct-click implementation. **Never merge historical draft PR #28 without an overlap audit**. Deliver the next meaningful native-quality HMI-editor improvement with typed schema, focused tests and Chromium E2E; merge only green CI and verify Pages source commit. Clearly distinguish what is implemented vs not implemented; do not start from scratch or reimplement features already merged.

Last review updated: **2026-10-13**. This document is a snapshot; GitHub state wins when newer.
