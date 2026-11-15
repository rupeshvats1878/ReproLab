import { LibraryError } from './errors.mjs'

export const CLIP_OBSERVATION_SCHEMA = 'three-cup-gemini-observation/v0.1'
export const CLIP_LIMIT_MS = 60_000
export const CLIP_LIMIT_BYTES = 14 * 1024 * 1024
export const ADAPTER_COMMIT = 'a34c5a6b9dc29c5bdf9f8f382c48755c98c3d1c6'

const SESSION_ID = /^[\w][\w.-]{0,159}$/
const REQUEST_ID = /^request_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUPS = new Set(['RED', 'GREEN', 'BLUE', 'unknown'])
const STATUSES = new Set(['observed', 'unclear', 'no_transfer', 'unavailable'])
const APPEARANCE_LABELS = new Set(['visually_uniform', 'visibly_streaked', 'unclear'])
const REQUEST_KEYS = ['sessionId', 'videoId', 'requestId', 'sourceOffsetMs', 'clipStartMs', 'clipEndMs']

const latestRequest = new Map()

export function resetClipChecks() {
  latestRequest.clear()
}

export function beginClipCheck(body) {
  const job = validateClipRequest(body)
  latestRequest.set(requestKey(job.sessionId, job.videoId), job.requestId)
  return job
}

export async function finishClipCheck(job, options = {}) {
  if (!isCurrent(job)) return staleResult(job)
  const env = options.env ?? {}
  if (!remoteGatesOpen(env)) return awaitingResult(job)
  if (typeof options.runAdapter !== 'function') {
    return unavailableResult(job, 'adapter_not_configured', 'The local adapter is not configured. No video was sent.')
  }
  const document = await options.runAdapter(job)
  if (!isCurrent(job)) return staleResult(job)
  return acceptAdapterResult(job, document)
}

export function remoteGatesOpen(env) {
  return enabled(env.THREE_CUP_GEMINI_VIDEO_ENABLED) && String(env.THREE_CUP_CLIP_AUTHORIZED ?? '').trim() === '1'
}

export function adapterArguments(job) {
  if (typeof job.clipPath !== 'string' || job.clipPath.trim() === '') {
    throw new LibraryError('invalid', 'clipPath')
  }
  return [
    '-m', 'gemini_adapter',
    '--video', job.clipPath,
    '--session-id', job.sessionId,
    '--video-id', job.videoId,
    '--source-offset-ms', String(job.sourceOffsetMs),
    '--fps', '4',
    '--authorize',
  ]
}

export function acceptAdapterResult(job, document, responseRequestId) {
  const responseId = responseRequestId ?? requestIdOf(document) ?? job.requestId
  if (responseId !== job.requestId || !isCurrent(job)) return staleResult(job)
  if (!document || typeof document !== 'object' || Array.isArray(document)) return rejectedResult(job, 'malformed', document)
  if (document.schemaVersion !== CLIP_OBSERVATION_SCHEMA) return rejectedResult(job, 'malformed', document)
  if (document.sessionId !== job.sessionId || document.videoId !== job.videoId) return rejectedResult(job, 'wrong-session', document)
  if (document.requestId != null && document.requestId !== job.requestId) return rejectedResult(job, 'stale', document)
  if (document.needsHumanVerification !== true) return rejectedResult(job, 'malformed', document)
  if (document.sourceOffsetMs !== job.sourceOffsetMs) return rejectedResult(job, 'malformed', document)
  if (!Array.isArray(document.events) || !Array.isArray(document.appearances ?? [])) return rejectedResult(job, 'malformed', document)
  const durationMs = document.videoDurationMs
  if (durationMs != null && (!Number.isInteger(durationMs) || durationMs < 0)) return rejectedResult(job, 'malformed', document)
  const window = clipMediaWindow(job.sourceOffsetMs, durationMs)
  const events = []
  for (const [index, item] of document.events.entries()) {
    const parsed = parseEvent(item, window)
    if (!parsed || parsed.error) return rejectedResult(job, parsed?.error ?? 'malformed', document)
    events.push({ eventId: `${job.requestId}:${index}`, requestId: job.requestId, index, ...parsed })
  }
  const appearances = []
  for (const item of document.appearances ?? []) {
    const parsed = parseAppearance(item, window)
    if (!parsed) return rejectedResult(job, 'malformed', document)
    appearances.push(parsed)
  }
  if (document.error != null) {
    if (!document.error || typeof document.error.category !== 'string') return rejectedResult(job, 'malformed', document)
    return result(job, {
      status: 'unavailable',
      reason: document.error.category,
      events: [],
      appearances: [],
      raw: structuredClone(document),
      remoteCallMade: document.remoteCallMade === true,
      warnings: warningList(document.warnings),
    })
  }
  const status = document.observationStatus
  if (!STATUSES.has(status)) return rejectedResult(job, 'malformed', document)
  if (status === 'no_transfer' && events.length > 0) return rejectedResult(job, 'malformed', document)
  if (status === 'unavailable') {
    return result(job, { status: 'unavailable', reason: 'unavailable', events, appearances, raw: structuredClone(document), remoteCallMade: document.remoteCallMade === true, warnings: warningList(document.warnings) })
  }
  if (status === 'no_transfer') {
    return result(job, { status: 'no-transfer', reason: 'model reported no visible transfer', events: [], appearances, raw: structuredClone(document), remoteCallMade: document.remoteCallMade === true, warnings: warningList(document.warnings) })
  }
  const uncertain = status === 'unclear'
    || events.length === 0
    || events.some((event) => event.review !== 'pending-clean')
    || appearances.some((item) => item.review !== 'pending-clean')
  return result(job, {
    status: uncertain ? 'uncertain' : 'hypothesis',
    reason: uncertain ? 'needs human review' : 'unverified model hypothesis',
    events,
    appearances,
    raw: structuredClone(document),
    remoteCallMade: document.remoteCallMade === true,
    warnings: warningList(document.warnings),
  })
}

function validateClipRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LibraryError('invalid', 'body')
  const keys = Object.keys(body)
  if (keys.length !== REQUEST_KEYS.length || REQUEST_KEYS.some((key) => !keys.includes(key))) {
    throw new LibraryError('invalid', 'body')
  }
  if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) throw new LibraryError('invalid', 'sessionId')
  if (typeof body.videoId !== 'string' || body.videoId.trim() === '' || body.videoId.length > 160 || /[\u0000-\u001F]/.test(body.videoId)) {
    throw new LibraryError('invalid', 'videoId')
  }
  if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) throw new LibraryError('invalid', 'requestId')
  for (const field of ['sourceOffsetMs', 'clipStartMs', 'clipEndMs']) {
    if (!Number.isInteger(body[field]) || body[field] < 0) throw new LibraryError('invalid', field)
  }
  if (body.sourceOffsetMs !== body.clipStartMs) throw new LibraryError('invalid', 'sourceOffsetMs')
  const duration = body.clipEndMs - body.clipStartMs
  if (duration <= 0 || duration > CLIP_LIMIT_MS) throw new LibraryError('invalid', 'clipEndMs')
  return {
    sessionId: body.sessionId,
    videoId: body.videoId,
    requestId: body.requestId,
    sourceOffsetMs: body.sourceOffsetMs,
    clipStartMs: body.clipStartMs,
    clipEndMs: body.clipEndMs,
  }
}

function parseEvent(item, window) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  if (!CUPS.has(item.sourceCupId) || !CUPS.has(item.destinationCupId)) return null
  if (!Number.isInteger(item.eventStartMs) || !Number.isInteger(item.eventEndMs)) return null
  if (!Array.isArray(item.evidenceTimestampsMs) || item.evidenceTimestampsMs.some((value) => !Number.isInteger(value))) return null
  if (item.observationStatus !== 'observed' && item.observationStatus !== 'unclear') return null
  if (item.needsHumanVerification !== true) return null
  if (item.sourceCupId === item.destinationCupId) return { error: 'same-cups' }
  if (item.eventStartMs < 0 || item.eventEndMs < 0 || item.evidenceTimestampsMs.some((value) => value < 0)) return { error: 'negative-time' }
  if (item.eventEndMs < item.eventStartMs) return { error: 'reversed-interval' }
  if (item.eventEndMs === item.eventStartMs) return { error: 'zero-length' }
  if (!window) return { error: 'malformed' }
  const outsideClip = !insideWindow(item.eventStartMs, window) || !insideWindow(item.eventEndMs, window)
    || item.evidenceTimestampsMs.some((value) => !insideWindow(value, window))
  if (outsideClip) return { error: 'outside-clip' }
  const discrepancies = []
  const outsideEvent = item.evidenceTimestampsMs.some((value) => value < item.eventStartMs || value > item.eventEndMs)
  if (outsideEvent) discrepancies.push('evidence-outside-event')
  const unknownCup = item.sourceCupId === 'unknown' || item.destinationCupId === 'unknown'
  const review = discrepancies.length === 0 && !unknownCup && item.observationStatus === 'observed' ? 'pending-clean' : 'needs-review'
  return {
    sourceCupId: item.sourceCupId === 'unknown' ? null : item.sourceCupId,
    destinationCupId: item.destinationCupId === 'unknown' ? null : item.destinationCupId,
    rawSourceCupId: item.sourceCupId,
    rawDestinationCupId: item.destinationCupId,
    eventStartMs: item.eventStartMs,
    eventEndMs: item.eventEndMs,
    evidenceTimestampsMs: [...item.evidenceTimestampsMs],
    seekable: discrepancies.length === 0,
    discrepancies,
    needsHumanVerification: true,
    review,
  }
}

