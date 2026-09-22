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
npm install /path/to/signalk-czone-0.3.0-beta.3.tar.gz --omit=dev
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


## 0.3.0-beta.4

This beta adds plugin diagnostics/status reporting on top of the stable circuit-name Signal K paths.

The plugin status reports:

- running state and uptime
- active ZCF filename/path/size
- total circuits and current mappings
- mapping counts by PGN
- raw-frame, decoded-packet, DC/AC packet, published-value, parse-error and decode-error counters
- unmapped DC and AC counts
- invalid CZone packet count
- Fast Packet reassembly state
- last DC packet, last AC packet, and last published value
- last value seen for each published Signal K circuit
- ZCF parser warnings

The beta is intended for extended real-world testing before a stable 0.3.0 release.
