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
