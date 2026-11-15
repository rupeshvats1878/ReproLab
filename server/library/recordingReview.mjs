import { LibraryError } from './errors.mjs'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PROTOCOLS = new Set(['red-blue-then-green-red', 'blue-red-then-green-blue'])
const CUPS = new Set(['RED', 'GREEN', 'BLUE', 'unknown', null])
const fail = (field) => { throw new LibraryError('invalid', field) }
function object(value, field) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field) }
function keys(value, required) { if (Object.keys(value).length !== required.length || required.some((key) => !Object.hasOwn(value, key))) fail('body') }
function id(value, prefix) { if (typeof value !== 'string' || !new RegExp(`^${prefix}_${UUID}$`, 'i').test(value)) fail('id'); return value.toLowerCase() }
function text(value, field, max = 160) { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail(field); return value }
function time(value) { if (!Number.isInteger(value) || value < 0 || value > 86_400_000) fail('observationTimestamp'); return value }
function json(value, depth = 0) {
  if (depth > 16) fail('analysis')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('analysis'); return }
  if (typeof value === 'string') { if (value.length > 12_000 || value.startsWith('data:')) fail('analysis'); return }
  if (Array.isArray(value)) { if (value.length > 250) fail('analysis'); value.forEach((item) => json(item, depth + 1)); return }
  object(value, 'analysis')
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || /api.?key|authorization|credential|base64/i.test(key)) fail('analysis')
    json(item, depth + 1)
  }
}

export function validateRecordingEvent(body) {
  object(body, 'body')
  if (body.type === 'recording_review') {
    keys(body, ['id', 'type', 'analysisId', 'eventId', 'action', 'reviewer', 'note', 'observationTimestamp'])
    if (!['confirm', 'reject'].includes(body.action)) fail('action')
    if (typeof body.note !== 'string' || body.note.length > 1000 || /[\u0000-\u001f]/.test(body.note)) fail('note')
    return { ...body, id: id(body.id, 'review'), analysisId: id(body.analysisId, 'analysis'), eventId: text(body.eventId, 'eventId'), reviewer: text(body.reviewer, 'reviewer'), observationTimestamp: time(body.observationTimestamp) }
  }
  keys(body, ['id', 'type', 'captureProtocolId', 'analysis', 'dataKind', 'observationTimestamp', 'association'])
  if (body.type !== 'recording_analysis' || !PROTOCOLS.has(body.captureProtocolId)) fail('captureProtocolId')
  if (!['real', 'synthetic'].includes(body.dataKind)) fail('dataKind')
  object(body.association, 'association')
  keys(body.association, ['sourceSha256', 'byteLength', 'durationMs', 'method'])
  if (body.association.method !== 'sha256' || !/^[0-9a-f]{64}$/.test(body.association.sourceSha256 ?? '') || !Number.isSafeInteger(body.association.byteLength) || body.association.byteLength <= 0 || !Number.isFinite(body.association.durationMs) || body.association.durationMs <= 0 || body.association.durationMs > 86_400_000) fail('association')
  const analysis = body.analysis
  object(analysis, 'analysis'); json(analysis)
  if (Buffer.byteLength(JSON.stringify(analysis)) > 350_000) fail('analysis')
  if (analysis.schemaVersion !== 'three-cup-recording-analysis/v0.1') fail('analysis')
  text(analysis.sessionId, 'analysis.sessionId'); text(analysis.videoId, 'analysis.videoId')
  object(analysis.recording, 'analysis.recording')
  const recording = analysis.recording
  time(recording.durationMs)
  if (!recording.durationMs || !Number.isSafeInteger(recording.sizeBytes) || recording.sizeBytes <= 0) fail('analysis.recording')
  if (!Array.isArray(analysis.segments) || !analysis.segments.length) fail('analysis.segments')
  const windows = analysis.segments.map((segment) => {
    object(segment, 'analysis.segment')
    const start = time(segment.sourceOffsetMs), end = time(segment.endMs), duration = time(segment.durationMs)
    if (!duration || duration > 60_000 || start + duration !== end || end > recording.durationMs || !['observed', 'unclear', 'no_transfer', 'unavailable'].includes(segment.observationStatus)) fail('analysis.segment')
    return { start, end }
  })
  object(analysis.timeline, 'analysis.timeline')
  if (!Array.isArray(analysis.timeline.events) || !Array.isArray(analysis.timeline.appearances)) fail('analysis.timeline')
  const ids = new Set()
  for (const event of analysis.timeline.events) {
    object(event, 'analysis.event'); text(event.eventId, 'eventId')
    if (ids.has(event.eventId)) fail('eventId'); ids.add(event.eventId)
    if (!CUPS.has(event.sourceCupId) || !CUPS.has(event.destinationCupId)) fail('analysis.cups')
    if (event.sourceCupId !== null && event.sourceCupId !== 'unknown' && event.sourceCupId === event.destinationCupId) fail('analysis.cups')
    if (!['observed', 'unclear'].includes(event.observationStatus) || event.needsHumanVerification !== true) fail('analysis.observationStatus')
    if (event.humanConfirmed !== undefined && typeof event.humanConfirmed !== 'boolean') fail('analysis.humanConfirmed')
    const start = time(event.eventStartMs), end = time(event.eventEndMs)
    if (start >= end || end > recording.durationMs) fail('analysis.eventTime')
    if (!Array.isArray(event.evidenceTimestampsMs) || event.evidenceTimestampsMs.some((stamp) => time(stamp) < start || stamp > end)) fail('analysis.evidenceTimestampsMs')
    const indexes = event.segmentIndexes ?? (event.segmentIndex === undefined ? [] : [event.segmentIndex])
    if (!Array.isArray(indexes) || indexes.some((index) => !Number.isInteger(index) || !windows[index])) fail('analysis.segmentIndexes')
    if (indexes.length && !indexes.some((index) => start >= windows[index].start && end <= windows[index].end)) fail('analysis.segmentIndexes')
  }
  for (const appearance of analysis.timeline.appearances) {
    object(appearance, 'analysis.appearance')
    if (!CUPS.has(appearance.cupId) || !['visually_uniform', 'visibly_streaked', 'unclear'].includes(appearance.label) || !Array.isArray(appearance.evidenceTimestampsMs) || appearance.evidenceTimestampsMs.some((stamp) => time(stamp) > recording.durationMs)) fail('analysis.appearance')
  }
  if (body.dataKind === 'real' && (analysis.synthetic === true || analysis.dataKind === 'synthetic' || analysis.timeline.events.some((event) => event.synthetic === true || event.dataKind === 'synthetic' || event.dataKind === 'mock'))) fail('dataKind')
  if (analysis.recording?.sha256 != null && (typeof analysis.recording.sha256 !== 'string' || analysis.recording.sha256.toLowerCase() !== body.association.sourceSha256)) fail('association')
  if (analysis.recording?.durationMs != null && Math.abs(analysis.recording.durationMs - body.association.durationMs) > 250) fail('association')
  if (analysis.recording.sizeBytes !== body.association.byteLength || analysis.timeline.events.some((event) => event.eventEndMs > body.association.durationMs)) fail('association')
  const knownProtocol = { 'recording-1': 'red-blue-then-green-red', 'recording-2': 'blue-red-then-green-blue' }[analysis.videoId]
  if (knownProtocol && body.captureProtocolId !== knownProtocol) fail('captureProtocolId')
  return { ...body, id: id(body.id, 'analysis'), observationTimestamp: time(body.observationTimestamp), analysis: structuredClone(analysis) }
}
