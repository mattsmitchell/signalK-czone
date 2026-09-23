# signalk-czone 

Standalone Signal K CZone NMEA2000 current decoder with a dedicated ZCF upload configuration panel.

## Design

The plugin does **not** modify Signal K Server, canboatjs, n2k-signalk, or any global PGN definitions.

It listens to the raw `canboatjs:rawoutput` event, extracts the NMEA2000 CAN ID, reassembles Fast Packets, validates the CZone `27 99` payload, then decodes PGNs 130822 (DC/COI) and 130817 (AC/ACOI) and applies the existing ZCF mapping.

The existing `lib/zcf.js` is intentionally not included here: keep the working ZCF parser from the current plugin installation unchanged.

## ZCF upload

Version 0.2.2 replaces the unreliable generic RJSF `data-url` file field with a dedicated Signal K plugin configuration panel. The panel uses a real browser file input and uploads the selected `.zcf` file to the plugin's admin-only route:

`POST /plugins/signalk-czone/zcf/upload`

The plugin:

1. receives the multipart file directly;
2. requires a `.zcf` filename;
3. validates the temporary file using the existing `lib/zcf.js` parser;
4. atomically installs it in the plugin data directory;
5. updates the plugin configuration's `zcfPath` and restarts the plugin.

Only the installed path is stored in plugin configuration; the binary file is not placed in the JSON configuration.

Signal K plugin routes registered directly with `registerWithRouter()` are admin-only by default, which is appropriate for changing the vessel's CZone configuration.

## AC 130817

Observed CZone format:

- payload: 28 bytes
- bytes 0-1: `27 99`
- byte 2: page
- byte 3: CZone module
- bytes 4-27: 8 × 3-byte slots
- for the validated Water Heater Port mapping (`F8 / page 0 / slot 0`), the first byte of the slot is current in 0.2 A/count: `0x28` = 40 = 8.0 A

The other two bytes of each AC slot are deliberately left opaque until validated.

## DC 130822

The existing validated decoder is retained: low 10 bits of each 3-byte slot × 0.1 A.

## Installation

This release is self-contained. It includes `index.js`, `package.json`, `README.md`, `LICENSE`, `lib/nmea2000.js`, the ZCF parser in `lib/zcf.js`, and the configuration panel in `public/`.

For a manual install, extract the archive directly into `/root/.signalk/node_modules/signalk-czone` (the archive has files at its root), then restart Signal K.

For an npm-style install from the tarball, use:

```bash
cd /root/.signalk/node_modules
npm install /path/to/signalk-czone-0.3.0-beta.6.tar.gz --omit=dev
```

The package has no runtime npm dependencies. Do not modify Signal K Server or canboatjs.

Then restart Signal K.

After restart, open Server -> Plugin Config -> CZone. The custom configuration panel should show **Upload and install ZCF**.

For diagnostics:

```bash
journalctl -u signalk --since "2 minutes ago" --no-pager | grep CZONE
```

Set `debugRaw` true temporarily if completed 28-byte packets need to be inspected.

## 0.2.4 startup fix

0.2.4 restores the ZCF loading function used during plugin startup. The configured ZCF is loaded and validated before the plugin registers its raw NMEA2000 listener. A missing or invalid configured ZCF prevents startup with a clear error instead of a JavaScript `load is not defined` error.


## 0.2.5 configuration persistence fix

After a successful ZCF upload, 0.2.5 explicitly persists the new `zcfPath` before restarting the plugin. The configuration panel also updates its displayed installed path immediately and uses that path for subsequent configuration saves, so the UI and the plugin startup configuration stay aligned.


## 0.3.0-beta.6

This beta keeps the stable circuit-name Signal K paths and diagnostics/status reporting, and adds explicit AC/DC classification metadata for downstream consumers such as InfluxDB.

### Diagnostics and status

The plugin configuration panel includes a **Diagnostics** tab alongside **Configuration**. The diagnostics view polls the plugin status periodically and is intended to make field testing and troubleshooting possible without inspecting the source code.

The status reports:

- running state and uptime
- active ZCF filename, path, and size
- total circuits and current mappings
- current-mapping counts by PGN
- raw NMEA2000 frame count
- completed CZone Fast Packet count
- DC and AC packet counts
- published-value count
- raw-frame parse errors
- invalid CZone packet count
- startup/decode errors
- unmapped DC and AC circuit counts
- Fast Packets currently in progress
- last DC packet, last AC packet, and last published value
- ZCF parser warnings
- per-circuit last observed value and update time
- per-circuit diagnostic mapping information including module, page, slot, source address, and PGN

The plugin also exposes a diagnostics route at:

```text
/diagnostics
```

Use the **Diagnostics** tab in the Signal K plugin configuration panel for normal access.

### Stable circuit naming

Published current paths use the ZCF circuit name rather than the CZone module/channel or page/slot:

```text
electrical.czone.<circuit>.current
```

For example:

```text
electrical.czone.100L_Fridge.current
electrical.czone.200L_Fridge.current
electrical.czone.AIS.current
electrical.czone.Water_Heater_Port.current
electrical.czone.Starlink.current
```

