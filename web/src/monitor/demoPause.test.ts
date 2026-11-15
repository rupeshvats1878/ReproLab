import { describe, expect, it } from 'vitest'
import { PROTOCOL_ORDER, type WellId, type WellReading, type WellState } from '../shared/types.ts'
import { applyStableObservation, createLiveMonitor, type FrameEvidence } from './liveDecisions.ts'
import {
  afterSyntheticObservation,
  continueDemoPlayback,
  initialDemoPresentation,
  resetDemoPresentation,
} from './demoPause.ts'

function wells(states: Partial<Record<WellId, WellState>>): WellReading[] {
  return PROTOCOL_ORDER.map((wellId) => ({ wellId, state: states[wellId] ?? 'empty' }))
}

function evidence(elapsedMs: number, frameIndex: number): FrameEvidence {
  return { elapsedMs, frameIndex, frameDataUrl: null, label: `frame ${frameIndex}` }
}

function skippedThenFilled() {
  const monitor = createLiveMonitor('synthetic', 1)
  const open = applyStableObservation(
    monitor,
    { elapsedMs: 2640, wells: wells({ A1: 'filled', A2: 'empty', A3: 'filled' }) },
    evidence(2640, 11),
    wells({ A1: 'filled', A2: 'empty', A3: 'filled' }),
  )
  return { monitor, open }
}

describe('synthetic demo pause', () => {
  it('pauses once when a new alert opens', () => {
    const { monitor, open } = skippedThenFilled()
    const first = afterSyntheticObservation(initialDemoPresentation(), 'synthetic', monitor, open)
    expect(first.paused).toBe(true)
    expect(first.handledAlertIds.size).toBe(1)
    const second = afterSyntheticObservation(first, 'synthetic', monitor, open)
    expect(second.paused).toBe(true)
    expect(second.handledAlertIds.size).toBe(1)
  })

  it('continues without acknowledging or correcting the alert', () => {
    const { monitor, open } = skippedThenFilled()
    const paused = afterSyntheticObservation(initialDemoPresentation(), 'synthetic', monitor, open)
    const resumed = continueDemoPlayback(paused)
    expect(resumed.paused).toBe(false)
    expect(open.alerts[0]?.status).toBe('open')
    expect(open.alerts[0]?.correction).toBeUndefined()
    expect(open.timeline.some((entry) => entry.source === 'human')).toBe(false)
  })

  it('lets a later observed fill resolve the alert after continue', () => {
    const { monitor, open } = skippedThenFilled()
    const resumed = continueDemoPlayback(afterSyntheticObservation(initialDemoPresentation(), 'synthetic', monitor, open))
    expect(resumed.paused).toBe(false)
    const filled = applyStableObservation(
      open,
      { elapsedMs: 3520, wells: wells({ A1: 'filled', A2: 'filled', A3: 'filled' }) },
      evidence(3520, 15),
      wells({ A1: 'filled', A2: 'filled', A3: 'filled' }),
    )
    const shown = afterSyntheticObservation(resumed, 'synthetic', open, filled)
    expect(filled.alerts[0]?.status).toBe('corrected')
    expect(filled.alerts[0]?.correction?.elapsedMs).toBe(3520)
    expect(shown.paused).toBe(false)
    expect(shown.correctionNote).toBe('A2 appears filled. The original alert remains.')
    expect(filled.alerts[0]?.observedState).toBe(open.alerts[0]?.observedState)
  })

  it('clears pause state on replay', () => {
    const { monitor, open } = skippedThenFilled()
    const paused = afterSyntheticObservation(initialDemoPresentation(), 'synthetic', monitor, open)
    const reset = resetDemoPresentation(paused.pauseOnIssue)
    expect(reset.paused).toBe(false)
    expect([...reset.handledAlertIds]).toEqual([])
    expect(reset.correctionNote).toBeNull()
    expect(reset.pauseOnIssue).toBe(true)
  })

  it('does not pause a camera or imported video', () => {
    const { monitor, open } = skippedThenFilled()
    const start = initialDemoPresentation()
    expect(afterSyntheticObservation(start, 'live', monitor, open)).toBe(start)
    expect(afterSyntheticObservation(start, 'prerecorded', monitor, open)).toBe(start)
  })
})
