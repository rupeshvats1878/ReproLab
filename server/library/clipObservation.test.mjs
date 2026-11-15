import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { createLibraryServer } from './http.mjs'
import { createMemoryStore } from './store.mjs'
import {
  acceptAdapterResult,
  adapterArguments,
  beginClipCheck,
  finishClipCheck,
  importAdapterReview,
  linkAdapterReview,
  recordingAssociation,
  resetClipChecks,
} from './clipObservation.mjs'

const DISABLED = 'C:/Users/rupes/Projects/labbench-codex-offline/server/three-cup-offline/local/integration/adapter-disabled-response.json'

const SESSION = 'session_6a6a6a6a-6a6a-6a6a-8a6a-6a6a6a6a6a6a'
const REQUEST = 'request_6b6b6b6b-6b6b-6b6b-8b6b-6b6b6b6b6b6b'
const REQUEST_TWO = 'request_6c6c6c6c-6c6c-6c6c-8c6c-6c6c6c6c6c6c'

function jobBody(overrides = {}) {
  return {
    sessionId: SESSION,
    videoId: 'local-recording-1',
    requestId: REQUEST,
    sourceOffsetMs: 84_000,
    clipStartMs: 84_000,
    clipEndMs: 92_000,
    ...overrides,
  }
}

function adapterDocument(overrides = {}) {
  return {
    schemaVersion: 'three-cup-gemini-observation/v0.1',
    sessionId: SESSION,
    videoId: 'local-recording-1',
    sourceOffsetMs: 84_000,
    videoDurationMs: 8_000,
    needsHumanVerification: true,
    observationStatus: 'observed',
    events: [{
      sourceCupId: 'RED',
      destinationCupId: 'BLUE',
      eventStartMs: 85_000,
      eventEndMs: 86_000,
      evidenceTimestampsMs: [85_200],
      observationStatus: 'observed',
      needsHumanVerification: true,
    }],
    appearances: [],
    error: null,
    warnings: [],
    remoteCallMade: true,
    latencyMs: null,
    modelId: 'gemini-4-hydrogen',
    samplingFps: 4,
    ...overrides,
  }
}

test('a clip check waits for authorization and does not call the adapter', async () => {
  resetClipChecks()
  let calls = 0
  const runner = () => {
    calls += 1
    return adapterDocument()
  }
  const closed = await finishClipCheck(beginClipCheck(jobBody()), {
    env: { THREE_CUP_GEMINI_VIDEO_ENABLED: '1' },
    runAdapter: runner,
  })
  assert.equal(calls, 0)
  assert.equal(closed.status, 'awaiting-authorization')
  assert.equal(closed.remoteCallMade, false)
  assert.equal(closed.needsHumanVerification, true)
  assert.deepEqual(closed.events, [])

  const unconfigured = await finishClipCheck(beginClipCheck(jobBody({ requestId: REQUEST_TWO })), {
    env: { THREE_CUP_GEMINI_VIDEO_ENABLED: '1', THREE_CUP_CLIP_AUTHORIZED: '1' },
  })
  assert.equal(calls, 0)
  assert.equal(unconfigured.status, 'unavailable')
  assert.equal(unconfigured.reason, 'adapter_not_configured')
  assert.equal(unconfigured.remoteCallMade, false)
})

test('an authorized mock is not shifted again and keeps human review', async () => {
  resetClipChecks()
  const job = beginClipCheck(jobBody())
  const result = await finishClipCheck(job, {
    env: { THREE_CUP_GEMINI_VIDEO_ENABLED: '1', THREE_CUP_CLIP_AUTHORIZED: '1' },
    runAdapter: () => adapterDocument(),
  })
  assert.equal(result.status, 'hypothesis')
  assert.equal(result.events[0].eventStartMs, 85_000)
  assert.equal(result.events[0].eventEndMs, 86_000)
  assert.equal(result.raw.events[0].eventStartMs, 85_000)
  assert.equal(result.events[0].needsHumanVerification, true)
  assert.equal(result.needsHumanVerification, true)
  assert.equal(result.sourceOffsetMs, 84_000)
})

