# Coding agent / new-thread instructions — Web HMI Studio

**Mandatory first read:** [HANDOFF.md](HANDOFF.md). This file contains the verified baseline, actual merged features, source-file map, user acceptance goals, CI/Pages pipeline, unresolved risks, and next work. It is updated as a snapshot, not a replacement for inspecting current code.

## First actions on every thread
1. Read `HANDOFF.md`, [Issue #19](https://github.com/masarray/web-hmi/issues/19) and [Issue #27](https://github.com/masarray/web-hmi/issues/27).
2. Fetch the **latest** `main` commit, open PRs and CI runs from GitHub; do **not** assume a previous chat's commit or branch is still current.
3. Read affected files and existing tests **before** writing code; compare new work with merged PRs #29/#30. **Draft PR #28 is older overlapping wiring work, not the development base**.
4. Deliver **one meaningful vertical slice** with pure model tests and a Chromium E2E that exercises actual mouse/keyboard workflows.
5. Build and test via Node 24 / `.github/workflows/ci.yml`. Squash merge only verified green PR head and verify post-merge `main` CI and `.github/workflows/pages.yml` success for that exact commit.

## Engineering guardrails
- Industrial UI must feel like an effective native graphical editor; avoid naive disconnected controls or introducing a second scene graph.
- The canonical project model and import contract are in `src/app/editor/document.ts`; reusable Symbol Studio V2 model in `symbol-studio-model.ts`; HMI wire topology/routing in `port-wires.ts`.
- Do not replace the **actual** production Angular GitHub Pages application with a demo or regress V1 imports/FUXA assets/multi-PLC/Alarms/Trends. Static Pages cannot provide the Node/PLC backend.
- Keep SP/DP (IEC double-point 0/1/2/3) and telemetry quality **semantically distinct**. A stale/bad/unbound value must never be drawn optimistically as a confirmed safe breaker position.
- Ports are **fixed symbol-local electrical connection points**. Blade pivot is **node-local and movable**. Attached HMI wires refer to specific `{shapeId,portId}` pairs. Existing direct-click Wire Terminals interaction is already merged.
- All persistent editing uses the typed document and command history, not arbitrary SVG DOM as persistent truth; avoid polling/timers per symbol and Modbus/PLC writes.
- Security: validate imported JSON and SVG path grammar, preserve license notices when adopting third-party libraries, and fail closed for unknown references.
- **Known CI flake:** Save→Library rendering (#27). Do not mask it with fixed sleeps, retries presented as a permanent fix, or deleted tests.
- Clarify in each result: what's truly merged, what was only tested in a PR, what Pages currently shows, and what remains undone.

Use [ADR-002](docs/architecture/ADR-002-professional-svg-editor.md) and [Symbol Studio V2 acceptance](docs/architecture/SYMBOL_STUDIO_V2.md) for desired *future* editor quality. Their historical design examples are not authoritative declarations of current implementation status; see HANDOFF.md and code instead.
