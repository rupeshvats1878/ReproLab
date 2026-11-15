import { LibraryError } from './errors.mjs'

export const CLIP_OBSERVATION_SCHEMA = 'three-cup-gemini-observation/v0.1'
export const CLIP_LIMIT_MS = 60_000
export const CLIP_LIMIT_BYTES = 14 * 1024 * 1024
export const ADAPTER_COMMIT = '119e048931069b817eb7e3a14b4f6d860a050ef5'

const SESSION_ID = /^[\w][\w.-]{0,159}$/
const REQUEST_ID = /^request_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUPS = new Set(['RED', 'GREEN', 'BLUE', 'unknown'])
const STATUSES = new Set(['observed', 'unclear', 'no_transfer', 'unavailable'])
const APPEARANCE_LABELS = new Set(['visually_uniform', 'visibly_streaked', 'unclear'])
const REQUEST_KEYS = ['sessionId', 'videoId', 'requestId', 'sourceOffsetMs', 'clipStartMs', 'clipEndMs']
const IMPORT_KEYS = [...REQUEST_KEYS, 'document', 'monitorSessionId', 'monitorVideoId']
const LINK_KEYS = [...IMPORT_KEYS, 'recordingDurationMs', 'recordingSha256', 'manifestSha256', 'confirm']
const SHA256 = /^[0-9a-f]{64}$/i
const MAX_RECORDING_MS = 24 * 60 * 60 * 1000
export const VERIFIED_CLIP = {
  path: 'C:/Users/rupes/Projects/labbench-codex-offline/server/three-cup-offline/local/integration/recording-1-review-84000-92000.mp4',
  sessionId: 'local-review-recording-1',
  videoId: 'recording-1',
  sourceOffsetMs: 84_000,
  videoDurationMs: 8_000,
  bytes: 4_065_561,
}

const latestRequest = new Map()
const recordingLinks = new Map()