The circuit name is the stable public Signal K identity. Module, channel, page, and slot are retained as diagnostic mapping information and must not be treated as the public circuit identity.

Circuit names are sanitized for Signal K paths by trimming whitespace and replacing runs of spaces/punctuation with `_`, with leading/trailing `_` removed.

### AC/DC classification

The public current paths remain stable and unchanged:

```text
electrical.czone.<circuit>.current
```

Each published value is additionally classified as AC or DC through Signal K source/path metadata.

The source identity is:

```text
CZone-AC
CZone-DC
```

This allows `signalk-to-influxdb2` to expose the distinction through its InfluxDB `source` tag without adding `AC` or `DC` to the circuit path.

For the supplied ZCF:

- PGN `130822` is the DC/COI current decoder and uses 0.1 A/count.
- PGN `130817` is the AC/ACOI current decoder and uses 0.2 A/count for the validated AC current field.
- Module `0xF8` is classified as the validated AC mapping used by the supplied ZCF.
- Module `0x28` records are excluded from the CZone circuit-current mapping.

The AC slot's remaining two bytes are intentionally left opaque until additional fields are validated.

### InfluxDB verification

A quick check of the classification metadata can be performed with:

```bash
influx query '
from(bucket: "DataBucket")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement == "electrical.czone.Water_Heater_Port.current")
  |> limit(n: 10)
'   --host http://127.0.0.1:8086   --org SugarShack   --token "$INFLUX_TOKEN"
```

The Water Heater Port circuit should carry:

```text
source = CZone-AC
```

A DC circuit such as Starlink should carry:

```text
source = CZone-DC
```

A combined check can group the CZone current series by classification:

```bash
influx query '
from(bucket: "DataBucket")
  |> range(start: -15m)
  |> filter(fn: (r) => r._measurement =~ /^electrical\.czone\./)
  |> keep(columns: ["_measurement", "_time", "_value", "source"])
  |> group(columns: ["source"])
'   --host http://127.0.0.1:8086   --org SugarShack   --token "$INFLUX_TOKEN"
```

For the supplied ZCF, the current mappings are 83 DC mappings and 8 AC mappings. This count describes the supplied ZCF only; it is not a protocol requirement.

### Raw NMEA2000 transport

The decoder is intentionally transport-independent after the raw CAN frame is obtained.

The current Signal K integration listens to:

```text
canboatjs:rawoutput
```

The decoder accepts both raw-input representations currently encountered in the field:

1. **YDWG02 text lines**, for example:

```text
23:31:37.646 R 1DFF010B C0 1C 27 99 00 F8 00 00
```

2. **JSON/object NMEA2000 frames**, as used by some Signal K/NMEA2000 providers such as a Victron Cerbo GX environment, for example:

```json
{"pgn":{"canId":435815455,"prio":6,"src":31,"pgn":129540,"dst":255},"length":8,"data":["8e","00","f2","13","43","2a","c7","9c"]}
```

For the JSON representation, the parser normalizes `pgn.canId`, `pgn.src`, `pgn.pgn`, `length`, and the hexadecimal `data` array into the same internal CAN-frame structure used by the text-line decoder. A JSON string and an already-parsed JavaScript object are both accepted.

CZone PGNs `130817` and `130822` are then reassembled as Fast Packets before CZone payload validation and ZCF lookup. The plugin does not depend on a particular NMEA2000 source address.

The decoder does not hard-code a CZone source address. The source address is part of the Fast Packet stream key because the same PGN can appear from different source addresses.

The plugin does not patch Signal K Server, canboatjs, n2k-signalk, or global PGN definitions.

### ZCF upload and persistence

The custom configuration panel uploads a `.zcf` file through:

```text
POST /plugins/signalk-czone/zcf/upload
```

After validation, the plugin installs the file in its plugin data directory, persists the active `zcfPath`, and restarts using the new configuration.

Only the installed path is stored in plugin configuration; the binary ZCF is not stored in JSON.

### Version history

- **0.2.2** — replaced the unreliable generic RJSF `data-url` upload with a dedicated configuration-panel uploader.
- **0.2.4** — restored the ZCF startup loading function and made invalid/missing ZCF configuration fail clearly.
- **0.2.5** — fixed ZCF path persistence and configuration-panel path handling.
- **0.3.0-beta.1** — first self-contained beta with the working ZCF parser, raw NMEA2000/CZone decoder, configuration panel, and validated ZCF upload/persistence.
- **0.3.0-beta.2** — changed public Signal K current paths to stable ZCF circuit names.
- **0.3.0-beta.3** — added backend diagnostics/status reporting.
- **0.3.0-beta.4** — added the Diagnostics tab/page to the configuration UI.
- **0.3.0-beta.5** — added explicit AC/DC source classification for downstream telemetry storage while retaining stable circuit-name paths and the diagnostics/status tooling.
- **0.3.0-beta.6** — accepts both traditional YDWG02 text frames and JSON/object NMEA2000 frames, including the representation used by Victron Cerbo GX environments.

The beta is intended for extended real-world testing before a stable `0.3.0` release.
