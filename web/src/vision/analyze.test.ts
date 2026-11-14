import { describe, expect, it } from 'vitest'
import { initialWellStates } from '../shared/protocol.ts'
import { analyzeFrame, classifyAppearance, emptyReferenceFromBuffer } from './analyze.ts'
import { COLOR_PRESETS } from './color.ts'
import { defaultWellRegions } from './geometry.ts'
import { paintFrame } from './synthetic.ts'

const regions = defaultWellRegions()
const blue = COLOR_PRESETS[0].rgb

function analyzePaint(paints: Parameters<typeof paintFrame>[0], previous = initialWellStates()) {
  const empty = paintFrame({}, 'empty reference')
  const frame = paintFrame(paints, 'sample', 2)
  const reference = emptyReferenceFromBuffer(empty.data, empty.width, empty.height, regions)
  return analyzeFrame(
    frame.data,
    frame.width,
    frame.height,
    regions,
    { expectedColor: blue, emptyReference: reference },
    previous,
  )
}

describe('colored-water frame analysis', () => {
  it('reads a solid filled well as filled and an empty well as empty', () => {
    const measurements = analyzePaint({ A1: 'filled' })
    const a1 = measurements.find((item) => item.wellId === 'A1')
    const a2 = measurements.find((item) => item.wellId === 'A2')
    expect(a1?.state).toBe('filled')
    expect(a1?.fillScore).toBeGreaterThan(0.55)
    expect(a2?.state).toBe('empty')
    expect(a2?.fillScore).toBeLessThan(0.2)
  })

  it('keeps an off-color well and a mixed well unknown', () => {
    const measurements = analyzePaint({ A1: 'olive', B3: 'checker' })
    expect(measurements.find((item) => item.wellId === 'A1')?.state).toBe('unknown')
    const mixed = measurements.find((item) => item.wellId === 'B3')
    expect(mixed?.state).toBe('unknown')
    expect(mixed?.mixScore).toBeGreaterThan(0.4)
  })

  it('does not call an empty well empty when there is no empty-plate reference', () => {
    const frame = paintFrame({}, 'no reference')
    const measurements = analyzeFrame(
      frame.data,
      frame.width,
      frame.height,
      regions,
      { expectedColor: blue, emptyReference: null },
      initialWellStates(),
    )
    expect(measurements.every((item) => item.state === 'unknown')).toBe(true)
    expect(measurements.every((item) => item.emptyDistance == null)).toBe(true)
  })

  it('uses hysteresis so a mid-range score does not flicker', () => {
    expect(classifyAppearance(0.62, 0.4, 0.05, 'unknown', true)).toBe('filled')
    expect(classifyAppearance(0.45, 0.4, 0.05, 'unknown', true)).toBe('unknown')
    expect(classifyAppearance(0.45, 0.4, 0.05, 'filled', true)).toBe('filled')
    expect(classifyAppearance(0.2, 0.05, 0.05, 'filled', true)).toBe('empty')
    expect(classifyAppearance(0.9, 0.5, 0.8, 'empty', true)).toBe('unknown')
  })

  it('describes the dye score as a heuristic on the measurement', () => {
    const [a1] = analyzePaint({ A1: 'filled' })
    expect(a1?.fillScore).toBeGreaterThanOrEqual(0)
    expect(a1?.fillScore).toBeLessThanOrEqual(1)
  })
})
