import { describe, expect, it } from 'vitest'
import { useReviewController } from '../review/useReviewController.ts'
import {
  DEMO_COMPLETE,
  DEMO_SKIP_THEN_FILL,
  DEMO_SKIP_UNRESOLVED,
  SYNTHETIC_DEMO_RUNS,
  SYNTHETIC_EXAMPLE_RUN,
} from './exampleRun.ts'
import {
  IDLE_PROTOCOL,
  createId,
  evidenceIsCovered,
  evidenceOffsetMs,
  expectedWellId,
  foldWellStates,
  initialWellStates,
  listPossibleOmissions,
  protocolStateFromRecord,
  validateRunRecord,
} from './protocol.ts'
import { PROTOCOL_ORDER, WELL_GRID, WELL_IDS, type MediaAvailability } from './types.ts'

describe('protocol contract', () => {
  it('uses one 2×3 order for layout and filling', () => {
    expect([...WELL_IDS]).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
    expect([...PROTOCOL_ORDER]).toEqual([...WELL_IDS])
    expect(WELL_GRID.flat()).toEqual([...PROTOCOL_ORDER])
  })

  it('starts an idle bench as unknown rather than complete', () => {
    expect(IDLE_PROTOCOL.phase).toBe('idle')
    expect(IDLE_PROTOCOL.expectedWellId).toBeNull()
    expect(Object.values(IDLE_PROTOCOL.wellStates)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ])
    expect(expectedWellId(PROTOCOL_ORDER, initialWellStates())).toBe('A1')
  })

  it('flags an earlier well when a later well is filled', () => {
    const skipped = listPossibleOmissions(PROTOCOL_ORDER, [
      { wellId: 'A1', state: 'filled' },
      { wellId: 'A2', state: 'empty' },
      { wellId: 'A3', state: 'filled' },
      { wellId: 'B1', state: 'empty' },
      { wellId: 'B2', state: 'empty' },
      { wellId: 'B3', state: 'empty' },
    ])
    expect(skipped).toEqual(['A2'])

    const unknownCounts = listPossibleOmissions(PROTOCOL_ORDER, [
      { wellId: 'A1', state: 'unknown' },
      { wellId: 'A2', state: 'empty' },
      { wellId: 'A3', state: 'filled' },
      { wellId: 'B1', state: 'empty' },
      { wellId: 'B2', state: 'empty' },
      { wellId: 'B3', state: 'empty' },
    ])
    expect(unknownCounts).toEqual(['A1', 'A2'])

    const inOrder = listPossibleOmissions(PROTOCOL_ORDER, [
      { wellId: 'A1', state: 'filled' },
      { wellId: 'A2', state: 'filled' },
      { wellId: 'A3', state: 'empty' },
      { wellId: 'B1', state: 'empty' },
      { wellId: 'B2', state: 'empty' },
      { wellId: 'B3', state: 'empty' },
    ])
    expect(inOrder).toEqual([])
  })

  it('maps evidence through the media offset, not through chunk timing', () => {
    expect(evidenceOffsetMs(250, 8500)).toBe(8750)

    const camera: MediaAvailability = {
      mediaId: 'media_example',
      runId: 'run_example',
      kind: 'camera_recording',
      available: true,
      runStartOffsetMs: 250,
      durationMs: 20000,
      label: 'Example',
    }
    expect(evidenceIsCovered(camera, 8500)).toBe(true)
    expect(evidenceIsCovered(camera, 19750)).toBe(true)
    expect(evidenceIsCovered(camera, 19751)).toBe(false)

    const startedBeforeRecording: MediaAvailability = {
      ...camera,
      runStartOffsetMs: -250,
      durationMs: 1000,
    }
    expect(evidenceOffsetMs(-250, 100)).toBe(-150)
    expect(evidenceIsCovered(startedBeforeRecording, 100)).toBe(false)
    expect(evidenceIsCovered(startedBeforeRecording, 250)).toBe(true)

    const still: MediaAvailability = {
      ...camera,
      kind: 'final_plate_image',
      runStartOffsetMs: 0,
      durationMs: undefined,
    }
    expect(evidenceIsCovered(still, 17500)).toBe(true)
    expect(evidenceIsCovered({ ...still, available: false }, 17500)).toBe(false)
  })

  it('assigns prefixed ids', () => {
    expect(createId('run').startsWith('run_')).toBe(true)
    expect(createId('observation').startsWith('obs_')).toBe(true)
    expect(createId('humanEvent').startsWith('evt_')).toBe(true)
    expect(createId('alert').startsWith('alert_')).toBe(true)
    expect(createId('media').startsWith('media_')).toBe(true)
  })
})

