import { describe, expect, it } from 'vitest'
import { DEMO_SKIP_THEN_FILL } from '../shared/exampleRun.ts'
import { validateRunRecord } from '../shared/protocol.ts'
import { PROTOCOL_ORDER, type ObservationDraft, type WellId, type WellState } from '../shared/types.ts'
import {
  CAMERA_MISSED_NOTE,
  CORRECTION_TEXT,
  LEAVE_UNRESOLVED_NOTE,
  SKIPPED_NOTE,
  createReviewState,
  reduceReview,
  runRecordFromState,
} from './engine.ts'

function wells(filled: readonly WellId[], unknown: readonly WellId[] = []): ObservationDraft['wells'] {
  const filledSet = new Set(filled)
  const unknownSet = new Set(unknown)
  return PROTOCOL_ORDER.map((wellId) => {
    const state: WellState = unknownSet.has(wellId) ? 'unknown' : filledSet.has(wellId) ? 'filled' : 'empty'
    return { wellId, state }
  })
}

function observe(elapsedMs: number, filled: readonly WellId[], unknown: readonly WellId[] = []) {
  return reduceReview(current, {
    type: 'recordObservation',
    draft: { elapsedMs, wells: wells(filled, unknown) },
  })
}

let current = createReviewState()

function start() {
  current = reduceReview(createReviewState(), {
    type: 'startRun',
    draft: { source: 'live', title: 'Bench' },
  })
}

