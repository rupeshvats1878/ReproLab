import { describe, expect, it } from 'vitest'
import { annotationDocument, compareHumanMarker, recordingSeekSeconds, THREE_CUP_EXPECTED } from './threeCup.ts'

describe('three-cup annotation export', () => {
  it('records human provenance and recording-relative time without calling it training data', () => {
    const document = annotationDocument({
      sessionId: 'session_1',
      runStartOffsetMs: -2000,
      durationMs: 12000,
      mediaId: 'media_1',
      markers: [{
        id: 'marker_1',
        marker: 'transfer_green_to_blue',
        observationTimestamp: 4000,
        cups: ['GREEN', 'BLUE'],
        label: 'GREEN → BLUE transfer',
      }],
    })
    expect(document.schemaVersion).toBe(1)
    expect(document.kind).toBe('annotation')
    expect(document.note).toMatch(/Not a Laya training dataset/)
    expect(document.procedureId).toBe('three-cup-capture')
    expect(document.markers[0]).toMatchObject({ provenance: 'human', recordingTimestampMs: 2000 })
    expect(document.cups.map((cup) => cup.id)).toEqual(['RED', 'GREEN', 'BLUE'])
    expect(document.expectedProcedure).toEqual([...THREE_CUP_EXPECTED])
    expect(document.expectedProcedure.join(' ')).not.toMatch(/deliberately|GREEN → BLUE/)
  })

  it('seeks recording time for a negative offset and a later recording start', () => {
    const earlyRecording = annotationDocument({
      sessionId: 'session_1',
      runStartOffsetMs: -2000,
      durationMs: 12000,
      markers: [{
        id: 'marker_1',
        marker: 'transfer_green_to_blue',
        observationTimestamp: 4000,
        cups: ['GREEN', 'BLUE'],
        label: 'GREEN → BLUE transfer',
      }],
    })
    expect(recordingSeekSeconds(4000, -2000, 12000)).toBe(2)
    expect(recordingSeekSeconds(4000, -2000, 12000)).toBe(earlyRecording.markers[0].recordingTimestampMs / 1000)

    const lateRecording = annotationDocument({
      sessionId: 'session_1',
      runStartOffsetMs: 1500,
      durationMs: 8000,
      markers: [{
        id: 'marker_2',
        marker: 'transfer_red_to_blue',
        observationTimestamp: 1000,
        cups: ['RED', 'BLUE'],
        label: 'RED → BLUE transfer',
      }],
    })
    expect(recordingSeekSeconds(1000, 1500, 8000)).toBe(2.5)
    expect(recordingSeekSeconds(1000, 1500, 8000)).toBe(lateRecording.markers[0].recordingTimestampMs / 1000)
    expect(recordingSeekSeconds(100, -2000, 4000)).toBeNull()
  })

  it('keeps a reported GREEN to BLUE transfer separate from the expected GREEN to RED step', () => {
    const comparison = compareHumanMarker('transfer_green_to_blue')
    expect(comparison.source).toBe('human')
    expect(comparison.relation).toBe('differs from the expected transfer')
    expect(comparison.expectedStep).toBe('The second expected transfer is GREEN → RED.')
    expect(comparison.expectedStep).not.toMatch(/plan|deliberately/)
    expect(comparison.review).toMatch(/not a detected pour/)
    expect(compareHumanMarker('transfer_red_to_blue').relation).toBe('matches the expected transfer')
    expect(compareHumanMarker('green_streaks').relation).toBe('appearance report')
  })
})
