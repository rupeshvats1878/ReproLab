import { describe, it, expect } from 'vitest'
import { playbackEventIndex } from './recordingAnalysis.ts'
describe('saved-analysis playback selection', () => {
  const events = [{ startMs: 66500 }, { startMs: 80500 }, { startMs: 87500 }]
  it('never displays a future event', () => expect(playbackEventIndex(events, 66000)).toBe(-1))
  it('selects at the exact original-media boundary', () => expect(playbackEventIndex(events, 80500)).toBe(1))
  it('keeps the most recent finding between events', () => expect(playbackEventIndex(events, 84000)).toBe(1))
  it('follows forward and backward seeks', () => { expect(playbackEventIndex(events, 90000)).toBe(2); expect(playbackEventIndex(events, 70000)).toBe(0); expect(playbackEventIndex(events, 0)).toBe(-1) })
  it('clears missing or invalid data', () => { expect(playbackEventIndex([], 90000)).toBe(-1); expect(playbackEventIndex(events, NaN)).toBe(-1) })
})
