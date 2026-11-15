import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { createLibraryServer } from './http.mjs'
import { createMemoryStore } from './store.mjs'

const SESSION = 'session_4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a'

function listen(store) {
  const server = createServer(createLibraryServer({ store }))
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function ask(server, method, path, body) {
  const payload = body == null ? null : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers: payload == null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, body: JSON.parse(text) })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const { parseRecordingAnalysis } = await import(new URL('../../web/src/capture/recordingAnalysis.ts', import.meta.url))

const ANALYSIS_ID = 'analysis_11111111-1111-4111-8111-111111111111'
const REVIEW_ID = 'review_22222222-2222-4222-8222-222222222222'
function analysisEvent(overrides = {}) {
  return {
    id: ANALYSIS_ID, type: 'recording_analysis', observationTimestamp: 0,
    captureProtocolId: 'blue-red-then-green-blue', dataKind: 'synthetic',
    association: { sourceSha256: 'a'.repeat(64), byteLength: 1000, durationMs: 10000, method: 'sha256' },
    analysis: {
      schemaVersion: 'three-cup-recording-analysis/v0.1', sessionId: 'synthetic-source', videoId: 'recording-2',
      recording: { durationMs: 10000, sizeBytes: 1000 }, segments: [{ sourceOffsetMs: 0, durationMs: 10000, endMs: 10000, observationStatus: 'observed' }], coverageComplete: false,
      timeline: { events: [{ eventId: 'first', sourceCupId: 'GREEN', destinationCupId: 'BLUE', eventStartMs: 100, eventEndMs: 200, evidenceTimestampsMs: [150], observationStatus: 'observed', needsHumanVerification: true }], appearances: [] },
    }, ...overrides,
  }
}
const review = (overrides = {}) => ({ id: REVIEW_ID, type: 'recording_review', analysisId: ANALYSIS_ID, eventId: 'first', action: 'confirm', reviewer: 'Synthetic reviewer', note: 'Synthetic pair check, not model truth.', observationTimestamp: 200, ...overrides })
async function openCapture(server, extra = {}) {
  return ask(server, 'POST', '/monitor-sessions', { sessionId: SESSION, sourceKind: 'synthetic', procedureId: 'three-cup-capture', captureProtocolId: 'blue-red-then-green-blue', ...extra })
}

test('recording2 analysis, association and append-only reviews survive Results and Library publication', async () => {
  const server = await listen(createMemoryStore())
  try {
    assert.equal((await openCapture(server)).status, 201)
    const original = analysisEvent()
    const saved = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, original)
    assert.equal(saved.status, 201)
    assert.deepEqual(saved.body.recordingAnalyses[0].analysis, original.analysis)
    assert.equal(parseRecordingAnalysis(saved.body.recordingAnalyses[0].analysis).events.length, 1)
    assert.equal(saved.body.recordingAnalyses[0].provenance, 'synthetic')
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, original)).status, 200)
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, analysisEvent({ observationTimestamp: 1 }))).status, 409)
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, review())).status, 201)
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, review({ id: 'review_33333333-3333-4333-8333-333333333333', action: 'reject' }))).status, 201)
    const read = await ask(server, 'GET', `/monitor-sessions/${SESSION}`)
    assert.equal(read.body.recordingReviews.length, 2)
    assert.equal(read.body.recordingReviews[0].provenance, 'human')
    assert.deepEqual(read.body.recordingAnalyses[0].analysis, original.analysis)
    await ask(server, 'POST', `/monitor-sessions/${SESSION}/finish`, {})
    const published = await ask(server, 'POST', `/monitor-sessions/${SESSION}/publish`, { notes: 'Synthetic review persistence test.' })
    assert.equal(published.status, 201)
    assert.equal(published.body.kind, 'demonstration')
    assert.equal(published.body.runRecord.captureProtocolId, 'blue-red-then-green-blue')
    assert.deepEqual(published.body.runRecord.recordingAnalyses[0].analysis, original.analysis)
    assert.equal(published.body.runRecord.recordingReviews.length, 2)
    const opened = await ask(server, 'GET', `/experiments/${published.body.id}`)
    assert.equal(opened.body.runRecord.recordingReviews[1].action, 'reject')
  } finally { server.close() }
})

test('recording persistence rejects wrong protocol, wrong event linkage, promoted synthetic, and media mismatch', async () => {
  const server = await listen(createMemoryStore())
  try {
    await openCapture(server)
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, analysisEvent({ captureProtocolId: 'red-blue-then-green-red' }))).status, 400)
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, review())).status, 400)
    const badHash = analysisEvent(); badHash.analysis.recording.sha256 = 'b'.repeat(64)
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, badHash)).status, 400)
    const promoted = analysisEvent({ dataKind: 'real' }); promoted.analysis.dataKind = 'synthetic'
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, promoted)).status, 400)
    await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, analysisEvent())
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, review({ eventId: 'other-recording-event' }))).status, 400)
    const six = 'session_66666666-6666-4666-8666-666666666666'
    await ask(server, 'POST', '/monitor-sessions', { sessionId: six, sourceKind: 'synthetic' })
    assert.equal((await ask(server, 'POST', `/monitor-sessions/${six}/events`, analysisEvent())).status, 409)
  } finally { server.close() }
})

test('server rejects imported analyses that Results cannot read and mismatched recording associations', async () => {
  const server = await listen(createMemoryStore())
  try {
    await openCapture(server)
    for (const change of [
      a => { delete a.analysis.recording.sizeBytes },
      a => { a.analysis.segments = [] },
      a => { delete a.analysis.timeline.events[0].eventStartMs },
      a => { a.analysis.timeline.events[0].eventEndMs = 50 },
      a => { delete a.analysis.timeline.events[0].needsHumanVerification },
      a => { a.analysis.timeline.events[0].evidenceTimestampsMs = [500] },
      a => { a.association.byteLength = 999 },
      a => { a.association.durationMs = 10300 },
    ]) {
      const body = analysisEvent(); change(body)
      assert.equal((await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, body)).status, 400)
    }
    assert.equal((await ask(server, 'GET', `/monitor-sessions/${SESSION}`)).body.recordingAnalyses.length, 0)
  } finally { server.close() }
})
