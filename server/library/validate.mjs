import { LibraryError } from './errors.mjs'

const TEXT = { title: 120, description: 500, authorDisplayName: 80 }
const SNAPSHOT_BYTES = 32_768
const MAX_DEPTH = 8
const MAX_STRING = 4_000
const MAX_KEYS = 200
const MAX_ARRAY = 200
const MAX_OFFSET = 10_000
const MEDIA_KEY = /blob|image|video|dataurl|recording/i
const PUBLISH_KEYS = ['title', 'description', 'authorDisplayName', 'approvalAcknowledged', 'protocolSnapshot']

export function validatePublish(body) {
  plainObject(body, 'body')
  exactKeys(body, PUBLISH_KEYS, 'body')
  if (body.approvalAcknowledged !== true) throw new LibraryError('approval_required')
  const protocolSnapshot = validateSnapshot(body.protocolSnapshot)
  return {
    title: displayText(body.title, 'title'),
    description: displayText(body.description, 'description'),
    authorDisplayName: displayText(body.authorDisplayName, 'authorDisplayName'),
    approvalAcknowledged: true,
    protocolSnapshot,
  }
}

export function validateReplication(body) {
  plainObject(body, 'body')
  exactKeys(body, ['experimentId'], 'body')
  return { experimentId: uuid(body.experimentId, 'experimentId') }
}

export function validateExperimentId(id) {
  return uuid(id, 'id')
}

export function validateListQuery(searchParams) {
  for (const key of searchParams.keys()) {
    if (key !== 'limit' && key !== 'offset') throw new LibraryError('invalid', key)
  }
  return {
    limit: integerParam(searchParams.get('limit'), 20, 1, 50, 'limit'),
    offset: integerParam(searchParams.get('offset'), 0, 0, MAX_OFFSET, 'offset'),
  }
}

// Temporary boundary: protocol preparation is owned by another branch.
// This accepts one JSON object and does not define protocol fields.
export function validateSnapshot(value) {
  plainObject(value, 'protocolSnapshot')
  walkJson(value, 0, 'protocolSnapshot')
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new LibraryError('invalid', 'protocolSnapshot')
  }
  if (encoded.length > SNAPSHOT_BYTES) throw new LibraryError('invalid', 'protocolSnapshot')
  return JSON.parse(encoded)
}

const EVENT_TYPES = ['human_completion', 'image_observation', 'correction']
const PROVENANCE = ['own_recording', 'imported_reference']
const MAX_JPEG_BYTES = 262144
const MAX_JPEG_BASE64 = 349528
const MAX_NOTE = 500
const MAX_MEASUREMENT = 4096

export function validateExecutionStart(body) {
  plainObject(body, 'body')
  exactKeys(body, [], 'body')
  return {}
}

export function validateExecutionFinish(body) {
  return validateExecutionStart(body)
}

export function validateExecutionEvent(body) {
  plainObject(body, 'body')
  if (!EVENT_TYPES.includes(body.type)) throw new LibraryError('invalid', 'type')
  if (body.type === 'human_completion') {
    exactKeys(body, optionalKeys(body, ['id', 'type', 'stepIndex'], ['note']), 'body')
    return {
      id: uuid(body.id, 'id'),
      type: body.type,
      stepIndex: stepIndex(body.stepIndex),
      note: body.note === undefined ? null : noteText(body.note),
    }
  }
  if (body.type === 'image_observation') {
    exactKeys(body, optionalKeys(body, ['id', 'type', 'stepIndex', 'capturedAt', 'provenance', 'imageBase64'], ['measurement']), 'body')
    if (!PROVENANCE.includes(body.provenance)) throw new LibraryError('invalid', 'provenance')
    return {
      id: uuid(body.id, 'id'),
      type: body.type,
      stepIndex: stepIndex(body.stepIndex),
      capturedAt: capturedAt(body.capturedAt),
      provenance: body.provenance,
      image: jpegImage(body.imageBase64),
      measurement: measurement(body.measurement),
    }
  }
  exactKeys(body, ['id', 'type', 'stepIndex', 'correctsEventId', 'note'], 'body')
  return {
    id: uuid(body.id, 'id'),
    type: body.type,
    stepIndex: stepIndex(body.stepIndex),
    correctsEventId: uuid(body.correctsEventId, 'correctsEventId'),
    note: noteText(body.note),
  }
}

