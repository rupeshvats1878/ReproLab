import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { createLibraryServer } from './http.mjs'
import './index.mjs'
import { createMemoryStore, createStoreFromEnv } from './store.mjs'

const SESSION = 'session_11111111-1111-4111-8111-111111111111'
const OBS = 'obs_22222222-2222-4222-8222-222222222222'
const MEDIA = 'media_33333333-3333-4333-8333-333333333333'
const ALERT = 'alert_44444444-4444-4444-8444-444444444444'
const UPDATE = 'decision_55555555-5555-4555-8555-555555555555'
const HUMAN = 'evt_66666666-6666-4666-8666-666666666666'
const BLOCK = 'decision_77777777-7777-4777-8777-777777777777'
const ACK = 'evt_88888888-8888-4888-8888-888888888888'

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
        resolve({ status: res.statusCode, body: JSON.parse(text), text })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function states(overrides = {}) {
  return { A1: 'unknown', A2: 'unknown', A3: 'unknown', B1: 'unknown', B2: 'unknown', B3: 'unknown', ...overrides }
}

function sessionBody(overrides = {}) {
  return { sessionId: SESSION, sourceKind: 'live', startedAtIso: '2026-11-14T23:00:00.000Z', ...overrides }
}

function evidence() {
  return { mediaId: MEDIA, observationTimestamp: 1200, frameIndex: null, label: 'Stable frame' }
}

test('stores six-well monitor events without rewriting alerts or camera state', async () => {
  const server = await listen(createMemoryStore())
  try {
    const rejected = await ask(server, 'POST', '/monitor-sessions', { ...sessionBody(), protocolSnapshot: { steps: ['Mix'] } })
    assert.equal(rejected.status, 400)

    const created = await ask(server, 'POST', '/monitor-sessions', sessionBody())
    assert.equal(created.status, 201)
    assert.deepEqual(created.body.protocol.order, ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
    assert.equal(created.body.protocol.id, 'six-well-colored-water')
    assert.match(created.body.protocol.note, /not a monitor protocol/)
    const replaySession = await ask(server, 'POST', '/monitor-sessions', sessionBody())
    assert.equal(replaySession.status, 200)
    const otherSource = await ask(server, 'POST', '/monitor-sessions', sessionBody({ sourceKind: 'synthetic' }))
    assert.equal(otherSource.status, 409)

    const media = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: MEDIA,
      type: 'evidence',
      kind: 'camera_recording',
      observationTimestamp: 0,
      runStartOffsetMs: 0,
      available: true,
      label: 'Live camera',
      mimeType: 'video/webm',
    })
    assert.equal(media.status, 201)
    assert.equal(media.body.evidence[0].provenance, 'live')

    const observation = {
      id: OBS,
      type: 'observation',
      observationTimestamp: 1200,
      rawState: states({ A1: 'filled', A2: 'unknown' }),
      stableState: states({ A1: 'filled', A2: 'empty' }),
    }
    const saved = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, observation)
    assert.equal(saved.status, 201)
    assert.equal(saved.body.observations[0].provenance, 'live')
    const replay = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, observation)
    assert.equal(replay.status, 200)
    assert.equal(replay.body.observations.length, 1)
    const conflict = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, { ...observation, observationTimestamp: 1300 })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.error, 'duplicate_event')

    const unknownAlert = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: ALERT,
      type: 'alert',
      observationTimestamp: 1200,
      wellId: 'A2',
      expectedWell: 'A2',
      rule: 'Unknown is not empty.',
      observedState: 'A2 unknown',
      rawState: 'unknown',
      stableState: 'unknown',
      evidence: evidence(),
    })
    assert.equal(unknownAlert.status, 400)
    assert.equal(unknownAlert.body.field, 'stableState')

    const alert = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: ALERT,
      type: 'alert',
      observationTimestamp: 1200,
      wellId: 'A2',
      expectedWell: 'A2',
      rule: 'A later location is filled while A2 is stably empty.',
      observedState: 'A2 empty. A1 filled, A2 empty',
      rawState: 'unknown',
      stableState: 'empty',
      evidence: evidence(),
    })
    assert.equal(alert.status, 201)
    assert.equal(alert.body.alerts[0].protocolIndex, 1)

    const dataUrl = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: UPDATE,
      type: 'alert_update',
      alertId: ALERT,
      observationTimestamp: 2400,
      rule: 'A later stable observation shows A2 filled.',
      observedState: 'A2 filled',
      stableState: 'filled',
      evidence: { ...evidence(), observationTimestamp: 2400, label: 'data:image/jpeg;base64,AAAA' },
    })
    assert.equal(dataUrl.status, 400)

    const update = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: UPDATE,
      type: 'alert_update',
      alertId: ALERT,
      observationTimestamp: 2400,
      rule: 'A later stable observation shows A2 filled.',
      observedState: 'A2 filled',
      stableState: 'filled',
      evidence: { ...evidence(), observationTimestamp: 2400, label: 'Later filled frame' },
    })
    assert.equal(update.status, 201)
    const original = update.body.events.find((event) => event.id === ALERT)
    assert.equal(original.stableState, 'empty')
    assert.equal(original.evidence.label, 'Stable frame')
    assert.equal(update.body.alerts[0].updates.length, 1)
    assert.equal(update.body.observations[0].stableState.A2, 'empty')

    const report = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: HUMAN,
      type: 'human_report',
      humanActionKind: 'correction_note',
      alertId: ALERT,
      wellId: 'A2',
      observationTimestamp: 2500,
      humanNote: 'The cup looked filled to me.',
      humanReportedState: 'filled',
    })
    assert.equal(report.status, 201)
    assert.equal(report.body.humanReports[0].provenance, 'human')
    assert.equal(report.body.observations[0].stableState.A2, 'empty')

    const blocked = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: BLOCK,
      type: 'block',
      observationTimestamp: 2600,
      reason: 'The video clock moved backward.',
    })
    assert.equal(blocked.status, 201)
    assert.equal(blocked.body.blockedReason, 'The video clock moved backward.')
    const late = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      ...observation,
      id: 'obs_99999999-9999-4999-8999-999999999999',
      observationTimestamp: 3000,
    })
    assert.equal(late.status, 409)
    assert.equal(late.body.error, 'invalid_state')
    const ack = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, {
      id: ACK,
      type: 'human_report',
      humanActionKind: 'omission_acknowledged',
      alertId: ALERT,
      wellId: 'A2',
      observationTimestamp: 2700,
      humanNote: 'Acknowledged by a person.',
    })
    assert.equal(ack.status, 201)
    const retryObservation = await ask(server, 'POST', `/monitor-sessions/${SESSION}/events`, observation)
    assert.equal(retryObservation.status, 200)

    const opened = await ask(server, 'GET', `/monitor-sessions/${SESSION}`)
    assert.deepEqual(opened.body.events.map((event) => event.id), [MEDIA, OBS, ALERT, UPDATE, HUMAN, BLOCK, ACK])
    assert.equal(opened.body.observations.length, 1)
    assert.equal(opened.body.evidence.length, 1)
    assert.equal(opened.body.humanReports.length, 2)
  } finally {
    server.close()
  }
})