function parseAppearance(item, window) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  if (!CUPS.has(item.cupId) || !APPEARANCE_LABELS.has(item.label)) return null
  if (!Array.isArray(item.evidenceTimestampsMs) || item.evidenceTimestampsMs.some((value) => !Number.isInteger(value))) return null
  if (item.needsHumanVerification !== true) return null
  const outsideClip = item.evidenceTimestampsMs.some((value) => !insideWindow(value, window))
  return {
    cupId: item.cupId === 'unknown' ? null : item.cupId,
    label: outsideClip ? 'unclear' : item.label,
    rawLabel: item.label,
    evidenceTimestampsMs: [...item.evidenceTimestampsMs],
    seekable: !outsideClip && item.evidenceTimestampsMs.length > 0,
    discrepancies: outsideClip ? ['outside-clip'] : [],
    needsHumanVerification: true,
    review: outsideClip || item.label === 'unclear' ? 'needs-review' : 'pending-clean',
  }
}

function clipMediaWindow(sourceOffsetMs, durationMs) {
  if (!Number.isInteger(durationMs)) return null
  return { startMs: sourceOffsetMs, endMs: sourceOffsetMs + durationMs }
}

function insideWindow(value, window) {
  if (!window) return false
  return value >= window.startMs && value <= window.endMs
}

function requestKey(sessionId, videoId) {
  return `${sessionId}\0${videoId}`
}

function isCurrent(job) {
  return latestRequest.get(requestKey(job.sessionId, job.videoId)) === job.requestId
}

function requestIdOf(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return undefined
  return typeof document.requestId === 'string' ? document.requestId : undefined
}

function enabled(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase())
}

function warningList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function awaitingResult(job) {
  return result(job, {
    status: 'awaiting-authorization',
    reason: 'remote_disabled',
    events: [],
    appearances: [],
    raw: null,
    remoteCallMade: false,
    warnings: [],
  })
}

function unavailableResult(job, category, message) {
  return result(job, {
    status: 'unavailable',
    reason: category,
    message,
    events: [],
    appearances: [],
    raw: null,
    remoteCallMade: false,
    warnings: [],
  })
}

function staleResult(job) {
  return result(job, {
    status: 'rejected',
    reason: 'stale',
    events: [],
    appearances: [],
    raw: null,
    remoteCallMade: false,
    warnings: [],
  })
}

function rejectedResult(job, reason, document = null) {
  return result(job, {
    status: 'rejected',
    reason,
    events: [],
    appearances: [],
    raw: document && typeof document === 'object' ? structuredClone(document) : null,
    remoteCallMade: false,
    warnings: [],
  })
}

function result(job, fields) {
  return {
    requestId: job.requestId,
    sessionId: job.sessionId,
    videoId: job.videoId,
    clipStartMs: job.clipStartMs,
    clipEndMs: job.clipEndMs,
    sourceOffsetMs: job.sourceOffsetMs,
    status: fields.status,
    reason: fields.reason,
    message: fields.message ?? null,
    needsHumanVerification: true,
    remoteCallMade: fields.remoteCallMade,
    events: fields.events,
    appearances: fields.appearances,
    warnings: fields.warnings,
    raw: fields.raw,
  }
}