describe('review engine', () => {
  it('follows the order without omission alerts', () => {
    start()
    const steps: WellId[][] = [
      ['A1'],
      ['A1', 'A2'],
      ['A1', 'A2', 'A3'],
      ['A1', 'A2', 'A3', 'B1'],
      ['A1', 'A2', 'A3', 'B1', 'B2'],
      ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
    ]
    steps.forEach((filled, index) => {
      current = observe((index + 1) * 1000, filled)
    })
    expect(current.protocol.alerts).toEqual([])
    expect(current.protocol.expectedWellId).toBeNull()
    expect(current.protocol.observations).toHaveLength(6)
    expect(current.protocol.observations[0]?.id.startsWith('obs_')).toBe(true)
  })

  it('flags different skipped wells once, including a later duplicate snapshot', () => {
    start()
    current = observe(1000, ['A1'])
    current = observe(2000, ['A1', 'A3'])
    current = observe(2500, ['A1', 'A3'])
    expect(current.protocol.alerts.map((alert) => alert.wellId)).toEqual(['A2'])
    expect(current.protocol.alerts[0]?.status).toBe('open')

    current = reduceReview(createReviewState(), {
      type: 'startRun',
      draft: { source: 'live', title: 'Skip B1' },
    })
    current = observe(1000, ['A1', 'A2', 'A3', 'B2'])
    expect(current.protocol.alerts.map((alert) => alert.wellId)).toEqual(['B1'])
  })

  it('treats unknown as a verification request and ignores a non-increasing duplicate', () => {
    start()
    current = observe(1000, ['A3'], ['A1'])
    current = observe(1000, ['A3'], ['A1'])
    expect(current.protocol.observations).toHaveLength(1)
    expect(current.protocol.alerts.map((alert) => alert.wellId)).toEqual(['A1', 'A2'])
    const labels = current.protocol.alerts.map((alert) => alert.wellId)
    expect(labels).toContain('A1')
    const a1 = current.protocol.observations[0]?.wells.find((well) => well.wellId === 'A1')
    const a2 = current.protocol.observations[0]?.wells.find((well) => well.wellId === 'A2')
    expect(a1?.state).toBe('unknown')
    expect(a2?.state).toBe('empty')
  })

  it('keeps original observations when a person responds', () => {
    start()
    current = observe(1000, ['A1', 'A3'])
    const original = current.protocol.observations[0]
    const alertId = current.protocol.alerts[0]?.id ?? ''
    current = reduceReview(current, { type: 'acknowledgeOmission', alertId })
    current = reduceReview(current, {
      type: 'addHumanEvent',
      draft: { kind: 'correction_note', alertId, wellId: 'A2', note: CORRECTION_TEXT },
    })
    expect(current.protocol.observations[0]).toEqual(original)
    expect(current.protocol.wellStates.A2).toBe('empty')
    expect(current.protocol.alerts[0]?.status).toBe('acknowledged')
    expect(current.protocol.humanEvents.map((event) => event.note)).toEqual([
      SKIPPED_NOTE,
      CORRECTION_TEXT,
    ])
    expect(current.protocol.humanEvents[0]?.id.startsWith('evt_')).toBe(true)
    expect(current.protocol.humanEvents[1]?.elapsedMs).toBeGreaterThan(
      current.protocol.humanEvents[0]?.elapsedMs ?? 0,
    )
  })

  it('distinguishes an observed fill from a user-reported fill', () => {
    start()
    current = observe(1000, ['A1', 'A3'])
    const alertId = current.protocol.alerts[0]?.id ?? ''
    current = observe(2000, ['A1', 'A2', 'A3'])
    expect(current.protocol.alerts[0]?.status).toBe('open')
    expect(current.protocol.wellStates.A2).toBe('filled')
    expect(current.protocol.observations[0]?.wells.find((well) => well.wellId === 'A2')?.state).toBe(
      'empty',
    )

    current = reduceReview(current, { type: 'resolveOmission', alertId, note: 'Filled, then verified.' })
    expect(current.protocol.alerts[0]?.status).toBe('resolved')
    expect(current.protocol.alerts[0]?.resolvedEventId).toBe(current.protocol.humanEvents.at(-1)?.id)
    expect(current.protocol.wellStates.A2).toBe('filled')

    current = reduceReview(createReviewState(), {
      type: 'startRun',
      draft: { source: 'live', title: 'Reported only' },
    })
    current = observe(1000, ['A1', 'A3'])
    const reportedId = current.protocol.alerts[0]?.id ?? ''
    current = reduceReview(current, {
      type: 'resolveOmission',
      alertId: reportedId,
      note: CAMERA_MISSED_NOTE,
    })
    expect(current.protocol.wellStates.A2).toBe('empty')
    expect(current.protocol.humanEvents.at(-1)?.reportedState).toBe('filled')
    expect(current.protocol.humanEvents.at(-1)?.note).toBe(CAMERA_MISSED_NOTE)
  })

  it('leaves an alert unresolved and still accepts later observations', () => {
    start()
    current = observe(1000, ['A1', 'A3'])
    const alertId = current.protocol.alerts[0]?.id ?? ''
    current = reduceReview(current, {
      type: 'addHumanEvent',
      draft: { kind: 'correction_note', alertId, wellId: 'A2', note: LEAVE_UNRESOLVED_NOTE },
    })
    current = observe(3000, ['A1', 'A3', 'B1'])
    expect(current.protocol.alerts[0]?.status).toBe('open')
    expect(current.protocol.observations).toHaveLength(2)
    expect(current.protocol.expectedWellId).toBe('A2')
  })

  it('completes a run without deleting alerts and stores the final assessment', () => {
    start()
    current = observe(1000, ['A1', 'A3'])
    current = reduceReview(current, { type: 'updateElapsedMs', elapsedMs: 1500 })
    current = reduceReview(current, { type: 'updateElapsedMs', elapsedMs: 1400 })
    current = reduceReview(current, {
      type: 'completeRun',
      completion: {
        elapsedMs: 2000,
        finalAssessment: {
          elapsedMs: 2000,
          wells: PROTOCOL_ORDER.map((wellId) => ({
            wellId,
            state: wellId === 'A2' ? 'empty' : 'filled',
            matchesExpectedFilled: wellId !== 'A2',
          })),
        },
      },
    })
    expect(current.protocol.phase).toBe('completed')
    expect(current.protocol.elapsedMs).toBe(2000)
    expect(current.protocol.alerts).toHaveLength(1)
    expect(current.protocol.finalAssessment?.id.startsWith('final_')).toBe(true)
    expect(current.protocol.expectedWellId).toBe('A2')
    const record = runRecordFromState(current)
    expect(record).not.toBeNull()
    expect(validateRunRecord(record!)).toEqual([])
  })

  it('links acknowledgement evidence only to registered camera media', () => {
    start()
    current = reduceReview(current, {
      type: 'registerMedia',
      media: {
        mediaId: 'media_camera',
        kind: 'camera_recording',
        available: false,
        runStartOffsetMs: 250,
        durationMs: 20000,
        label: 'Camera',
      },
    })
    current = reduceReview(current, {
      type: 'registerMedia',
      media: {
        mediaId: 'media_camera',
        kind: 'camera_recording',
        available: true,
        runStartOffsetMs: 0,
        label: 'Duplicate',
      },
    })
    current = reduceReview(current, { type: 'updateElapsedMs', elapsedMs: 1000 })
    current = observe(1000, ['A1', 'A3'])
    const alertId = current.protocol.alerts[0]?.id ?? ''
    current = reduceReview(current, { type: 'acknowledgeOmission', alertId })
    const evidence = current.protocol.humanEvents[0]?.evidence
    expect(evidence).toMatchObject({ mediaId: 'media_camera', elapsedMs: 1000 })
    expect(current.protocol.media).toHaveLength(1)
    expect(current.protocol.media[0]?.available).toBe(false)
    const record = runRecordFromState(current)
    expect(validateRunRecord(record!)).toEqual([])
  })

  it('ignores actions that do not match the phase and labels synthetic runs', () => {
    current = createReviewState()
    current = observe(1000, ['A1', 'A3'])
    expect(current.protocol.phase).toBe('idle')
    current = reduceReview(current, {
      type: 'startRun',
      draft: { source: 'synthetic', title: 'Fixture replay', notes: 'Synthetic local replay.' },
    })
    expect(current.protocol.metadata?.syntheticFixture).toBe(true)
    expect(current.protocol.metadata?.id.startsWith('run_')).toBe(true)
    expect(current.protocol.expectedWellId).toBe('A1')
    expect(current.protocol.elapsedMs).toBe(0)
  })

  it('loads a saved record as a completed run without rewriting history', () => {
    current = reduceReview(createReviewState(), { type: 'loadRun', record: DEMO_SKIP_THEN_FILL })
    expect(current.protocol.phase).toBe('completed')
    expect(current.protocol.alerts[0]?.status).toBe('resolved')
    expect(current.protocol.observations).toHaveLength(DEMO_SKIP_THEN_FILL.observations.length)
    expect(current.protocol.elapsedMs).toBe(17500)
    expect(current.protocol.wellStates.A2).toBe('filled')
  })
})
