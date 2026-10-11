# CP-05 — Real process SVG geometry

Source: frangoteam/FUXA commit a7705f084c1439edf1b27c1f69c737b8d6de0e00,
file client/src/assets/lib/svgeditor/shapes/proc-shapes.js (MIT).
License and attribution: third_party/FUXA-LICENSE.txt and THIRD_PARTY_NOTICES.md.

## Why this differs from the CP-04 thumbnails

CP-04 rendered FUXA 24x24 icon SVGs as larger images. CP-05 transcribes
curated actual SVG path/ellipse geometry from FUXA process shape library
into a typed, static TypeScript catalog. The editor uses SVG elements directly,
preserving crisp scaling and allowing per-instance stroke styling.

Coverage: gear pump (4 elements, 2 annotated rotors), motor (2 elements,
1 annotated rotor), jet pump (2), valve C (1), tube exchanger (1),
vacuum pump (2). Remaining graphics use existing SVG assets.

No upstream editor JavaScript is run. Original SVG paths are preserved.
Animation role annotations are new Web HMI metadata for selected components.
Projects save only an allowlisted symbol ID, stroke color and optional
preview-animation mode, preserving the previous document schema.

## Acceptance and boundaries

- Unit: geometry and IDs are allowlisted, project save/load and security.
- Chromium: insert, recolor, select/drag graphic, verify rotor-only motion,
  static housing, Preview only, and project persistence.
- Reduced-motion preference disables CSS animation.
- No real PLC/IED state or control implied. No benchmark or full FUXA parity.
