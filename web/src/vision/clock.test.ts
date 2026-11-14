import { describe, expect, it } from 'vitest'
import {
  isBackwardJump,
  liveElapsedMs,
  monotonicElapsed,
  prerecordedElapsedMs,
  runStartOffsetFromClocks,
} from './clock.ts'

describe('run clock', () => {
  it('measures live elapsed time from a monotonic origin', () => {
    expect(liveElapsedMs(1500.4, 1000)).toBe(500)
    expect(liveElapsedMs(900, 1000)).toBe(0)
    expect(monotonicElapsed(400, 500)).toBe(500)
    expect(monotonicElapsed(800.2, 500)).toBe(800)
  })

  it('uses prerecorded media time minus the run-start offset', () => {
    expect(prerecordedElapsedMs(1.25, 250)).toBe(1000)
    expect(prerecordedElapsedMs(0.1, 250)).toBeNull()
    expect(prerecordedElapsedMs(Number.NaN, 0)).toBeNull()
  })

  it('records the offset between the run clock and the media start', () => {
    expect(runStartOffsetFromClocks(1500, 1000)).toBe(500)
    expect(runStartOffsetFromClocks(1000, 3000)).toBe(-2000)
  })

  it('treats a backward media jump as a seek and leaves normal playback alone', () => {
    expect(isBackwardJump(5, 1)).toBe(true)
    expect(isBackwardJump(1, 1.02)).toBe(false)
    expect(isBackwardJump(1, 4)).toBe(false)
  })
})