test('stale, wrong-session, and malformed adapter output is rejected', () => {
  resetClipChecks()
  const first = beginClipCheck(jobBody())
  const second = beginClipCheck(jobBody({ requestId: REQUEST_TWO }))
  assert.equal(acceptAdapterResult(first, adapterDocument()).reason, 'stale')
  assert.equal(acceptAdapterResult(second, adapterDocument({ sessionId: 'session_6d6d6d6d-6d6d-6d6d-8d6d-6d6d6d6d6d6d' })).reason, 'wrong-session')
  assert.equal(acceptAdapterResult(second, adapterDocument({ needsHumanVerification: false })).reason, 'malformed')
  assert.equal(acceptAdapterResult(second, adapterDocument({ events: [], observationStatus: 'unavailable', error: { category: 'timeout', message: 'timed out' } })).status, 'unavailable')
  assert.equal(acceptAdapterResult(second, adapterDocument({ events: [], observationStatus: 'no_transfer' })).status, 'no-transfer')
})

test('malformed event times and identical cups are rejected without shifting timestamps', () => {
  resetClipChecks()
  const zero = beginClipCheck(jobBody())
  const zeroResult = acceptAdapterResult(zero, adapterDocument({
    events: [{
      sourceCupId: 'RED',
      destinationCupId: 'BLUE',
      eventStartMs: 84_100,
      eventEndMs: 84_100,
      evidenceTimestampsMs: [],
      observationStatus: 'observed',
      needsHumanVerification: true,
    }],
  }))
  assert.equal(zeroResult.status, 'rejected')
  assert.equal(zeroResult.reason, 'zero-length')
  assert.deepEqual(zeroResult.events, [])
  assert.equal(zeroResult.raw.events[0].eventStartMs, 84_100)

  const outside = beginClipCheck(jobBody({ requestId: REQUEST_TWO }))
  const outsideDocument = adapterDocument({
    events: [{
      sourceCupId: 'RED',
      destinationCupId: 'BLUE',
      eventStartMs: 100,
      eventEndMs: 200,
      evidenceTimestampsMs: [7_000],
      observationStatus: 'observed',
      needsHumanVerification: true,
    }],
    appearances: [{
      cupId: 'GREEN',
      label: 'visibly_streaked',
      evidenceTimestampsMs: [9_000],
      needsHumanVerification: true,
    }],
  })
  const outsideResult = acceptAdapterResult(outside, outsideDocument)
  assert.equal(outsideResult.status, 'rejected')
  assert.equal(outsideResult.reason, 'outside-clip')
  assert.equal(outsideResult.raw.events[0].eventStartMs, 100)

  const sameCups = beginClipCheck(jobBody({ requestId: 'request_6d6d6d6d-6d6d-6d6d-8d6d-6d6d6d6d6d6d' }))
  const sameResult = acceptAdapterResult(sameCups, adapterDocument({
    events: [{
      sourceCupId: 'RED',
      destinationCupId: 'RED',
      eventStartMs: 85_000,
      eventEndMs: 86_000,
      evidenceTimestampsMs: [85_200],
      observationStatus: 'observed',
      needsHumanVerification: true,
    }],
  }))
  assert.equal(sameResult.status, 'rejected')
  assert.equal(sameResult.reason, 'same-cups')
})

test('evidence inside the clip but outside the event stays uncertain and unshifted', () => {
  resetClipChecks()
  const job = beginClipCheck(jobBody())
  const result = acceptAdapterResult(job, adapterDocument({
    events: [{
      sourceCupId: 'RED',
      destinationCupId: 'BLUE',
      eventStartMs: 85_000,
      eventEndMs: 86_000,
      evidenceTimestampsMs: [86_500],
      observationStatus: 'observed',
      needsHumanVerification: true,
    }],
    appearances: [{
      cupId: 'GREEN',
      label: 'visibly_streaked',
      evidenceTimestampsMs: [93_000],
      needsHumanVerification: true,
    }],
  }))
  assert.equal(result.status, 'uncertain')
  assert.equal(result.events[0].eventStartMs, 85_000)
  assert.equal(result.events[0].seekable, false)
  assert.equal(result.events[0].discrepancies.includes('evidence-outside-event'), true)
  assert.equal(result.appearances[0].label, 'unclear')
  assert.equal(result.appearances[0].rawLabel, 'visibly_streaked')
})

