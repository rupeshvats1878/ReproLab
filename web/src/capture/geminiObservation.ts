/**
 * Parser for a three-cup-gemini-observation/v0.1 document.
 * This module does not call a model and does not treat a parsed hypothesis as a detection.
 */

export const GEMINI_OBSERVATION_SCHEMA = 'three-cup-gemini-observation/v0.1'

const CUP_IDS = ['RED', 'GREEN', 'BLUE', 'unknown'] as const
const STATUSES = ['observed', 'unclear', 'no_transfer', 'unavailable'] as const

export interface GeminiTransferHypothesis {
  sourceCupId: string
  destinationCupId: string
  eventStartMs: number
  eventEndMs: number
  evidenceTimestampsMs: number[]
  observationStatus: string
  needsHumanVerification: true
}

export interface GeminiObservationReview {
  accepted: boolean
  state: 'hypothesis' | 'uncertain' | 'no-transfer' | 'unavailable' | 'rejected'
  reason: string
  events: GeminiTransferHypothesis[]
  latencyMs: number | null
}

export function reviewModelObservation(
  payload: unknown,
  expected: { sessionId: string; videoId: string },
): GeminiObservationReview {
  const rejected = (reason: string): GeminiObservationReview => ({
    accepted: false,
    state: 'rejected',
    reason,
    events: [],
    latencyMs: null,
  })
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return rejected('malformed')
  const body = payload as Record<string, unknown>
  if (body.schemaVersion !== GEMINI_OBSERVATION_SCHEMA) return rejected('malformed')
  if (typeof body.sessionId !== 'string' || typeof body.videoId !== 'string' || !Array.isArray(body.events)) return rejected('malformed')
  if (body.sessionId !== expected.sessionId || body.videoId !== expected.videoId) return rejected('wrong-session')
  const latencyMs = body.latencyMs == null ? null : body.latencyMs
  if (latencyMs != null && (typeof latencyMs !== 'number' || !Number.isInteger(latencyMs) || latencyMs < 0)) {
    return rejected('malformed')
  }
  if (body.error != null) {
    const error = body.error
    if (!error || typeof error !== 'object' || typeof (error as { category?: unknown }).category !== 'string') {
      return rejected('malformed')
    }
    return {
      accepted: false,
      state: 'unavailable',
      reason: (error as { category: string }).category,
      events: [],
      latencyMs,
    }
  }
  const status = body.observationStatus
  if (typeof status !== 'string' || !STATUSES.includes(status as (typeof STATUSES)[number])) return rejected('malformed')
  const events: GeminiTransferHypothesis[] = []
  for (const item of body.events) {
    const parsed = parseEvent(item)
    if (!parsed) return rejected('malformed')
    events.push(parsed)
  }
  if (status === 'unavailable') {
    return { accepted: false, state: 'unavailable', reason: 'unavailable', events, latencyMs }
  }
  if (status === 'no_transfer') {
    if (events.length > 0) return rejected('malformed')
    return { accepted: true, state: 'no-transfer', reason: 'model reported no visible transfer', events: [], latencyMs }
  }
  const uncertain = status === 'unclear' || events.some((event) => event.sourceCupId === 'unknown' || event.destinationCupId === 'unknown')
  if (uncertain || events.length === 0) {
    return {
      accepted: true,
      state: 'uncertain',
      reason: events.length === 0 ? 'empty events are not a no-pour result' : 'a cup is unknown or the model was unclear',
      events,
      latencyMs,
    }
  }
  return {
    accepted: true,
    state: 'hypothesis',
    reason: 'unverified model hypothesis',
    events,
    latencyMs,
  }
}

function parseEvent(value: unknown): GeminiTransferHypothesis | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const event = value as Record<string, unknown>
  if (typeof event.sourceCupId !== 'string' || !CUP_IDS.includes(event.sourceCupId as (typeof CUP_IDS)[number])) return null
  if (typeof event.destinationCupId !== 'string' || !CUP_IDS.includes(event.destinationCupId as (typeof CUP_IDS)[number])) return null
  if (typeof event.eventStartMs !== 'number' || typeof event.eventEndMs !== 'number') return null
  if (!Array.isArray(event.evidenceTimestampsMs) || event.evidenceTimestampsMs.some((item) => typeof item !== 'number')) return null
  if (typeof event.observationStatus !== 'string') return null
  if (event.needsHumanVerification !== true) return null
  return {
    sourceCupId: event.sourceCupId,
    destinationCupId: event.destinationCupId,
    eventStartMs: event.eventStartMs,
    eventEndMs: event.eventEndMs,
    evidenceTimestampsMs: event.evidenceTimestampsMs as number[],
    observationStatus: event.observationStatus,
    needsHumanVerification: true,
  }
}
