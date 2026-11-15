/**
 * Parser for a three-cup-gemini-observation/v0.1 document.
 * This module does not call a model and does not treat a parsed hypothesis as a detection.
 * Event times are already original-media times. This parser does not add sourceOffsetMs.
 */

export const GEMINI_OBSERVATION_SCHEMA = 'three-cup-gemini-observation/v0.1'

const CUP_IDS = ['RED', 'GREEN', 'BLUE', 'unknown'] as const
const STATUSES = ['observed', 'unclear', 'no_transfer', 'unavailable'] as const
const EVENT_STATUSES = ['observed', 'unclear'] as const

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
  raw: unknown
}

export function reviewModelObservation(
  payload: unknown,
  expected: { sessionId: string; videoId: string },
): GeminiObservationReview {
  const raw = cloneRaw(payload)
  const rejected = (reason: string): GeminiObservationReview => ({
    accepted: false,
    state: 'rejected',
    reason,
    events: [],
    latencyMs: null,
    raw,
  })
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return rejected('malformed')
  const body = payload as Record<string, unknown>
  if (body.schemaVersion !== GEMINI_OBSERVATION_SCHEMA) return rejected('malformed')
  if (typeof body.sessionId !== 'string' || typeof body.videoId !== 'string' || !Array.isArray(body.events)) return rejected('malformed')
  if (body.sessionId !== expected.sessionId || body.videoId !== expected.videoId) return rejected('wrong-session')
  const latencyMs = body.latencyMs == null ? null : body.latencyMs
  if (latencyMs != null && (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0)) {
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
      raw,
    }
  }
  const status = body.observationStatus
  if (typeof status !== 'string' || !STATUSES.includes(status as (typeof STATUSES)[number])) return rejected('malformed')
  const window = mediaWindow(body)
  const events: GeminiTransferHypothesis[] = []
  let eventUncertain = false
  for (const item of body.events) {
    const parsed = parseEvent(item, window)
    if (!parsed.ok) return rejected(parsed.reason)
    events.push(parsed.event)
    eventUncertain = eventUncertain || parsed.uncertain
  }
  if (status === 'unavailable') {
    return { accepted: false, state: 'unavailable', reason: 'unavailable', events, latencyMs, raw }
  }
  if (status === 'no_transfer') {
    if (events.length > 0) return rejected('malformed')
    return { accepted: true, state: 'no-transfer', reason: 'model reported no visible transfer', events: [], latencyMs, raw }
  }
  const uncertain = status === 'unclear' || eventUncertain || events.length === 0
  if (uncertain) {
    return {
      accepted: true,
      state: 'uncertain',
      reason: events.length === 0 ? 'empty events are not a no-pour result' : 'a cup is unknown or the model was unclear',
      events,
      latencyMs,
      raw,
    }
  }
  return {
    accepted: true,
    state: 'hypothesis',
    reason: 'unverified model hypothesis',
    events,
    latencyMs,
    raw,
  }
}

function parseEvent(
  value: unknown,
  window: { startMs: number; endMs: number } | null,
): { ok: true; event: GeminiTransferHypothesis; uncertain: boolean } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'malformed' }
  const event = value as Record<string, unknown>
  if (typeof event.sourceCupId !== 'string' || !CUP_IDS.includes(event.sourceCupId as (typeof CUP_IDS)[number])) return { ok: false, reason: 'malformed' }
  if (typeof event.destinationCupId !== 'string' || !CUP_IDS.includes(event.destinationCupId as (typeof CUP_IDS)[number])) return { ok: false, reason: 'malformed' }
  if (!isFiniteTime(event.eventStartMs) || !isFiniteTime(event.eventEndMs)) return { ok: false, reason: 'malformed' }
  if (!Array.isArray(event.evidenceTimestampsMs) || event.evidenceTimestampsMs.some((item) => !isFiniteTime(item))) return { ok: false, reason: 'malformed' }
  if (typeof event.observationStatus !== 'string' || !EVENT_STATUSES.includes(event.observationStatus as (typeof EVENT_STATUSES)[number])) {
    return { ok: false, reason: 'malformed' }
  }
  if (event.needsHumanVerification !== true) return { ok: false, reason: 'malformed' }
  const evidence = event.evidenceTimestampsMs as number[]
  if (event.sourceCupId === event.destinationCupId) return { ok: false, reason: 'same-cups' }
  if (event.eventStartMs < 0 || event.eventEndMs < 0 || evidence.some((item) => item < 0)) return { ok: false, reason: 'negative-time' }
  if (event.eventEndMs < event.eventStartMs) return { ok: false, reason: 'reversed-interval' }
  if (event.eventEndMs === event.eventStartMs) return { ok: false, reason: 'zero-length' }
  if (!window) return { ok: false, reason: 'malformed' }
  const times = [event.eventStartMs, event.eventEndMs, ...evidence]
  if (times.some((item) => item < window.startMs || item > window.endMs)) return { ok: false, reason: 'outside-clip' }
  return {
    ok: true,
    uncertain: event.observationStatus === 'unclear' || event.sourceCupId === 'unknown' || event.destinationCupId === 'unknown',
    event: {
      sourceCupId: event.sourceCupId,
      destinationCupId: event.destinationCupId,
      eventStartMs: event.eventStartMs,
      eventEndMs: event.eventEndMs,
      evidenceTimestampsMs: evidence.slice(),
      observationStatus: event.observationStatus,
      needsHumanVerification: true,
    },
  }
}

function mediaWindow(body: Record<string, unknown>): { startMs: number; endMs: number } | null {
  if (!isFiniteTime(body.sourceOffsetMs) || !isFiniteTime(body.videoDurationMs)) return null
  if (body.sourceOffsetMs < 0 || body.videoDurationMs < 0) return null
  return { startMs: body.sourceOffsetMs, endMs: body.sourceOffsetMs + body.videoDurationMs }
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cloneRaw(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null
  return structuredClone(payload)
}
