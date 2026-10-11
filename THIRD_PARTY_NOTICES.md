# Third-party notices — FUXA graphics

Source: https://github.com/frangoteam/FUXA
Pinned upstream commit: `a7705f084c1439edf1b27c1f69c737b8d6de0e00`
Upstream asset directory: `client/src/assets/lib/svgeditor/shapes/img/`
Local copies: `src/assets/fuxa/`
Inventory (36 SVGs): `src/app/editor/symbols.ts`

FUXA repository MIT license and author copyright are preserved verbatim in
`third_party/FUXA-LICENSE.txt`. Attribution also remains required when redistributing modified graphics.

The selected assets passed a limited static screening for script tags, inline
event handlers, JavaScript URIs, DOCTYPE, foreignObject, iframe and href
attributes. SVG file-level origins may still require further diligence; this
does not establish that every asset elsewhere in FUXA has the same rights.

These are upstream FUXA graphics, **not original Web HMI artwork**. Our
Angular editor, typed catalog, rendering bindings and CSS animation are
independently written. No FUXA legacy JavaScript, jQuery plugins or logo are
bundled.

Only known, same-origin, registry-resolved SVG paths are accepted by project
documents; no arbitrary SVG markup or remote image URL. Animation is a
visual preview only, never a representation of live equipment state.

## CP-05 process geometry provenance

Six inline SVG process graphics are transcribed from FUXA's
`client/src/assets/lib/svgeditor/shapes/proc-shapes.js`, pinned to the
same upstream revision. The original geometry is MIT-licensed and credited.
Web HMI adds its own typed geometry registry and rotor animation annotations.
Source: `src/app/editor/process-graphics.ts`.
