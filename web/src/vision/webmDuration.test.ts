import { describe, expect, it } from 'vitest'
import { durationNeedsRepair, patchWebmDuration } from './webmDuration.ts'

const CHROME_HEADER = hex(
  '1a 45 df a3 9f 42 86 81 01 42 f7 81 01 42 f2 81 04 42 f3 81 08 42 82 84 77 65 62 6d 42 87 81 04 42 85 81 02 18 53 80 67 01 ff ff ff ff ff ff ff 15 49 a9 66 99 2a d7 b1 83 0f 42 40 4d 80 86 43 68 72 6f 6d 65 57 41 86 43 68 72 6f 6d 65 16 54',
)

describe('WebM duration repair', () => {
  it('inserts a millisecond duration into a Chrome header that omitted one', () => {
    const patched = patchWebmDuration(CHROME_HEADER, 12000)
    expect(patched).not.toBeNull()
    const view = new DataView(patched!.buffer, patched!.byteOffset)
    const durationAt = indexOf(patched!, [0x44, 0x89])
    expect(patched![durationAt + 2]).toBe(0x84)
    expect(view.getFloat32(durationAt + 3)).toBe(12000)
    expect(patched![48 + 4]).toBe(0xa0)
    expect(patched!.length).toBe(CHROME_HEADER.length + 7)
  })

  it('overwrites a duration already written into the info element', () => {
    const once = patchWebmDuration(CHROME_HEADER, 1000)
    const twice = patchWebmDuration(once!, 8000)
    expect(twice!.length).toBe(once!.length)
    expect(new DataView(twice!.buffer, twice!.byteOffset).getFloat32(indexOf(twice!, [0x44, 0x89]) + 3)).toBe(8000)
  })

  it('treats a near-zero player duration as missing', () => {
    expect(durationNeedsRepair(1, 12000)).toBe(true)
    expect(durationNeedsRepair(undefined, 12000)).toBe(true)
    expect(durationNeedsRepair(11800, 12000)).toBe(false)
  })
})

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.trim().split(/\s+/).map((byte) => Number.parseInt(byte, 16)))
}

function indexOf(bytes: Uint8Array, pattern: number[]): number {
  for (let index = 0; index < bytes.length - pattern.length; index += 1) {
    if (pattern.every((byte, offset) => bytes[index + offset] === byte)) return index
  }
  return -1
}
