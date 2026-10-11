# FUXA editor reference audit — 2026-10-11

Reference: https://github.com/frangoteam/FUXA at commit a7705f084c1439edf1b27c1f69c737b8d6de0e00.

- License: MIT (copyright 2019–2025 frangoteam).
- Frontend at `client/` uses Angular 18.2.14 and Angular Material.
- `client/src/app/editor/editor.component.html` organizes views, SVG tools, controls, selectors and property inspectors.
- `editor.component.ts` initializes `mysvgeditor`, `mysvgcanvas`, `myselect`, `mydraw` and jQuery globals. These are coupled to other project/gauge/widget services.
- Copying only editor component will not produce a working application.

Decision: keep Angular and FUXA's tested workflow concepts; implement first executable editor with Angular 22 standalone, signals and typed, pure document operations instead of copying legacy globals. Do not parse arbitrary SVG/HTML or execute imported scripts. Version project documents; future FUXA compatibility is a separate, explicitly tested adapter, not assumed.

Checkpoint acceptance: Angular AOT build; document tests; select/drag; inspector; add/remove; undo/redo; add page; import/export; refresh persistence. No claim of protocol connectivity.
