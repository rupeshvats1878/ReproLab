import { describe, expect, it } from 'vitest'
import { annotationDocument } from './threeCup.ts'

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
  })
})
