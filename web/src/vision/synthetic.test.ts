import { describe, expect, it } from 'vitest'
import { listPossibleOmissions } from '../shared/protocol.ts'
import { WELL_IDS, type WellId, type WellState } from '../shared/types.ts'
import { ObservationEmitter, ReadingStabilizer } from './stabilize.ts'
import {
  analyzeSequence,
  sequenceBriefNoise,
  sequenceFillInOrder,
  sequenceSkipA1,
  sequenceSkipA2ThenFill,
  sequenceSkipB2,
  sequenceUncertain,
} from './synthetic.ts'

function stateOf(
  wells: readonly { wellId: WellId; state: WellState }[],
  wellId: WellId,
): WellState {
  return wells.find((well) => well.wellId === wellId)?.state ?? 'unknown'
}

function filledIds(wells: readonly { wellId: WellId; state: WellState }[]): WellId[] {
  return wells.filter((well) => well.state === 'filled').map((well) => well.wellId)
}

describe('synthetic sequences through the analyzer', () => {
  it('fills every well in protocol order without raising a skip', () => {
    const { observations } = analyzeSequence(sequenceFillInOrder())
    expect(observations.length).toBeGreaterThanOrEqual(7)
    observations.forEach((observation, index) => {
      expect(observation.wells).toHaveLength(6)
      expect(listPossibleOmissions(WELL_IDS, observation.wells)).toEqual([])
      if (index > 0) {
        const previous = observations[index - 1]
        expect(previous).toBeDefined()
        expect(observation.elapsedMs).toBeGreaterThan(previous!.elapsedMs)
      }
    })
    const last = observations.at(-1)
    expect(last && filledIds(last.wells)).toEqual([...WELL_IDS])
    const prefixes = observations.map((observation) => filledIds(observation.wells).join(','))
    expect(prefixes).toContain(['A1', 'A2', 'A3', 'B1'].join(','))
  })

  it('sees A2 still empty when A3 is filled, then sees A2 filled later', () => {
    const { observations } = analyzeSequence(sequenceSkipA2ThenFill())
    const skipped = observations.find(
      (observation) =>
        stateOf(observation.wells, 'A3') === 'filled' && stateOf(observation.wells, 'A2') === 'empty',
    )
    const filledLater = observations.find(
      (observation) =>
        stateOf(observation.wells, 'A2') === 'filled' && stateOf(observation.wells, 'A3') === 'filled',
    )
    expect(skipped).toBeDefined()
    expect(listPossibleOmissions(WELL_IDS, skipped!.wells)).toEqual(['A2'])
    expect(filledLater).toBeDefined()
    expect(listPossibleOmissions(WELL_IDS, filledLater!.wells)).toEqual([])
    expect(filledLater!.elapsedMs).toBeGreaterThan(skipped!.elapsedMs)
  })

  it('flags different skipped wells from the analyzed frames', () => {
    const skipA1 = analyzeSequence(sequenceSkipA1()).observations.at(-1)
    const skipB2 = analyzeSequence(sequenceSkipB2()).observations.at(-1)
    expect(skipA1 && listPossibleOmissions(WELL_IDS, skipA1.wells)).toEqual(['A1'])
    expect(stateOf(skipA1!.wells, 'A1')).toBe('empty')
    expect(stateOf(skipA1!.wells, 'A2')).toBe('filled')
    expect(skipB2 && listPossibleOmissions(WELL_IDS, skipB2.wells)).toEqual(['B2'])
    expect(stateOf(skipB2!.wells, 'B2')).toBe('empty')
    expect(stateOf(skipB2!.wells, 'B3')).toBe('filled')
  })

  it('ignores one noisy frame instead of emitting a filled well', () => {
    const { observations, raw } = analyzeSequence(sequenceBriefNoise())
    const a1Index = WELL_IDS.indexOf('A1')
    expect(raw.some((frame) => frame[a1Index] !== 'empty')).toBe(true)
    expect(observations.every((observation) => stateOf(observation.wells, 'A1') === 'empty')).toBe(true)
    expect(observations.at(-1) && stateOf(observations.at(-1)!.wells, 'A1')).toBe('empty')
  })

  it('keeps mixed and off-color wells unknown when a later well is filled', () => {
    const { observations } = analyzeSequence(sequenceUncertain())
    const last = observations.at(-1)
    expect(last).toBeDefined()
    expect(stateOf(last!.wells, 'A1')).toBe('unknown')
    expect(stateOf(last!.wells, 'A2')).toBe('filled')
    expect(listPossibleOmissions(WELL_IDS, last!.wells)).toEqual(['A1'])
    expect(observations.every((observation) => stateOf(observation.wells, 'A1') !== 'filled')).toBe(true)
  })
})

describe('stabilizer and observation clock', () => {
  it('requires repeated readings and refuses a backwards clock', () => {
    const stabilizer = new ReadingStabilizer(3)
    const emitter = new ObservationEmitter()
    const empty = {
      A1: 'empty',
      A2: 'empty',
      A3: 'empty',
      B1: 'empty',
      B2: 'empty',
      B3: 'empty',
    } as const
    const spiked = { ...empty, A1: 'filled' as const }

    expect(stabilizer.push(empty).changed).toBe(false)
    expect(stabilizer.push(empty).changed).toBe(false)
    const stable = stabilizer.push(empty)
    expect(stable.changed).toBe(true)
    expect(emitter.consider(300, stable.states)?.elapsedMs).toBe(300)
    expect(emitter.consider(300, stable.states)).toBeNull()

    stabilizer.push(spiked)
    expect(stabilizer.push(empty).states.A1).toBe('empty')

    expect(emitter.consider(200, empty)).toBeNull()
    expect(emitter.blocked).toMatch(/backwards/i)
    expect(emitter.consider(900, spiked)).toBeNull()
    emitter.reset()
    expect(emitter.consider(0, empty)?.elapsedMs).toBe(0)
  })
})
