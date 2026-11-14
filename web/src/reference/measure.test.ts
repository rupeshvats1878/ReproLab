import { describe, expect, it } from 'vitest'
import { measure, validRegion } from './measure.ts'
function pixels(color: (x: number) => number[]) {
  const out = new Uint8ClampedArray(60 * 60 * 4)
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) out.set([...color(x), 255], (y * 60 + x) * 4)
  return out
}
describe('reference measurements', () => {
  it('distinguishes spatially different colors from a uniform field', () => {
    const uniform = measure(pixels(() => [150, 100, 80]), 60, 60)
    const split = measure(pixels(x => x < 30 ? [180, 70, 70] : [70, 180, 70]), 60, 60)
    expect(uniform.quality).toBe('accepted')
    expect(uniform.dispersion).toBeLessThan(0.00001)
    expect(split.dispersion).toBeGreaterThan(0.1)
  })
  it('rejects clipped images rather than declaring them uniform', () => {
    expect(measure(pixels(() => [255, 255, 255]), 60, 60).dispersion).toBeNull()
    expect(measure(pixels(() => [0, 0, 0]), 60, 60).quality).toBe('rejected')
  })
  it('rejects invalid regions and undersized pixel arrays', () => {
    expect(validRegion({ x: 90, y: 0, width: 20, height: 20 })).toBe(false)
    expect(validRegion({ x: 20, y: 20, width: 30, height: 30 })).toBe(true)
    expect(measure(new Uint8ClampedArray(4), 60, 60).quality).toBe('rejected')
  })
})
