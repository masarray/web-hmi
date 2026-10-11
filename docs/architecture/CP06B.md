# CP-06B — Event-driven staleness and declarative SVG component rules

Reference: FUXA SVG and tag configuration workflow. No legacy editor JavaScript runs.

## Clock and lifecycle
Every simulated sample is stamped with local receive time, not the device clock.
One shared next-deadline timeout is scheduled for the earliest non-expired sample
while Preview is open. There is no per-symbol polling timer or periodic re-render.
On expiry, the computed visual state becomes STALE, animations stop, and the
warning indicator remains visible. Preview exit/destroy cancels the timer.

## Per-component behavior
For inline process SVGs, each component index can optionally override its
default behavior with: fixed stroke, status-dependent color, hide except for
GOOD+active, or rotate while active with Rotate selected. Rules are data,
not expressions/scripts. Out-of-range indices, unknown effects and duplicates
are rejected on import. Existing JSON v1 projects without overrides retain
CP-06A behavior and identity, edit/undo/export all work.

## Performance evidence
Pure benchmarks are informational and not a substitute for browser measurements.
Chromium regression loads 100, 500, and 1000 motor process symbols and logs
DOM initialization time and node count. Machine- and run-dependent values
are not claimed as competitive performance versus FUXA.

## Security and scope
SIMULATION ONLY remains explicit; no PLC/IED connection or industrial writes.
Static allowlisted SVG paths, no script execution or unsafe dynamic markup.
Further work: real source subscriptions, quality provenance and stale policies
per protocol; in-browser frame-time profiling using comparable FUXA documents.
