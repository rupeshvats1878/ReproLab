/**
 * Synthetic demonstration only.
 * Painted frames go through analyzeFrame, the stabilizer, the observation
 * emitter, and the live omission rule. This is not real-video validation.
 */
import { describe, expect, it } from 'vitest'
import { listPossibleOmissions } from '../shared/protocol.ts'
import { PROTOCOL_ORDER, type ObservationDraft, type WellId, type WellReading, type WellState } from '../shared/types.ts'
import { COLOR_PRESETS } from '../vision/color.ts'
import { defaultWellRegions } from '../vision/geometry.ts'
import { ObservationEmitter, ReadingStabilizer, readingsOf } from '../vision/stabilize.ts'
import {
  analyzeFrame,
  emptyReferenceFromBuffer,
  measurementStates,
} from '../vision/analyze.ts'
import { initialWellStates } from '../shared/protocol.ts'
import {
  framesFromScript,
  sequenceSkipA1,
  sequenceSkipA2ThenFill,
  sequenceUncertain,
  type SyntheticFrame,
} from '../vision/synthetic.ts'
import {
  applyStableObservation,
  blockLiveMonitor,
  createLiveMonitor,
  selectLiveOmissions,
  type LiveMonitorState,
} from './liveDecisions.ts'

function stateOf(wells: readonly WellReading[], wellId: WellId): WellState {
  return wells.find((reading) => reading.wellId === wellId)?.state ?? 'unknown'
}

function monitorSynthetic(frames: readonly SyntheticFrame[]) {
  const first = frames[0]
  if (!first) throw new Error('synthetic sequence is empty')
  const regions = defaultWellRegions()
  const reference = emptyReferenceFromBuffer(first.data, first.width, first.height, regions)
  const stabilizer = new ReadingStabilizer(4)
  const emitter = new ObservationEmitter()
  emitter.arm(initialWellStates())
  let previous = initialWellStates()
  const box: { live: LiveMonitorState; elapsed: number; drafts: ObservationDraft[] } = {
    live: createLiveMonitor('synthetic', 1),
    elapsed: 0,
    drafts: [],
  }

  const push = (frame: SyntheticFrame, at: number, frameIndex: number) => {
    const measured = analyzeFrame(
      frame.data,
      frame.width,
      frame.height,
      regions,
      { expectedColor: COLOR_PRESETS[0].rgb, emptyReference: reference },
      previous,
    )
    previous = measurementStates(measured)
    const stable = stabilizer.push(previous)
    const draft = emitter.consider(at, stable.states)
    if (!draft) return false
    box.drafts.push(draft)
    box.live = applyStableObservation(
      box.live,
      draft,
      {
        elapsedMs: draft.elapsedMs,
        frameIndex,
        frameDataUrl: null,
        label: frame.label,
      },
      readingsOf(previous),
    )
    return true
  }

  frames.forEach((frame, index) => {
    box.elapsed += 220
    push(frame, box.elapsed, index)
  })

  return { box, emitter, push }
}

