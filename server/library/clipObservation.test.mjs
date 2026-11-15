import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { createLibraryServer } from './http.mjs'
import { createMemoryStore } from './store.mjs'
import {
  acceptAdapterResult,
  adapterArguments,
  beginClipCheck,
  finishClipCheck,
  resetClipChecks,
} from './clipObservation.mjs'

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

function ask(server, body) {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path: '/clip-observations',
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
