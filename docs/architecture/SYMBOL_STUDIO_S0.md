# V2-S0 delivery: immutable scene graph and state engine

Status: implementation branch; not exposed in user interface until V2-S1/S2.

## New domain code

- `symbol-studio-model.ts`: version 2 serializable vector scene graph; nested groups, lines with independent endpoints, rectangle/ellipse/path/text nodes, base style/transform/pivot, semantic ports, per-node per-state property overrides.
- `symbol-studio-commands.ts`: typed insert/replace/remove/state-override/reset commands; single-commit undo/redo per gesture, preview from initial pointerdown model and safe cancellation.
- `importSymbolDefinition`: parses V2 or upgrades DYN-01 V1 definitions into V2 without touching persisted V1 project data.
- `resolveVectorFrame`: deterministic immutable state appearance from SP/DP values, shared existing sample quality/freshness; BAD/STALE/UNCERTAIN fail to BAD_STATE and never infer healthy Closed.

## Constraints and design decisions

Model is isolated from Angular and WebSocket; no new dependencies, intervals, render loop or backend writes. Input JSON is canonicalized, bounded in size, with node/count/hierarchy and property validation. Executable SVG and arbitrary URLs cannot be imported as node geometry. Ancestor groups own transforms; renderer adapters will compose them at draw time.

The existing DYN-01 user workflow is deliberately intact. The new Symbol Studio UI does not appear yet: visually manipulating endpoints, edges, pivots, groups, context menus and state controls is V2-S1/S2/S3 work.

S0 acceptance: all current tests + V2 model/commands unit tests green on merged baseline. V2-S1 must consume these contracts and demonstrate actual native canvas interaction before claim of working editor. Full V2 completion criteria are in Issue #19.