test('the adapter command carries the source offset once and is not built for a browser request', () => {
  assert.throws(() => adapterArguments(jobBody()), (error) => error.field === 'clipPath')
  const args = adapterArguments({ ...jobBody(), clipPath: 'C:\\clips\\short.mov' })
  assert.deepEqual(args, [
    '-m', 'gemini_adapter',
    '--video', 'C:\\clips\\short.mov',
    '--session-id', SESSION,
    '--video-id', 'local-recording-1',
    '--source-offset-ms', '84000',
    '--fps', '4',
    '--authorize',
  ])
  assert.equal(args.filter((item) => item === '--source-offset-ms').length, 1)
})

test('the library route returns authorization status and does not require a video upload', async () => {
  resetClipChecks()
  const store = createMemoryStore()
  const server = createServer(createLibraryServer({ store }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const created = await ask(server, jobBody())
    assert.equal(created.status, 200)
    assert.equal(created.body.status, 'awaiting-authorization')
    assert.equal(created.body.remoteCallMade, false)
    assert.equal(created.body.needsHumanVerification, true)
    const rejected = await ask(server, jobBody({ clipEndMs: 84_000 + 60_001, requestId: REQUEST_TWO }))
    assert.equal(rejected.status, 400)
    const extra = await ask(server, { ...jobBody(), authorize: true })
    assert.equal(extra.status, 400)
  } finally {
    server.close()
  }
})

function importBody(document, overrides = {}) {
  const sourceOffsetMs = document.sourceOffsetMs
  const duration = document.videoDurationMs
  return {
    sessionId: document.sessionId,
    videoId: document.videoId,
    requestId: REQUEST,
    sourceOffsetMs,
    clipStartMs: sourceOffsetMs,
    clipEndMs: sourceOffsetMs + duration,
    monitorSessionId: document.sessionId,
    monitorVideoId: document.videoId,
    document,
    ...overrides,
  }
}

test('an imported synthetic result stays labeled synthetic and an offset is not applied twice', () => {
  resetClipChecks()
  const document = adapterDocument({ modelId: 'synthetic-model', remoteCallMade: false })
  const matching = importAdapterReview(importBody(document))
  assert.equal(matching.status, 'hypothesis')
  assert.equal(matching.provenance, 'synthetic')
  assert.equal(matching.linked, false)
  assert.equal(matching.matchesOpenReview, false)
  assert.equal(matching.events[0].eventStartMs, 85_000)
  assert.equal(matching.raw.events[0].eventStartMs, 85_000)
  assert.equal(matching.needsHumanVerification, true)
  assert.equal(matching.remoteCallMade, false)

  const otherSession = importAdapterReview(importBody(document, {
    requestId: REQUEST_TWO,
    monitorSessionId: 'session_6d6d6d6d-6d6d-6d6d-8d6d-6d6d6d6d6d6d',
    monitorVideoId: 'local-other',
  }))
  assert.equal(otherSession.status, 'hypothesis')
  assert.equal(otherSession.matchesOpenReview, false)
  assert.equal(otherSession.events[0].eventStartMs, 85_000)

  const wrongBody = importBody(document, { requestId: 'request_6e6e6e6e-6e6e-6e6e-8e6e-6e6e6e6e6e6e' })
  wrongBody.document = { ...document, sessionId: 'other-session' }
  const wrong = importAdapterReview(wrongBody)
  assert.equal(wrong.status, 'rejected')
  assert.equal(wrong.reason, 'wrong-session')
  assert.deepEqual(wrong.events, [])

  const stale = importAdapterReview(importBody({ ...document, requestId: REQUEST }, {
    requestId: 'request_6f6f6f6f-6f6f-6f6f-8f6f-6f6f6f6f6f6f',
  }))
  assert.equal(stale.status, 'rejected')
  assert.equal(stale.reason, 'stale')

  const bounds = importAdapterReview(importBody(document, {
    requestId: 'request_70707070-7070-4070-8070-707070707070',
    clipEndMs: document.sourceOffsetMs + 1000,
  }))
  assert.equal(bounds.status, 'rejected')
  assert.equal(bounds.reason, 'clip-bounds')
})

test('the saved disabled adapter response imports as unavailable and makes no remote call', async () => {
  resetClipChecks()
  const document = JSON.parse(readFileSync(DISABLED, 'utf8'))
  const imported = importAdapterReview(importBody(document, {
    monitorSessionId: SESSION,
    monitorVideoId: 'local-4-recording.mov',
  }))
  assert.equal(imported.status, 'unavailable')
  assert.equal(imported.reason, 'remote_disabled')
  assert.equal(imported.remoteCallMade, false)
  assert.equal(imported.provenance, 'adapter')
  assert.equal(imported.matchesOpenReview, false)
  assert.equal(imported.needsHumanVerification, true)
  assert.equal(imported.raw.latencyMs, null)
  assert.deepEqual(imported.events, [])
  assert.notEqual(imported.reason, 'no-transfer')
  assert.equal(imported.raw.sourceOffsetMs, 84_000)
  assert.equal(imported.linked, false)

  const store = createMemoryStore()
  const server = createServer(createLibraryServer({ store }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await ask(server, importBody(document, {
      requestId: REQUEST_TWO,
      monitorSessionId: SESSION,
      monitorVideoId: 'local-4-recording.mov',
    }), '/clip-observations/reviews')
    assert.equal(response.status, 200)
    assert.equal(response.body.status, 'unavailable')
    assert.equal(response.body.remoteCallMade, false)
    const blocked = await ask(server, { ...importBody(document), clipPath: DISABLED }, '/clip-observations/reviews')
    assert.equal(blocked.status, 400)
  } finally {
    server.close()
  }
})

const EXTERNAL = 'local-review-recording-1'
const EXTERNAL_VIDEO = 'recording-1'
const MONITOR_VIDEO = 'local-142963865-recording 1.mov'
const OTHER_VIDEO = 'local-153475988-recording 2.mov'
const SOURCE_HASH = '322150651c2fe93fd1d746fb7e17cbf542a72d66791ecb655b84c55092b364f7'

function linkBody(document, overrides = {}) {
  return {
    ...importBody(document),
    monitorSessionId: SESSION,
    monitorVideoId: MONITOR_VIDEO,
    recordingDurationMs: 180_000,
    recordingSha256: null,
    manifestSha256: null,
    confirm: true,
    ...overrides,
  }
}

test('an external result links to a different recording without rewriting its ids', () => {
  resetClipChecks()
  const document = adapterDocument({
    sessionId: EXTERNAL,
    videoId: EXTERNAL_VIDEO,
    modelId: 'gemini-4-hydrogen',
    remoteCallMade: false,
  })
  const imported = importAdapterReview(importBody(document, {
    monitorSessionId: SESSION,
    monitorVideoId: MONITOR_VIDEO,
  }))
  assert.equal(imported.linked, false)
  assert.equal(imported.status, 'hypothesis')
  assert.equal(imported.raw.sessionId, EXTERNAL)
  assert.equal(imported.raw.videoId, EXTERNAL_VIDEO)
  assert.equal(imported.events[0].eventStartMs, 85_000)

  const pending = linkAdapterReview(linkBody(document, { confirm: false }))
  assert.equal(pending.linked, false)
  assert.equal(pending.linkStatus, 'unconfirmed')
  assert.equal(recordingAssociation(MONITOR_VIDEO), null)
  assert.equal(pending.raw.sessionId, EXTERNAL)

  const linked = linkAdapterReview(linkBody(document))
  assert.equal(linked.linked, true)
  assert.equal(linked.association.kind, 'user-confirmed')
  assert.equal(linked.association.monitorVideoId, MONITOR_VIDEO)
  assert.equal(linked.sessionId, EXTERNAL)
  assert.equal(linked.videoId, EXTERNAL_VIDEO)
  assert.equal(linked.raw.sessionId, EXTERNAL)
  assert.equal(linked.raw.videoId, EXTERNAL_VIDEO)
  assert.notEqual(linked.raw.sessionId, SESSION)
  assert.equal(linked.events[0].eventStartMs, 85_000)
  assert.equal(linked.events[0].evidenceTimestampsMs[0], 85_200)
  assert.equal(linked.needsHumanVerification, true)
  assert.equal(recordingAssociation(MONITOR_VIDEO).kind, 'user-confirmed')
  assert.equal(recordingAssociation(OTHER_VIDEO), null)

  const switched = linkAdapterReview(linkBody(document, {
    requestId: REQUEST_TWO,
    monitorVideoId: OTHER_VIDEO,
  }))
  assert.equal(switched.linked, false)
  assert.equal(switched.linkStatus, 'stale')
  assert.equal(recordingAssociation(MONITOR_VIDEO).monitorVideoId, MONITOR_VIDEO)
  assert.equal(recordingAssociation(OTHER_VIDEO), null)

  const moved = linkAdapterReview(linkBody(document, { monitorVideoId: OTHER_VIDEO }))
  assert.equal(moved.linked, true)
  assert.equal(moved.association.monitorVideoId, OTHER_VIDEO)
  assert.equal(recordingAssociation(MONITOR_VIDEO).monitorVideoId, MONITOR_VIDEO)
  assert.equal(moved.raw.videoId, EXTERNAL_VIDEO)
})

test('the link route keeps the adapter ids and does not accept a video path', async () => {
  resetClipChecks()
  const document = adapterDocument({ sessionId: EXTERNAL, videoId: EXTERNAL_VIDEO })
  const store = createMemoryStore()
  const server = createServer(createLibraryServer({ store }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const imported = await ask(server, importBody(document, {
      monitorSessionId: SESSION,
      monitorVideoId: MONITOR_VIDEO,
    }), '/clip-observations/reviews')
    assert.equal(imported.status, 200)
    assert.equal(imported.body.linked, false)
    assert.equal(imported.body.raw.sessionId, EXTERNAL)
    const linked = await ask(server, linkBody(document), '/clip-observations/reviews/links')
    assert.equal(linked.status, 200)
    assert.equal(linked.body.linked, true)
    assert.equal(linked.body.association.kind, 'user-confirmed')
    assert.equal(linked.body.raw.videoId, EXTERNAL_VIDEO)
    assert.equal(linked.body.events[0].eventStartMs, 85_000)
    const blocked = await ask(server, { ...linkBody(document), clipPath: 'C:\\clips\\short.mov' }, '/clip-observations/reviews/links')
    assert.equal(blocked.status, 400)
  } finally {
    server.close()
  }
})

test('a wrong recording and out-of-range evidence stay unlinked', () => {
  resetClipChecks()
  const document = adapterDocument({ sessionId: EXTERNAL, videoId: EXTERNAL_VIDEO })
  importAdapterReview(importBody(document, {
    monitorSessionId: SESSION,
    monitorVideoId: MONITOR_VIDEO,
  }))
  const mismatch = linkAdapterReview(linkBody(document, {
    recordingSha256: 'ab'.repeat(32),
    manifestSha256: SOURCE_HASH,
    confirm: true,
  }))
  assert.equal(mismatch.linked, false)
  assert.equal(mismatch.linkStatus, 'recording-mismatch')
  assert.equal(mismatch.raw.sessionId, EXTERNAL)
  assert.equal(recordingAssociation(MONITOR_VIDEO), null)

  const verified = linkAdapterReview(linkBody(document, {
    recordingSha256: SOURCE_HASH.toUpperCase(),
    manifestSha256: SOURCE_HASH,
    confirm: false,
  }))
  assert.equal(verified.linked, true)
  assert.equal(verified.association.kind, 'hash-verified')
  assert.equal(verified.raw.videoId, EXTERNAL_VIDEO)
  assert.equal(verified.events[0].eventStartMs, 85_000)

  resetClipChecks()
  importAdapterReview(importBody(document, {
    monitorSessionId: SESSION,
    monitorVideoId: MONITOR_VIDEO,
  }))
  const short = linkAdapterReview(linkBody(document, { recordingDurationMs: 8_000 }))
  assert.equal(short.linked, false)
  assert.equal(short.status, 'rejected')
  assert.equal(short.linkStatus, 'recording-bounds')
  assert.equal(short.raw.events[0].evidenceTimestampsMs[0], 85_200)
  assert.equal(85_200 > 8_000, true)
  assert.deepEqual(short.events, [])

  resetClipChecks()
  const ranged = adapterDocument({
    sessionId: EXTERNAL,
    videoId: EXTERNAL_VIDEO,
    appearances: [{
      cupId: 'GREEN',
      label: 'visually_uniform',
      evidenceTimestampsMs: [100_000],
      needsHumanVerification: true,
    }],
  })
  importAdapterReview(importBody(ranged, {
    monitorSessionId: SESSION,
    monitorVideoId: MONITOR_VIDEO,
  }))
  const outside = linkAdapterReview(linkBody(ranged, { recordingDurationMs: 95_000 }))
  assert.equal(outside.linked, false)
  assert.equal(outside.linkStatus, 'evidence-out-of-range')
  assert.deepEqual(outside.events, [])
  assert.equal(outside.raw.appearances[0].evidenceTimestampsMs[0], 100_000)
  assert.equal(outside.raw.sessionId, EXTERNAL)
})

function ask(server, body, path = '/clip-observations') {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}