describe('synthetic live monitor (not real-video validation)', () => {
  it('keeps only stably empty wells from the shared omission list', () => {
    const wells: WellReading[] = PROTOCOL_ORDER.map((wellId) => ({
      wellId,
      state: wellId === 'A1' ? 'unknown' : wellId === 'A2' ? 'empty' : wellId === 'A3' ? 'filled' : 'empty',
    }))
    expect(listPossibleOmissions(PROTOCOL_ORDER, wells)).toEqual(['A1', 'A2'])
    expect(selectLiveOmissions(PROTOCOL_ORDER, wells)).toEqual(['A2'])
  })

  it('raises a skip when a later painted well is filled and an earlier well stays empty', () => {
    const { box } = monitorSynthetic(sequenceSkipA1())
    const last = box.drafts.at(-1)
    expect(last).toBeDefined()
    expect(stateOf(last!.wells, 'A1')).toBe('empty')
    expect(stateOf(last!.wells, 'A2')).toBe('filled')
    expect(selectLiveOmissions(PROTOCOL_ORDER, last!.wells)).toEqual(['A1'])
    expect(box.live.alerts.map((alert) => alert.wellId)).toEqual(['A1'])
    const alert = box.live.alerts[0]
    expect(alert?.observedState).toContain('A1 empty')
    expect(alert?.rule).toMatch(/stably empty/i)
    expect(alert?.evidence.elapsedMs).toBe(alert?.raisedAtElapsedMs)
    expect(alert?.evidence.frameIndex).toBeGreaterThanOrEqual(0)
    expect(box.live.timeline.filter((entry) => entry.kind === 'omission_alert')).toHaveLength(1)
    const entry = box.live.timeline.find((item) => item.kind === 'omission_alert')
    expect(entry?.source).toBe('camera')
    expect(entry?.expectedAction).toContain('A1')
    expect(entry?.sourceElapsedMs).toBe(last!.elapsedMs)
    expect(entry?.evidence.frameIndex).toBe(alert?.evidence.frameIndex)
  })

  it('keeps the original alert when a later frame fills the skipped well', () => {
    const { box } = monitorSynthetic(sequenceSkipA2ThenFill())
    const alert = box.live.alerts.find((item) => item.wellId === 'A2')
    expect(alert?.correction?.observedState).toBe('filled')
    expect(alert?.raisedAtElapsedMs).toBeLessThan(alert!.correction!.elapsedMs)
    expect(alert?.evidence.elapsedMs).toBe(alert?.raisedAtElapsedMs)
    expect(alert?.evidence.frameIndex).not.toBe(alert?.correction?.evidence.frameIndex)
    const omissions = box.live.timeline.filter((entry) => entry.kind === 'omission_alert' && entry.wellId === 'A2')
    const corrections = box.live.timeline.filter((entry) => entry.kind === 'correction' && entry.wellId === 'A2')
    expect(omissions).toHaveLength(1)
    expect(corrections).toHaveLength(1)
    expect(omissions[0]?.evidence.elapsedMs).toBe(alert?.raisedAtElapsedMs)
    expect(corrections[0]?.evidence.elapsedMs).toBe(alert?.correction?.elapsedMs)
    expect(corrections[0]?.rule).toMatch(/original alert is kept/i)
    expect(box.live.alerts.filter((item) => item.wellId === 'A2')).toHaveLength(1)
  })

  it('does not alert when the earlier painted well is unknown rather than empty', () => {
    const uncertain = monitorSynthetic(sequenceUncertain())
    const uncertainLast = uncertain.box.drafts.at(-1)
    expect(uncertainLast).toBeDefined()
    expect(stateOf(uncertainLast!.wells, 'A1')).toBe('unknown')
    expect(stateOf(uncertainLast!.wells, 'A2')).toBe('filled')
    expect(listPossibleOmissions(PROTOCOL_ORDER, uncertainLast!.wells)).toEqual(['A1'])
    expect(selectLiveOmissions(PROTOCOL_ORDER, uncertainLast!.wells)).toEqual([])
    expect(uncertain.box.live.alerts).toEqual([])

    const mixed = monitorSynthetic(
      framesFromScript([
        { hold: 4, paints: {}, label: 'all empty' },
        {
          hold: 4,
          paints: { A1: 'checker', A3: 'filled' },
          label: 'A1 mixed, A2 still empty, A3 filled',
        },
      ]),
    )
    const last = mixed.box.drafts.at(-1)
    expect(last).toBeDefined()
    expect(stateOf(last!.wells, 'A1')).toBe('unknown')
    expect(stateOf(last!.wells, 'A2')).toBe('empty')
    expect(stateOf(last!.wells, 'A3')).toBe('filled')
    expect(listPossibleOmissions(PROTOCOL_ORDER, last!.wells)).toEqual(['A1', 'A2'])
    expect(selectLiveOmissions(PROTOCOL_ORDER, last!.wells)).toEqual(['A2'])
    expect(mixed.box.live.alerts.map((alert) => alert.wellId)).toEqual(['A2'])
    expect(mixed.box.live.timeline.filter((entry) => entry.kind === 'omission_alert')).toHaveLength(1)
  })

  it('does not raise a second identical alert for duplicate frames', () => {
    const { box, emitter, push } = monitorSynthetic(sequenceSkipA1())
    const alertCount = box.live.alerts.length
    const omissionCount = box.live.timeline.filter((entry) => entry.kind === 'omission_alert').length
    expect(alertCount).toBe(1)
    const lastFrame = sequenceSkipA1().at(-1)
    expect(lastFrame).toBeDefined()
    const accepted = push(lastFrame!, box.elapsed + 220, 99)
    expect(accepted).toBe(false)
    const same = {} as Record<WellId, WellState>
    for (const reading of box.drafts.at(-1)!.wells) same[reading.wellId] = reading.state
    expect(emitter.consider(box.elapsed + 440, same)).toBeNull()
    const repeated = applyStableObservation(
      box.live,
      {
        elapsedMs: box.live.lastElapsedMs + 220,
        wells: box.drafts.at(-1)!.wells.map((reading) => ({ ...reading })),
      },
      {
        elapsedMs: box.live.lastElapsedMs + 220,
        frameIndex: 100,
        frameDataUrl: null,
        label: 'duplicate',
      },
    )
    expect(repeated.alerts).toHaveLength(alertCount)
    expect(repeated.timeline.filter((entry) => entry.kind === 'omission_alert')).toHaveLength(omissionCount)
    expect(repeated.alerts[0]?.id).toBe(box.live.alerts[0]?.id)
    expect(repeated.alerts[0]?.evidence.frameIndex).toBe(box.live.alerts[0]?.evidence.frameIndex)
  })

  it('does not create an event when the clock jumps backwards', () => {
    const { box, emitter } = monitorSynthetic(sequenceSkipA1())
    const beforeAlerts = box.live.alerts.map((alert) => alert.id)
    const beforeTimeline = box.live.timeline.length
    expect(emitter.consider(0, {
      A1: 'filled',
      A2: 'filled',
      A3: 'filled',
      B1: 'filled',
      B2: 'filled',
      B3: 'filled',
    })).toBeNull()
    expect(emitter.blocked).toMatch(/backwards/i)
    expect(emitter.consider(box.elapsed + 1000, {
      A1: 'empty',
      A2: 'filled',
      A3: 'filled',
      B1: 'filled',
      B2: 'filled',
      B3: 'filled',
    })).toBeNull()
    const blocked = blockLiveMonitor(box.live, emitter.blocked ?? 'backwards')
    const foreign = monitorSynthetic(sequenceSkipA2ThenFill()).box.drafts.at(-1)
    expect(foreign).toBeDefined()
    const rejected = applyStableObservation(blocked, foreign!, {
      elapsedMs: foreign!.elapsedMs,
      frameIndex: 3,
      frameDataUrl: null,
      label: 'stale after seek',
    })
    expect(rejected.alerts.map((alert) => alert.id)).toEqual(beforeAlerts)
    expect(rejected.timeline).toHaveLength(beforeTimeline)
    expect(rejected.blockedReason).toMatch(/backwards/i)
  })
})

