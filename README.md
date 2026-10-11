# Web HMI Studio

Editor-first Angular-based engineering workspace for a future Web HMI/SCADA server. This is **not** yet an operational SCADA system.

## Quick start

Requires Node.js 24 and npm.

```sh
npm install
npm start
```

Open http://127.0.0.1:4200. Quality gates: `npm run check`.

## Editor-first milestone

SVG palette, select/drag, inspector, undo/redo, pages, snap grid, typed document model, validated JSON import/export, local browser save, strict typechecking and CI static build artifact.

**Excluded until later milestones:** PLC/IED drivers, server database, shared projects, authentication, operational tags, alarms and industrial controls. Tag binding text is metadata only.

## FUXA reference

Functionality and workflow were researched using [frangoteam/FUXA](https://github.com/frangoteam/FUXA) (MIT). The initial implementation is independently authored; no upstream source or SVG assets were copied. See [audit](docs/architecture/FUXA_REFERENCE.md) for detailed source/architecture analysis. Preserve upstream copyright/attribution if code/assets are incorporated in later changes.

## Industrial Vector Symbol Library (CP-04)
The editor includes 36 locally served SVG graphics from FUXA, grouped in six
categories. Search, filter, click-to-add, drag-to-canvas, resize and duplicate
work within the existing versioned project format. For a selected SVG symbol,
choose a CSS-only Rotate/Pulse visual animation from the inspector, then use
Preview to see it. Preview is simulated: **no live device data** is connected.

Original SVG files and required attribution are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and
[`third_party/FUXA-LICENSE.txt`](third_party/FUXA-LICENSE.txt).
FUXA source code or editor JavaScript has not been copied. A larger
SVG library, authored state-driven animation and equipment-specific
HMI templates are subsequent milestones.