describe('synthetic demos', () => {
  it('validates three labeled fixtures without embedded media bytes', () => {
    expect(SYNTHETIC_DEMO_RUNS).toHaveLength(3)
    expect(SYNTHETIC_EXAMPLE_RUN).toBe(DEMO_SKIP_THEN_FILL)
    for (const run of SYNTHETIC_DEMO_RUNS) {
      expect(validateRunRecord(run)).toEqual([])
      expect(run.metadata.source).toBe('synthetic')
      expect(run.metadata.syntheticFixture).toBe(true)
      expect(run.metadata.notes?.startsWith('Synthetic')).toBe(true)
      expect(containsBlob(run)).toBe(false)
      const restored = JSON.parse(JSON.stringify(run)) as typeof run
      expect(validateRunRecord(restored)).toEqual([])
    }
  })

  it('shows a skip that is later filled and resolved', () => {
    const flag = DEMO_SKIP_THEN_FILL.observations[1]
    expect(flag).toBeDefined()
    expect(listPossibleOmissions(PROTOCOL_ORDER, flag?.wells ?? [])).toEqual(['A2'])
    expect(DEMO_SKIP_THEN_FILL.alerts[0]?.status).toBe('resolved')
    expect(DEMO_SKIP_THEN_FILL.alerts[0]?.wellId).toBe('A2')
    expect(foldWellStates(DEMO_SKIP_THEN_FILL.observations).A2).toBe('filled')
    const view = protocolStateFromRecord(DEMO_SKIP_THEN_FILL)
    expect(view.phase).toBe('completed')
    expect(view.expectedWellId).toBeNull()
    expect(view.elapsedMs).toBe(17500)

    const camera = DEMO_SKIP_THEN_FILL.media[0]
    const resolution = DEMO_SKIP_THEN_FILL.humanEvents[1]
    expect(camera?.runStartOffsetMs).toBe(250)
    expect(resolution?.elapsedMs).toBe(8500)
    expect(evidenceOffsetMs(camera?.runStartOffsetMs ?? 0, resolution?.elapsedMs ?? 0)).toBe(8750)
    expect(camera && resolution ? evidenceIsCovered(camera, resolution.elapsedMs) : true).toBe(false)
  })

  it('keeps an unresolved skip visible against the final image', () => {
    const view = protocolStateFromRecord(DEMO_SKIP_UNRESOLVED)
    expect(view.alerts.map((alert) => alert.status)).toEqual(['open'])
    expect(view.expectedWellId).toBe('B2')
    expect(view.wellStates.B2).toBe('empty')
    expect(view.humanEvents).toEqual([])
    const finalB2 = view.finalAssessment?.wells.find((well) => well.wellId === 'B2')
    expect(finalB2).toMatchObject({ state: 'empty', matchesExpectedFilled: false })
  })

  it('has no omissions when filling follows the order', () => {
    for (const observation of DEMO_COMPLETE.observations) {
      expect(listPossibleOmissions(PROTOCOL_ORDER, observation.wells)).toEqual([])
    }
    const view = protocolStateFromRecord(DEMO_COMPLETE)
    expect(view.alerts).toEqual([])
    expect(view.expectedWellId).toBeNull()
    expect(Object.values(view.wellStates).every((state) => state === 'filled')).toBe(true)
  })

  it('rejects a record whose observations go backwards', () => {
    const broken = {
      ...DEMO_COMPLETE,
      observations: [...DEMO_COMPLETE.observations].reverse(),
    }
    expect(validateRunRecord(broken).length).toBeGreaterThan(0)
  })
})

describe('review controller stub', () => {
  it('keeps the frozen export for App to import', () => {
    expect(typeof useReviewController).toBe('function')
  })
})

function containsBlob(value: unknown): boolean {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (Array.isArray(value)) return value.some(containsBlob)
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, inner]) => key.toLowerCase() === 'blob' || containsBlob(inner),
    )
  }
  return false
}