export function resetClipChecks() {
  latestRequest.clear()
  recordingLinks.clear()
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

export function importAdapterReview(body) {
  const imported = validateImport(body)
  latestRequest.set(requestKey(imported.sessionId, imported.videoId), imported.requestId)
  if (imported.document.videoDurationMs !== imported.clipEndMs - imported.clipStartMs) {
    return tagged(rejectedResult(imported, 'clip-bounds', imported.document), imported.document)
  }
  return tagged(acceptAdapterResult(imported, imported.document), imported.document)
}

export function recordingAssociation(monitorVideoId) {
  return recordingLinks.get(monitorVideoId) ?? null
}

/** Associate a saved result with a selected recording. The raw document keeps its own ids. */
export function linkAdapterReview(body) {
  const spec = validateLink(body)
  if (!isCurrent(spec)) return unlinked(staleResult(spec), 'stale')
  if (spec.document.videoDurationMs !== spec.clipEndMs - spec.clipStartMs) {
    return unlinked(tagged(rejectedResult(spec, 'clip-bounds', spec.document), spec.document), 'clip-bounds')
  }
  const review = tagged(acceptAdapterResult(spec, spec.document), spec.document)
  if (review.status === 'rejected') return unlinked(review, review.reason)
  if (spec.clipEndMs > spec.recordingDurationMs) {
    return unlinked(tagged(rejectedResult(spec, 'recording-bounds', spec.document), spec.document), 'recording-bounds')
  }
  if (timesOutsideRecording(review, spec.recordingDurationMs)) {
    return unlinked(tagged(rejectedResult(spec, 'evidence-out-of-range', spec.document), spec.document), 'evidence-out-of-range')
  }
  const hash = hashKind(spec)
  if (hash.error) return unlinked(review, hash.error)
  if (!hash.kind) return unlinked(review, 'unconfirmed')
  const association = {
    kind: hash.kind,
    monitorSessionId: spec.monitorSessionId,
    monitorVideoId: spec.monitorVideoId,
    recordingDurationMs: spec.recordingDurationMs,
    sessionId: spec.sessionId,
    videoId: spec.videoId,
    sourceOffsetMs: spec.sourceOffsetMs,
    clipStartMs: spec.clipStartMs,
    clipEndMs: spec.clipEndMs,
  }
  recordingLinks.set(spec.monitorVideoId, association)
  return {
    ...review,
    linked: true,
    linkStatus: hash.kind,
    association,
    matchesOpenReview: false,
  }
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
  const requestedDuration = job.clipEndMs - job.clipStartMs
  if (document.videoDurationMs !== requestedDuration) return rejectedResult(job, 'clip-bounds', document)
  const window = clipMediaWindow(job.clipStartMs, requestedDuration)
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

function validateLink(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LibraryError('invalid', 'body')
  const keys = Object.keys(body)
  if (keys.length !== LINK_KEYS.length || LINK_KEYS.some((key) => !keys.includes(key))) {
    throw new LibraryError('invalid', 'body')
  }
  const imported = importFields(body)
  if (!Number.isInteger(body.recordingDurationMs) || body.recordingDurationMs <= 0 || body.recordingDurationMs > MAX_RECORDING_MS) {
    throw new LibraryError('invalid', 'recordingDurationMs')
  }
  if (!optionalHash(body.recordingSha256)) throw new LibraryError('invalid', 'recordingSha256')
  if (!optionalHash(body.manifestSha256)) throw new LibraryError('invalid', 'manifestSha256')
  if (typeof body.confirm !== 'boolean') throw new LibraryError('invalid', 'confirm')
  return {
    ...imported,
    recordingDurationMs: body.recordingDurationMs,
    recordingSha256: body.recordingSha256,
    manifestSha256: body.manifestSha256,
    confirm: body.confirm,
  }
}

function optionalHash(value) {
  return value === null || (typeof value === 'string' && SHA256.test(value))
}

function hashKind(spec) {
  if (spec.manifestSha256) {
    const supplied = typeof spec.recordingSha256 === 'string' ? spec.recordingSha256.toLowerCase() : ''
    if (supplied !== spec.manifestSha256.toLowerCase()) return { error: 'recording-mismatch', kind: null }
    return { error: null, kind: 'hash-verified' }
  }
  if (spec.confirm === true) return { error: null, kind: 'user-confirmed' }
  return { error: null, kind: null }
}

function timesOutsideRecording(review, durationMs) {
  const times = []
  for (const event of review.events ?? []) {
    times.push(event.eventStartMs, event.eventEndMs, ...(event.evidenceTimestampsMs ?? []))
  }
  for (const appearance of review.appearances ?? []) times.push(...(appearance.evidenceTimestampsMs ?? []))
  return times.some((value) => !Number.isInteger(value) || value < 0 || value > durationMs)
}

function unlinked(review, linkStatus) {
  return { ...review, linked: false, linkStatus, association: null, matchesOpenReview: false }
}

function validateImport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LibraryError('invalid', 'body')
  const keys = Object.keys(body)
  if (keys.length !== IMPORT_KEYS.length || IMPORT_KEYS.some((key) => !keys.includes(key))) {
    throw new LibraryError('invalid', 'body')
  }
  return importFields(body)
}

function importFields(body) {
  if (!body.document || typeof body.document !== 'object' || Array.isArray(body.document)) {
    throw new LibraryError('invalid', 'document')
  }
  if (typeof body.monitorSessionId !== 'string' || !SESSION_ID.test(body.monitorSessionId)) {
    throw new LibraryError('invalid', 'monitorSessionId')
  }
  if (!validVideoId(body.monitorVideoId)) throw new LibraryError('invalid', 'monitorVideoId')
  const job = validateClipRequest({
    sessionId: body.sessionId,
    videoId: body.videoId,
    requestId: body.requestId,
    sourceOffsetMs: body.sourceOffsetMs,
    clipStartMs: body.clipStartMs,
    clipEndMs: body.clipEndMs,
  })
  return {
    ...job,
    document: body.document,
    monitorSessionId: body.monitorSessionId,
    monitorVideoId: body.monitorVideoId,
  }
}

function validateClipRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LibraryError('invalid', 'body')
  const keys = Object.keys(body)
  if (keys.length !== REQUEST_KEYS.length || REQUEST_KEYS.some((key) => !keys.includes(key))) {
    throw new LibraryError('invalid', 'body')
  }
  if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) throw new LibraryError('invalid', 'sessionId')
  if (!validVideoId(body.videoId)) throw new LibraryError('invalid', 'videoId')
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

function validVideoId(value) {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 160 && !/[\u0000-\u001F]/.test(value)
}

function provenanceOf(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return 'adapter'
  const modelId = typeof document.modelId === 'string' ? document.modelId : ''
  if (document.synthetic === true || modelId.toLowerCase().startsWith('synthetic')) return 'synthetic'
  return 'adapter'
}

function tagged(review, document) {
  return { ...review, provenance: provenanceOf(document) }
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
    provenance: fields.provenance ?? 'adapter',
    monitorSessionId: job.monitorSessionId ?? null,
    monitorVideoId: job.monitorVideoId ?? null,
    matchesOpenReview: false,
    linked: false,
    linkStatus: null,
    association: null,
  }
}
