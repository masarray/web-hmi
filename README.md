# Web HMI Studio

Editor-first Angular-based engineering workspace for a future Web HMI/SCADA server. This is **not** yet a fully commissioned operational SCADA system.

> **New coding thread / contributor?** Start with **[HANDOFF.md](HANDOFF.md)** for the verified current baseline, merged PRs, source map, CI/Pages safeguards and next meaningful milestones. **[AGENTS.md](AGENTS.md)** gives the mandatory working rules. Don't start from a previous chat's stale branch or an overlapping draft PR.
>
> **Public UI:** https://masarray.github.io/web-hmi/ — publishes the **actual CI-green Angular app from `main`**, not a separate demo. Features that use Node/Modbus/WebSocket need a running backend; static GitHub Pages alone cannot connect to a PLC.

## Symbol Studio V2 and electrical connections

The app now includes a separate visual Symbol Studio with custom drawing and state-specific element properties; fixed port and rotation-pivot authoring; save/export/import into the project-scoped vector symbol library; drag/drop instances, tag binding and quality-aware Preview. HMI electrical wires connect **named terminals of specific V2 instances**, follow position/size changes, and can be created by clicking source and destination terminals in **Wire Terminals** mode. The earlier selection/dropdown Connect workflow remains available. **Obstacle-aware routing, advanced path-node editing, full transitions/easing design and shared cross-project symbol catalogs are not yet delivered.** See [handoff](HANDOFF.md) and [roadmap #19](https://github.com/masarray/web-hmi/issues/19).

## Quick start

Requires Node.js 24 and npm.

```sh
npm install
npm start
```

Open http://127.0.0.1:4200. Quality gates: `npm run check`.

## Editor-first milestone

SVG palette, select/drag, inspector, undo/redo, pages, snap grid, typed document model, validated JSON import/export, local browser save, strict typechecking and CI static build artifact.

*Historical note:* this paragraph documents the initial editor-only scope. **Read-only Modbus, multi-PLC, live tag transport, Alarms and Trends/Historian were subsequently added** as CP milestones described below. Industrial write controls, authentication/shared-project infrastructure and commissioned production SCADA guarantees are still out of scope.

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


## Read-only Modbus lab mapping (CP-09)

The Node tag server now supports read-only Modbus **FC01/FC02/FC03/FC04**
with bool, signed 16-bit, signed/unsigned 32-bit and float32 mappings,
including configurable 32-bit word order. See
[docs/architecture/CP09.md](docs/architecture/CP09.md) and
[config/modbus-lab.example.json](config/modbus-lab.example.json).

To validate your mapping **without opening a Modbus connection**, run
\`npm run check:modbus -- modbus-lab.example.json\`. The default demo
server and all existing graphical editor workflows remain unchanged.


## Smart industrial Modbus tag mapping (CP-10)

In Web HMI Studio, choose **Devices & Tags** to configure device IP,
FC01/02/03/04, data type and registers without editing JSON. Bind
graphical objects to named tags from their Inspector. Export the
validated mapping to the server's \`config/\` directory and start
\`HMI_SOURCE=modbus-tcp HMI_MODBUS_CONFIG_FILE=plant-a.json npm run start:server\`
to read the explicitly configured industrial endpoint. No device writes
are enabled. See [CP-10 engineering guide](docs/architecture/CP10.md).


## Direct device configuration apply (CP-11)

Run the Node server with \`HMI_ADMIN_TOKEN\` set to a random value of at
least 32 characters. In **Devices & Tags**, enter that administrator
token, select **Check server**, then **Apply to server** to verify and
activate the selected read-only Modbus mapping without manual JSON copying
or server restart. Configuration is saved atomically for recovery; an
unresponsive candidate does not displace a healthy active source.
See [CP-11 architecture](docs/architecture/CP11.md).

## Check PLC connection & see live health (CP-12)

From **Devices & Tags**, use **Test PLC** for a read-only connection check before
applying anything. With a server key, **Check server** displays live connection
status and concise read counters. See [CP-12](docs/architecture/CP12.md).

## Multiple PLCs in one HMI (CP-13)

Open **Devices & Tags → Multiple PLCs**. Add your PLCs, edit tags, and
apply them as a group. One server poller per PLC serves every browser over
the existing WebSocket. See [CP-13 engineering guide](docs/architecture/CP13.md).

## Alarms & events (CP-14)

Open **Alarms** for live conditions, acknowledge, and recent events. Engineers
can add threshold rules under the collapsible settings area. Server-side
processing follows tag quality and preserves alarms during connection loss.
See [CP-14](docs/architecture/CP14.md).

## Trends & Historian (CP-15)

Use **Trends** to select PLC tags to record and view 15-minute to 24-hour
SVG history. The Node server records configured tags independently of browser
sessions. [CP-15 architecture and limits](docs/architecture/CP15.md).