function optionalKeys(body, required, optional) {
  return [...required, ...optional.filter((key) => Object.hasOwn(body, key))]
}

function stepIndex(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new LibraryError('invalid', 'stepIndex')
  }
  return value
}

function noteText(value) {
  if (typeof value !== 'string') throw new LibraryError('invalid', 'note')
  const text = value.trim()
  if (!text || text.length > MAX_NOTE || /[\u0000-\u001F]/.test(text)) throw new LibraryError('invalid', 'note')
  return text
}

function capturedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new LibraryError('invalid', 'capturedAt')
  }
  const year = Number(value.slice(0, 4))
  if (year < 2020 || year > 2100 || Number.isNaN(Date.parse(value))) throw new LibraryError('invalid', 'capturedAt')
  return value
}

function jpegImage(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_JPEG_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new LibraryError('invalid', 'imageBase64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (Buffer.from(bytes).toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new LibraryError('invalid', 'imageBase64')
  }
  if (
    bytes.length === 0
    || bytes.length > MAX_JPEG_BYTES
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes[2] !== 0xff
    || bytes[bytes.length - 2] !== 0xff
    || bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new LibraryError('invalid', 'imageBase64')
  }
  return { mediaType: 'image/jpeg', byteLength: bytes.length, data: value }
}

function measurement(value) {
  if (value === undefined) return null
  plainObject(value, 'measurement')
  walkMeasurement(value, 0, 'measurement')
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new LibraryError('invalid', 'measurement')
  }
  if (encoded.length > MAX_MEASUREMENT) throw new LibraryError('invalid', 'measurement')
  return JSON.parse(encoded)
}

function walkMeasurement(value, depth, field) {
  if (depth > 4) throw new LibraryError('invalid', field)
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LibraryError('invalid', field)
    return
  }
  if (typeof value === 'string') {
    if (value.length > 500 || value.startsWith('data:')) throw new LibraryError('invalid', field)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 40) throw new LibraryError('invalid', field)
    for (const item of value) walkMeasurement(item, depth + 1, field)
    return
  }
  plainObject(value, field)
  const keys = Object.keys(value)
  if (keys.length > 40) throw new LibraryError('invalid', field)
  for (const key of keys) {
    if (key.length > 40 || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new LibraryError('invalid', field)
    }
    walkMeasurement(value[key], depth + 1, field)
  }
}

function displayText(value, field) {
  if (typeof value !== 'string') throw new LibraryError('invalid', field)
  const text = value.trim()
  if (!text || text.length > TEXT[field] || /[\u0000-\u001F]/.test(text)) {
    throw new LibraryError('invalid', field)
  }
  return text
}

function uuid(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new LibraryError('invalid', field)
  }
  return value.toLowerCase()
}

function integerParam(raw, fallback, min, max, field) {
  if (raw == null) return fallback
  if (!/^\d+$/.test(raw)) throw new LibraryError('invalid', field)
  const value = Number(raw)
  if (value < min || value > max) throw new LibraryError('invalid', field)
  return value
}

function exactKeys(value, allowed, field) {
  const keys = Object.keys(value)
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new LibraryError('invalid', field)
  }
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new LibraryError('invalid', field)
  }
}

function walkJson(value, depth, field) {
  if (depth > MAX_DEPTH) throw new LibraryError('invalid', field)
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new LibraryError('invalid', field)
    return
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING || value.startsWith('data:')) throw new LibraryError('invalid', field)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) throw new LibraryError('invalid', field)
    for (const item of value) walkJson(item, depth + 1, field)
    return
  }
  plainObject(value, field)
  const keys = Object.keys(value)
  if (keys.length > MAX_KEYS) throw new LibraryError('invalid', field)
  for (const key of keys) {
    if (key.length > 80 || MEDIA_KEY.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new LibraryError('invalid', field)
    }
    walkJson(value[key], depth + 1, field)
  }
}
