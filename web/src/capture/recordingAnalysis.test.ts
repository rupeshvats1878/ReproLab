import { describe, it, expect } from 'vitest'
import { parseRecordingAnalysis, recordingComparisons, recordingLinkError, RECORDING_ANALYSIS_SCHEMA } from './recordingAnalysis.ts'

// Synthetic software fixtures, not experiment measurements.
function fixture() {
  const event = (eventId: string, sourceCupId: string, destinationCupId: string, start: number) => ({
    eventId, sourceCupId, destinationCupId, eventStartMs: start, eventEndMs: start + 100,
    evidenceTimestampsMs: [start + 50], observationStatus: 'observed', needsHumanVerification: true,
    humanConfirmed: false, segmentIndexes: [0],
  })
  return { schemaVersion: RECORDING_ANALYSIS_SCHEMA, sessionId: 'synthetic-session', videoId: 'synthetic-video',
    recording: { durationMs: 2000, sizeBytes: 1000 }, segments: [{ sourceOffsetMs: 0, durationMs: 2000, endMs: 2000, observationStatus: 'observed' }],
    timeline: { events: [event('a', 'RED', 'BLUE', 100), event('b', 'GREEN', 'BLUE', 500), { ...event('c', 'GREEN', 'RED', 900), humanConfirmed: true }], appearances: [] }, protocolReport: { decision: 'COMPLIANT' } }
}
describe('whole recording review', () => {
  it('sorts model events, preserves raw confirmation, and computes a separate extra-transfer comparison', () => {
    const raw = fixture(); raw.timeline.events.reverse()
    const parsed = parseRecordingAnalysis(raw)
    expect(parsed.events.map(event => event.id)).toEqual(['a', 'b', 'c'])
    expect(parsed.events[2].humanConfirmed).toBe(true)
    expect(parsed.raw).toEqual(raw)
    const comparisons = recordingComparisons(parsed.events, [['RED', 'BLUE'], ['GREEN', 'RED']])
    expect(comparisons[1]).toContain('Possible extra transfer')
    expect(comparisons[2]).toContain('not automatically completed')
  })
  it('rejects invalid evidence, duplicate events and absent human-review flags', () => {
    const raw = fixture(); raw.timeline.events[0].evidenceTimestampsMs = [1500]
    expect(() => parseRecordingAnalysis(raw)).toThrow(/Evidence/)
    const duplicate = fixture(); duplicate.timeline.events[1].eventId = 'a'
    expect(() => parseRecordingAnalysis(duplicate)).toThrow(/Duplicate/)
    const unsafe = fixture(); unsafe.timeline.events[0].needsHumanVerification = false
    expect(() => parseRecordingAnalysis(unsafe)).toThrow(/Human-review/)
  })
  it('keeps unknown identities uncertain and flags repeated pairs', () => {
    const raw = fixture(); raw.timeline.events[0].sourceCupId = 'unknown'
    const parsed = parseRecordingAnalysis(raw)
    expect(recordingComparisons(parsed.events, [['RED', 'BLUE']])[0]).toContain('Uncertain')
    const repeated = parseRecordingAnalysis(fixture()).events
    expect(recordingComparisons([repeated[0], repeated[0]], [['RED', 'BLUE']])[1]).toContain('repeated')
  })
  it('requires file size, bounded duration difference and any supplied hash to match', () => {
    const parsed = parseRecordingAnalysis(fixture())
    expect(recordingLinkError(parsed, 1000, 2064, 'abc', 'abc')).toBeNull()
    expect(recordingLinkError(parsed, 1000, 2064, 'abc', 'def')).toMatch(/hash/)
    expect(recordingLinkError(parsed, 999, 2000, null, null)).toMatch(/size/)
    expect(recordingLinkError(parsed, 1000, 3000, null, null)).toMatch(/duration/)
  })
  it('does not trust a supplied complete-coverage claim when windows leave a gap', () => {
    const raw = fixture(); raw.segments[0] = { sourceOffsetMs: 50, durationMs: 1950, endMs: 2000, observationStatus: 'observed' }
    expect(parseRecordingAnalysis(raw).warnings.join(' ')).toContain('gap')
  })
  it('uses the selected approved procedure rather than the imported evaluator decision', () => {
    const parsed = parseRecordingAnalysis(fixture())
    const comparison = recordingComparisons(parsed.events, [['BLUE', 'RED'], ['GREEN', 'BLUE']])
    expect(comparison[0]).toContain('extra')
    expect(comparison[1]).toContain('possible order difference')
  })
})
