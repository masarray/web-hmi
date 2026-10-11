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
