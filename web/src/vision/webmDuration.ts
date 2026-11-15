const INFO_ID = [0x15, 0x49, 0xa9, 0x66]
const DURATION_ID = [0x44, 0x89]

/**
 * Chrome's MediaRecorder omits the WebM Duration element, so the player reports
 * a near-zero duration and refuses to seek. TimecodeScale in these files is
 * 1,000,000, which makes Duration a millisecond count.
 */
export function patchWebmDuration(bytes: Uint8Array, durationMs: number): Uint8Array | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  const info = findInfo(bytes)
  if (!info) return null
  const existing = findDuration(bytes, info.payloadStart, info.payloadEnd)
  if (existing) {
    const next = bytes.slice()
    writeDuration(next, existing, durationMs)
    return next
  }
  if (info.sizeLength !== 1 || info.payloadLength + 7 > 127) return null
  const duration = durationElement(durationMs)
  const next = new Uint8Array(bytes.length + duration.length)
  next.set(bytes.subarray(0, info.payloadStart), 0)
  next.set(duration, info.payloadStart)
  next.set(bytes.subarray(info.payloadStart), info.payloadStart + duration.length)
  next[info.sizeIndex] = 0x80 | (info.payloadLength + duration.length)
  return next
}

export function durationNeedsRepair(measuredMs: number | undefined, wallClockMs: number): boolean {
  if (!Number.isFinite(wallClockMs) || wallClockMs < 500) return false
  if (measuredMs == null || !Number.isFinite(measuredMs)) return true
  return measuredMs < wallClockMs * 0.5
}

function durationElement(durationMs: number): Uint8Array {
  const out = new Uint8Array(7)
  out[0] = DURATION_ID[0]
  out[1] = DURATION_ID[1]
  out[2] = 0x84
  new DataView(out.buffer).setFloat32(3, durationMs)
  return out
}

function writeDuration(bytes: Uint8Array, payloadIndex: number, durationMs: number): void {
  const size = bytes[payloadIndex - 1]
  const view = new DataView(bytes.buffer, bytes.byteOffset + payloadIndex, size === 0x88 ? 8 : 4)
  if (size === 0x88) view.setFloat64(0, durationMs)
  else view.setFloat32(0, durationMs)
}

function findDuration(bytes: Uint8Array, start: number, end: number): number | null {
  for (let index = start; index < end - 6; index += 1) {
    if (bytes[index] !== DURATION_ID[0] || bytes[index + 1] !== DURATION_ID[1]) continue
    const size = bytes[index + 2]
    if (size !== 0x84 && size !== 0x88) continue
    return index + 3
  }
  return null
}

function findInfo(bytes: Uint8Array): { sizeIndex: number; sizeLength: number; payloadStart: number; payloadEnd: number; payloadLength: number } | null {
  for (let index = 0; index < bytes.length - 5; index += 1) {
    if (!INFO_ID.every((byte, offset) => bytes[index + offset] === byte)) continue
    const sizeIndex = index + INFO_ID.length
    const size = readVint(bytes, sizeIndex)
    if (!size || size.value <= 0) return null
    const payloadStart = size.end
    return {
      sizeIndex,
      sizeLength: size.length,
      payloadStart,
      payloadEnd: payloadStart + size.value,
      payloadLength: size.value,
    }
  }
  return null
}

function readVint(bytes: Uint8Array, index: number): { length: number; value: number; end: number } | null {
  const marker = bytes[index]
  if (marker == null || marker === 0) return null
  let length = 1
  let mask = 0x80
  while (length <= 8 && (marker & mask) === 0) {
    length += 1
    mask >>= 1
  }
  if (length > 8 || index + length > bytes.length) return null
  let value = marker & (mask - 1)
  for (let offset = 1; offset < length; offset += 1) value = value * 256 + bytes[index + offset]
  return { length, value, end: index + length }
}
