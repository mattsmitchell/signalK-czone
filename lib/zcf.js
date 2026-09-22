'use strict'

const fs = require('fs')
const path = require('path')

// The supplied ZCFs use a binary circuit-record table. A circuit record has:
//   byte 0       channel
//   byte 1       CZone module
//   bytes 2..15  circuit configuration fields
//   byte 16      ASCII name length
//   bytes 17..   ASCII circuit name
// Within the fixed fields, bytes 6..7 are 0xE8 0x03 for the circuit records
// used by the DC/AC current mapping in this project.
//
// This is deliberately a structural parser, not a search for printable text
// followed by a nearby byte pattern. It therefore keeps records with channel
// 32 and does not collapse different configured circuits merely because their
// names happen to be repeated elsewhere in the file.

const CURRENT_PGN_DC = 130822
const CURRENT_PGN_AC = 130817

function isModule(value) {
  return (value >= 0x10 && value <= 0x40) || value === 0xF8
}

function isAsciiName(buf, offset, length) {
  if (length < 1 || length > 120 || offset + length > buf.length) return false
  for (let i = offset; i < offset + length; i++) {
    if (buf[i] < 0x20 || buf[i] > 0x7e) return false
  }
  return true
}

function parseCircuitRecords(buf) {
  const records = []

  for (let p = 0; p + 17 <= buf.length; p++) {
    const channel = buf[p]
    const module = buf[p + 1]

    if (channel > 32 || !isModule(module)) continue
    if (buf[p + 6] !== 0xE8 || buf[p + 7] !== 0x03) continue

    const nameLength = buf[p + 16]
    const nameOffset = p + 17
    if (!isAsciiName(buf, nameOffset, nameLength)) continue

    const name = buf.subarray(nameOffset, nameOffset + nameLength).toString('ascii')
    records.push({
      name,
      module,
      channel,
      page: Math.floor(channel / 8),
      slot: channel % 8,
      offset: p
    })

    // The next record begins immediately after this name in the circuit table.
    // Advancing here avoids finding embedded byte patterns inside the name.
    p = nameOffset + nameLength - 1
  }

  return records
}

function classifyCurrentMapping(circuit) {
  if (circuit.module === 0xF8) {
    return { pgn: CURRENT_PGN_AC, scale_A_per_bit: 0.2 }
  }

  // Module 0x28 is the inverter/charger group. Its telemetry is not the
  // CZone circuit-current PGN decoded here, so leave those circuits unmapped.
  if (circuit.module === 0x28) return null

  return { pgn: CURRENT_PGN_DC, scale_A_per_bit: 0.1 }
}

function load(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('No ZCF file path configured')
  }

  const resolved = path.resolve(filePath)
  let buf
  try {
    buf = fs.readFileSync(resolved)
  } catch (err) {
    throw new Error(`Unable to read ZCF: ${err.message}`)
  }

  if (buf.length < 32) throw new Error('ZCF file is too small')

  const circuits = parseCircuitRecords(buf)
  if (circuits.length === 0) {
    throw new Error('No CZone circuit records found in ZCF')
  }

  const currentMappings = circuits
    .map(circuit => {
      const current = classifyCurrentMapping(circuit)
      if (!current) return null
      return { ...circuit, ...current }
    })
    .filter(Boolean)

  const warnings = []
  const duplicateNames = new Set()
  const names = new Set()
  for (const circuit of circuits) {
    if (names.has(circuit.name)) duplicateNames.add(circuit.name)
    names.add(circuit.name)
  }
  if (duplicateNames.size) {
    warnings.push(`Duplicate circuit names: ${Array.from(duplicateNames).join(', ')}`)
  }

  return {
    fileName: path.basename(resolved),
    filePath: resolved,
    fileSize: buf.length,
    circuits,
    currentMappings,
    warnings
  }
}

function lookup(mapping, module, page, slot, pgn) {
  if (!mapping) return null
  return mapping.currentMappings.find(x =>
    x.module === module &&
    x.page === page &&
    x.slot === slot &&
    (pgn === undefined || x.pgn === pgn)
  ) || null
}

module.exports = {
  CURRENT_PGN_DC,
  CURRENT_PGN_AC,
  parseCircuitRecords,
  classifyCurrentMapping,
  load,
  lookup
}