test('real MongoDB monitor session persists and leaves existing records unchanged', {
  skip: process.env.MONGODB_URI && process.env.MONGODB_DB && !process.env.MONGODB_URI.includes('USER:PASSWORD')
    ? false
    : 'MONGODB_URI or MONGODB_DB is not set to a real database.',
}, async () => {
  const store = createStoreFromEnv(process.env)
  const dbName = process.env.MONGODB_DB
  const sessionId = `session_${randomUUID()}`
  const observationId = `obs_${randomUUID()}`
  const protectedRecords = [
    ['experiments', 'bc946568-26e7-4585-82a2-8949e7164200'],
    ['replications', 'e847960c-13c0-42b3-b585-df6d4e95208d'],
    ['replications', 'c72934c1-506b-4f01-aac1-865498e859b6'],
  ]
  const before = []
  try {
    for (const [collection, id] of protectedRecords) {
      before.push(await store.client.db(dbName).collection(collection).findOne({ _id: id }))
    }
    const created = await store.createMonitorSession({
      sessionId,
      sourceKind: 'prerecorded',
      startedAtIso: '2026-11-14T23:10:00.000Z',
    })
    assert.equal(created.created, true)
    const saved = await store.appendMonitorEvent(sessionId, {
      id: observationId,
      type: 'observation',
      observationTimestamp: 500,
      rawState: states({ A1: 'filled' }),
      stableState: states({ A1: 'filled' }),
    })
    assert.equal(saved.created, true)
    const replay = await store.appendMonitorEvent(sessionId, {
      id: observationId,
      type: 'observation',
      observationTimestamp: 500,
      rawState: states({ A1: 'filled' }),
      stableState: states({ A1: 'filled' }),
    })
    assert.equal(replay.created, false)
    const opened = await store.openMonitorSession(sessionId)
    assert.equal(opened.id, sessionId)
    assert.equal(opened.observations.length, 1)
    assert.equal(opened.observations[0].provenance, 'prerecorded')
    assert.equal(opened.observations[0].observationTimestamp, 500)
    assert.deepEqual(opened.protocol.order, ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
  } finally {
    await store.client.db(dbName).collection('monitorSessions').deleteOne({ _id: sessionId })
    const removed = await store.client.db(dbName).collection('monitorSessions').findOne({ _id: sessionId })
    assert.equal(removed, null)
    for (let index = 0; index < protectedRecords.length; index += 1) {
      const [collection, id] = protectedRecords[index]
      const after = await store.client.db(dbName).collection(collection).findOne({ _id: id })
      assert.deepEqual(after, before[index])
    }
    await store.client.close()
  }
})
