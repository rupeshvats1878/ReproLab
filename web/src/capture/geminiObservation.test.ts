import { describe, expect, it } from 'vitest'
import { reviewModelObservation } from './geminiObservation.ts'

const expected = { sessionId: 'session_1', videoId: 'recording-1' }

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'three-cup-gemini-observation/v0.1',
    sessionId: 'session_1',
    videoId: 'recording-1',
    events: [
      {
        sourceCupId: 'RED',
        destinationCupId: 'BLUE',
        eventStartMs: 1200,
        eventEndMs: 3400,
        evidenceTimestampsMs: [1500],
        observationStatus: 'observed',
        needsHumanVerification: true,
      },
    ],
    observationStatus: 'observed',
    latencyMs: 45000,
    error: null,
    sourceOffsetMs: 0,
    videoDurationMs: 20000,
    ...overrides,
  }
}

describe('gemini observation review', () => {
  it('keeps a delayed hypothesis unverified', () => {
    const review = reviewModelObservation(payload(), expected)
    expect(review.state).toBe('hypothesis')
    expect(review.reason).toMatch(/unverified/)
    expect(review.latencyMs).toBe(45000)
    expect(review.events[0]?.needsHumanVerification).toBe(true)
  })

  it('rejects a response for a different session', () => {
    const review = reviewModelObservation(payload({ sessionId: 'session_2' }), expected)
    expect(review).toMatchObject({ accepted: false, state: 'rejected', reason: 'wrong-session', events: [] })
  })

  it('treats an unknown cup as uncertain rather than a detection', () => {
    const review = reviewModelObservation(payload({
      observationStatus: 'unclear',
      events: [{
        sourceCupId: 'unknown',
        destinationCupId: 'BLUE',
        eventStartMs: 1,
        eventEndMs: 2,
        evidenceTimestampsMs: [],
        observationStatus: 'unclear',
        needsHumanVerification: true,
      }],
    }), expected)
    expect(review.state).toBe('uncertain')
  })

  it('rejects malformed output and an empty unavailable list is not a no-pour', () => {
    expect(reviewModelObservation({ schemaVersion: 'three-cup-gemini-observation/v0.1' }, expected).reason).toBe('malformed')
    const unavailable = reviewModelObservation(payload({
      events: [],
      observationStatus: 'unavailable',
      error: { category: 'timeout', message: 'timed out' },
    }), expected)
    expect(unavailable.state).toBe('unavailable')
    expect(unavailable.reason).toBe('timeout')
    expect(unavailable.events).toEqual([])
  })

  it('keeps an explicit no-transfer claim separate from a service failure', () => {
    const claim = reviewModelObservation(payload({ events: [], observationStatus: 'no_transfer', error: null }), expected)
    expect(claim.state).toBe('no-transfer')
    const failed = reviewModelObservation(payload({
      events: [],
      observationStatus: 'unavailable',
      error: { category: 'model_unavailable', message: 'down' },
    }), expected)
    expect(failed.state).toBe('unavailable')
    expect(failed.reason).not.toBe('no-transfer')
  })
})
