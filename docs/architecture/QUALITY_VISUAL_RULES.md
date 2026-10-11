# CP-06 — Quality-aware SVG state preview

Baseline: CP-05 commit 26fa23fcbcccf83d8737bc1774d0ba6aa1575abc.
FUXA referenced for tag mapping and SVG animation workflow, not copied runtime JS.

Scope: typed per-symbol tag binding, boolean and numeric activation rules,
explicit GOOD/UNCERTAIN/BAD/STALE quality and sequence-monotonic update handling.
The preview's simulated source never enters persisted project JSON or Undo history.
Missing/unhealthy sample always stops optimistic animation and displays a warning.
Healthy values activate eligible rotor only; idle is neutral and unbound designs
retain the prior CP-05 animation preview behavior.

Editor interface: tag ID, activation rule, threshold and animation controls.
Preview: prominent SIMULATION ONLY banner, tag selection, ON/OFF buttons,
numeric input and quality selector. No live industrial connectivity or writes.

CI: Node test suite validates state quality, ordering, schema compatibility;
browser tests verify animation stops and resumes, threshold and isolation.
Informational CPU-only baseline for 100/500/1000 objects is printed by tests;
NOT a comparable FUXA benchmark and NOT a browser paint metric.

Next steps: extend tagged visual state to individual named path/ellipse parts,
bind to a server-owned runtime and add browser paint/memory benchmarks, while
preserving fail-safe quality and authorization boundaries.
