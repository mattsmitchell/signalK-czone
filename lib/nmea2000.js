'use strict'

// Small, transport-independent NMEA 2000 helper layer.
// The plugin receives raw YDWG02 lines from canboatjs, but the actual
// CZone decoder only sees normalized CAN frames and completed Fast Packets.

const CZONE_PGNS = new Set([130817, 130822])
const CZONE_SIGNATURE = [0x27, 0x99]
const MAX_FAST_PACKET_SIZE = 223

function parseRawLine (line) {
  if (typeof line !== 'string') return null

  const parts = line.trim().split(/\s+/)
  if (parts.length < 4) return null

  // YDWG02: timestamp direction CAN-ID 8 data-bytes
  const direction = parts[1]
  const canIdText = parts[2]
  if (!canIdText || !/^[0-9a-fA-F]{8}$/.test(canIdText)) return null

  if (direction && direction !== 'R') return null

  const data = parts.slice(3).map(x => Number.parseInt(x, 16))
  if (data.length < 1 || data.length > 8 || data.some(x => !Number.isInteger(x) || x < 0 || x > 255)) {
    return null
  }

  const canId = Number.parseInt(canIdText, 16) >>> 0
  const pgn = getPgnFromCanId(canId)

  return {
    timestamp: parts[0],
    direction,
    canId,
    source: canId & 0xff,
    pgn,
    data: Buffer.from(data)
  }
}

function getPgnFromCanId (canId) {
  const pf = (canId >>> 16) & 0xff
  const ps = (canId >>> 8) & 0xff

  // These CZone PGNs are PDU2 (PF >= 240), so PS is part of the PGN.
  if (pf >= 240) {
    return (canId >>> 8) & 0x3ffff
  }

  // General PDU1 form, included so the helper remains reusable.
  return pf << 8
}

function isCzonePgn (pgn) {
  return CZONE_PGNS.has(pgn)
}

function createFastPacketReassembler (onPacket, options = {}) {
  const packets = new Map()
  const timeoutMs = options.timeoutMs || 2000

  function expire () {
    const now = Date.now()
    for (const [key, packet] of packets) {
      if (now - packet.updatedAt > timeoutMs) packets.delete(key)
    }
  }

  function accept (frame) {
    if (!frame || !isCzonePgn(frame.pgn) || !frame.data || frame.data.length < 2) return

    const control = frame.data[0]
    const packetId = control >>> 4
    const frameNo = control & 0x0f
    const baseKey = `${frame.pgn}:${frame.source}:${packetId}`

    expire()

    if (frameNo === 0) {
      const size = frame.data[1]
      if (size < 2 || size > MAX_FAST_PACKET_SIZE) return

      const payload = Buffer.from(frame.data.subarray(2))
      const packet = {
        pgn: frame.pgn,
        source: frame.source,
        canId: frame.canId,
        packetId,
        size,
        nextFrame: 1,
        payload,
        timestamp: frame.timestamp,
        updatedAt: Date.now()
      }

      packets.set(baseKey, packet)
      finishIfComplete(packet, baseKey)
      return
    }

    const packet = packets.get(baseKey)
    if (!packet) return

    // A restarted/interleaved packet must not silently corrupt the payload.
    if (frameNo !== packet.nextFrame) {
      packets.delete(baseKey)
      return
    }

    packet.payload = Buffer.concat([packet.payload, frame.data.subarray(1)])
    packet.nextFrame = (packet.nextFrame + 1) & 0x0f
    packet.updatedAt = Date.now()
    finishIfComplete(packet, baseKey)
  }

  function finishIfComplete (packet, key) {
    if (packet.payload.length < packet.size) return

    const payload = packet.payload.subarray(0, packet.size)
    packets.delete(key)

    if (typeof onPacket === 'function') {
      onPacket({
        pgn: packet.pgn,
        source: packet.source,
        canId: packet.canId,
        packetId: packet.packetId,
        timestamp: packet.timestamp,
        payload
      })
    }
  }

  return {
    accept,
    clear: () => packets.clear(),
    size: () => packets.size
  }
}

function decodeCzoneHeader (payload, pgn) {
  if (!Buffer.isBuffer(payload) || payload.length < 4) return null
  if (payload[0] !== CZONE_SIGNATURE[0] || payload[1] !== CZONE_SIGNATURE[1]) return null

  // The observed CZone wire layouts differ between these two PGNs:
  // 130817: 27 99 [page] [module]
  // 130822: 27 99 [module] [page]
  if (pgn === 130817) {
    return { page: payload[2], module: payload[3] }
  }
  if (pgn === 130822) {
    return { module: payload[2], page: payload[3] }
  }
  return null
}

module.exports = {
  CZONE_PGNS,
  parseRawLine,
  getPgnFromCanId,
  isCzonePgn,
  createFastPacketReassembler,
  decodeCzoneHeader
}
