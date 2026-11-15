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

test('a three-cup capture stores human markers and rejects six-well judgments', async () => {
  const server = await listen(createMemoryStore())
  try {
    const created = await ask(server, 'POST', '/monitor-sessions', {
      sessionId: SESSION,
      sourceKind: 'live',
      procedureId: 'three-cup-capture',
      startedAtIso: '2026-11-14T23:20:00.000Z',
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.procedureId, 'three-cup-capture')
    assert.equal(created.body.protocol.id, 'three-cup-capture')
    assert.deepEqual(created.body.protocol.order, ['RED', 'GREEN', 'BLUE'])

    const observation = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: 'obs_4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b',
      type: 'observation',
      observationTimestamp: 1000,
      rawState: { A1: 'unknown', A2: 'unknown', A3: 'unknown', B1: 'unknown', B2: 'unknown', B3: 'unknown' },
      stableState: { A1: 'unknown', A2: 'unknown', A3: 'unknown', B1: 'unknown', B2: 'unknown', B3: 'unknown' },
    })
    assert.equal(observation.status, 409)

    const marker = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: 'marker_4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c',
      type: 'human_marker',
      marker: 'transfer_green_to_blue',
      observationTimestamp: 4000,
    })
    assert.equal(marker.status, 201)
    assert.equal(marker.body.humanMarkers[0].provenance, 'human')
    assert.deepEqual(marker.body.humanMarkers[0].cups, ['GREEN', 'BLUE'])
    assert.equal(marker.body.humanMarkers[0].observationTimestamp, 4000)

    const outside = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: 'marker_4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d',
      type: 'human_marker',
      marker: 'green_streaks',
      observationTimestamp: 100,
    })
    assert.equal(outside.status, 201)

    await ask(server, 'POST', `/monitor-sessions/${SESSION}/finish`, {})
    const published = await ask(server, 'POST', `/monitor-sessions/${SESSION}/publish`, { notes: 'Operator reports only.' })
    assert.equal(published.status, 201)
    assert.equal(published.body.protocolSnapshot.id, 'three-cup-capture')
    assert.equal(published.body.runRecord.procedureId, 'three-cup-capture')
    assert.equal(published.body.runRecord.humanMarkers[0].provenance, 'human')
    assert.equal(published.body.runRecord.observations.length, 0)
    assert.equal(published.body.protocolSnapshot.steps[0].instruction.includes('GREEN'), true)
    assert.equal(published.body.protocolSnapshot.steps.some((step) => /deliberately|GREEN → BLUE/.test(step.instruction)), false)

    const sixWell = 'session_4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e'
    await ask(server, 'POST', '/monitor-sessions', { sessionId: sixWell, sourceKind: 'live' })
    const rejected = await ask(server, 'POST', `/monitor-sessions/${sixWell}/events`, {
      id: 'marker_4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f',
      type: 'human_marker',
      marker: 'green_streaks',
      observationTimestamp: 1000,
    })
    assert.equal(rejected.status, 409)
  } finally {
    server.close()
  }
})

test('a capture session freezes the selected procedure and keeps an older session on the first procedure', async () => {
  const server = await listen(createMemoryStore())
  const second = 'session_5a5a5a5a-5a5a-5a5a-8a5a-5a5a5a5a5a5a'
  try {
    const created = await ask(server, 'POST', '/monitor-sessions', {
      sessionId: second,
      sourceKind: 'prerecorded',
      procedureId: 'three-cup-capture',
      captureProtocolId: 'blue-red-then-green-blue',
      startedAtIso: '2026-11-14T23:40:00.000Z',
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.protocol.captureProtocolId, 'blue-red-then-green-blue')
    assert.equal(created.body.protocol.approvedSteps[0].includes('BLUE → RED'), true)
    const changed = await ask(server, 'POST', '/monitor-sessions', {
      sessionId: second,
      sourceKind: 'prerecorded',
      procedureId: 'three-cup-capture',
      captureProtocolId: 'red-blue-then-green-red',
      startedAtIso: '2026-11-14T23:40:00.000Z',
    })
    assert.equal(changed.status, 409)
    const marker = await ask(server, 'POST', `/monitor-sessions/${second}/events`, {
      id: 'marker_5b5b5b5b-5b5b-5b5b-8b5b-5b5b5b5b5b5b',
      type: 'human_marker',
      marker: 'transfer_blue_to_red',
      observationTimestamp: 1000,
    })
    assert.equal(marker.status, 201)
    assert.deepEqual(marker.body.humanMarkers[0].cups, ['BLUE', 'RED'])
    await ask(server, 'POST', `/monitor-sessions/${second}/finish`, {})
    const published = await ask(server, 'POST', `/monitor-sessions/${second}/publish`, { notes: 'Second procedure.' })
    assert.equal(published.status, 201)
    assert.equal(published.body.runRecord.captureProtocolId, 'blue-red-then-green-blue')
    assert.equal(published.body.protocolSnapshot.steps[0].instruction.includes('BLUE → RED'), true)
    assert.equal(published.body.protocolSnapshot.steps[1].instruction.includes('GREEN → BLUE'), true)

    const older = await ask(server, 'POST', '/monitor-sessions', {
      sessionId: SESSION,
      sourceKind: 'live',
      procedureId: 'three-cup-capture',
      startedAtIso: '2026-11-14T23:20:00.000Z',
    })
    assert.equal(older.status, 201)
    assert.equal(older.body.protocol.captureProtocolId, 'red-blue-then-green-red')
  } finally {
    server.close()
  }
})
