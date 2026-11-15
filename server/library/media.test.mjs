import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { createLibraryServer } from './http.mjs'
import './index.mjs'
import { SHARED_MEDIA_LIMIT_BYTES } from './mediaLimit.mjs'
import { createMemoryStore, createStoreFromEnv } from './store.mjs'

const STEPS = ['Fill A1', 'Fill A2', 'Fill A3', 'Fill B1', 'Fill B2', 'Fill B3']

function listen(store, mediaLimit = SHARED_MEDIA_LIMIT_BYTES) {
  const server = createServer(createLibraryServer({ store, mediaLimit }))
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function ask(server, method, path, body, headers = {}) {
  const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  const json = body != null && !Buffer.isBuffer(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers: {
        ...(payload == null ? {} : { 'content-length': payload.length }),
        ...(json ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const bytes = Buffer.concat(chunks)
        const text = bytes.toString('utf8')
        let parsed = null
        try { parsed = JSON.parse(text) } catch { parsed = null }
        resolve({ status: res.statusCode, headers: res.headers, bytes, body: parsed })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function finishedSession(server, { sessionId, evidenceId, offset }) {
  await ask(server, 'POST', '/monitor-sessions', {
    sessionId,
    sourceKind: 'live',
    startedAtIso: '2026-11-14T23:00:00.000Z',
    preparedProtocol: {
      id: '15151515-1515-4515-8515-151515151515',
      version: 2,
      title: 'Media check',
      steps: STEPS,
    },
  })
  await ask(server, 'POST', `/monitor-sessions/${sessionId}/events`, {
    id: evidenceId,
    type: 'evidence',
    kind: 'camera_recording',
    observationTimestamp: 0,
    runStartOffsetMs: offset,
    durationMs: 4000,
    available: true,
    label: 'Live camera recording',
    mimeType: 'video/webm',
  })
  await ask(server, 'POST', `/monitor-sessions/${sessionId}/events`, {
    id: 'alert_16161616-1616-4616-8616-161616161616',
    type: 'alert',
    observationTimestamp: 3000,
    wellId: 'A2',
    expectedWell: 'A2',
    rule: 'A later well was filled while A2 was empty.',
    observedState: 'A2 empty',
    rawState: 'empty',
    stableState: 'empty',
    evidence: { mediaId: null, observationTimestamp: 3000, frameIndex: null, label: 'A2 still empty' },
  })
  await ask(server, 'POST', `/monitor-sessions/${sessionId}/finish`, {})
}

test('stores a bounded recording and serves a byte range', async () => {
  const server = await listen(createMemoryStore(), 8)
  try {
    const rejected = await ask(server, 'POST', '/media', Buffer.from('nope'), { 'content-type': 'text/plain' })
    assert.equal(rejected.status, 400)
    const empty = await ask(server, 'POST', '/media', Buffer.alloc(0), { 'content-type': 'video/webm' })
    assert.equal(empty.status, 400)
    const tooBig = await ask(server, 'POST', '/media', Buffer.from('123456789'), { 'content-type': 'video/webm' })
    assert.equal(tooBig.status, 413)

    const payload = Buffer.from('01234567')
    const saved = await ask(server, 'POST', '/media', payload, { 'content-type': 'video/webm' })
    assert.equal(saved.status, 201)
    assert.match(saved.body.id, /^media_[0-9a-f-]{36}$/)
    assert.equal(saved.body.byteLength, 8)
    const whole = await ask(server, 'GET', `/media/${saved.body.id}`)
    assert.equal(whole.status, 200)
    assert.equal(whole.headers['accept-ranges'], 'bytes')
    assert.equal(whole.bytes.toString(), '01234567')
    const range = await ask(server, 'GET', `/media/${saved.body.id}`, null, { range: 'bytes=2-5' })
    assert.equal(range.status, 206)
    assert.equal(range.headers['content-range'], 'bytes 2-5/8')
    assert.equal(range.bytes.toString(), '2345')
    const missing = await ask(server, 'GET', '/media/media_17171717-1717-4717-8717-171717171717')
    assert.equal(missing.status, 404)
  } finally {
    server.close()
  }
})

test('deletes an upload that no publication references and refuses one that is published', async () => {
  const server = await listen(createMemoryStore())
  const sessionId = 'session_3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a'
  const evidenceId = 'media_3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b'
  try {
    const orphan = await ask(server, 'POST', '/media', Buffer.from('orphan'), { 'content-type': 'video/webm' })
    const removed = await ask(server, 'DELETE', `/media/${orphan.body.id}`)
    assert.equal(removed.status, 200)
    assert.equal((await ask(server, 'GET', `/media/${orphan.body.id}`)).status, 404)
    assert.equal((await ask(server, 'DELETE', `/media/${orphan.body.id}`)).status, 404)

    await finishedSession(server, { sessionId, evidenceId, offset: 0 })
    const failed = await ask(server, 'POST', '/media', Buffer.from('unused'), { 'content-type': 'video/webm' })
    const rejected = await ask(server, 'POST', `/monitor-sessions/${sessionId}/publish`, {
      recording: { evidenceId, mediaId: 'media_3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c' },
    })
    assert.equal(rejected.status, 400)
    assert.equal((await ask(server, 'DELETE', `/media/${failed.body.id}`)).status, 200)

    const uploaded = await ask(server, 'POST', '/media', Buffer.from('kept-bytes'), { 'content-type': 'video/webm' })
    const published = await ask(server, 'POST', `/monitor-sessions/${sessionId}/publish`, {
      recording: { evidenceId, mediaId: uploaded.body.id },
    })
    assert.equal(published.status, 201)
    const blocked = await ask(server, 'DELETE', `/media/${uploaded.body.id}`)
    assert.equal(blocked.status, 409)
    const still = await ask(server, 'GET', `/media/${uploaded.body.id}`)
    assert.equal(still.status, 200)
    assert.equal(still.bytes.toString(), 'kept-bytes')
  } finally {
    server.close()
  }
})

test('publishes with a recording only when that upload is named, and keeps the first snapshot', async () => {
  const server = await listen(createMemoryStore())
  const sessionId = 'session_18181818-1818-4818-8818-181818181818'
  const evidenceId = 'media_19191919-1919-4919-8919-191919191919'
  const earlySession = 'session_1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'
  try {
    await finishedSession(server, { sessionId, evidenceId, offset: -2000 })
    const missing = await ask(server, 'POST', `/monitor-sessions/${sessionId}/publish`, {
      recording: { evidenceId, mediaId: 'media_1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b' },
    })
    assert.equal(missing.status, 400)
    const absent = await ask(server, 'GET', `/experiments?q=Media%20check`)
    assert.equal(absent.body.total, 0)

    const uploaded = await ask(server, 'POST', '/media', Buffer.from('webm-bytes'), { 'content-type': 'video/webm' })
    const published = await ask(server, 'POST', `/monitor-sessions/${sessionId}/publish`, {
      notes: 'A2 stayed empty.',
      recording: { evidenceId, mediaId: uploaded.body.id },
    })
    assert.equal(published.status, 201)
    const evidence = published.body.runRecord.evidence[0]
    assert.equal(evidence.available, true)
    assert.equal(evidence.sharedMediaId, uploaded.body.id)
    assert.equal(evidence.runStartOffsetMs, -2000)
    assert.equal(evidence.byteLength, 10)
    assert.equal(JSON.stringify(published.body).includes('webm-bytes'), false)
    const retry = await ask(server, 'POST', `/monitor-sessions/${sessionId}/publish`, { notes: 'Replacement' })
    assert.equal(retry.status, 200)
    assert.equal(retry.body.id, published.body.id)
    assert.equal(retry.body.runRecord.evidence[0].sharedMediaId, uploaded.body.id)

    await finishedSession(server, { sessionId: earlySession, evidenceId: 'media_1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', offset: 0 })
    const plain = await ask(server, 'POST', `/monitor-sessions/${earlySession}/publish`, {})
    assert.equal(plain.status, 201)
    assert.equal(plain.body.runRecord.evidence[0].available, false)
    assert.equal(plain.body.runRecord.evidence[0].sharedMediaId, null)
    assert.equal(plain.body.runRecord.alerts[0].wellId, 'A2')
  } finally {
    server.close()
  }
})

test('real MongoDB recording round-trip uses GridFS and removes only that file', {
  skip: process.env.MONGODB_URI && process.env.MONGODB_DB && !process.env.MONGODB_URI.includes('USER:PASSWORD')
    ? false
    : 'MONGODB_URI or MONGODB_DB is not set to a real database.',
}, async () => {
  const store = createStoreFromEnv(process.env)
  const server = await listen(store)
  const sessionId = `session_${randomUUID()}`
  const evidenceId = `media_${randomUUID()}`
  let mediaId = null
  let experimentId = null
  try {
    await finishedSession(server, { sessionId, evidenceId, offset: -500 })
    const uploaded = await ask(server, 'POST', '/media', Buffer.from('atlas-bytes'), { 'content-type': 'video/mp4' })
    assert.equal(uploaded.status, 201)
    mediaId = uploaded.body.id
    const range = await ask(server, 'GET', `/media/${mediaId}`, null, { range: 'bytes=0-4' })
    assert.equal(range.status, 206)
    assert.equal(range.bytes.toString(), 'atlas')
    const published = await ask(server, 'POST', `/monitor-sessions/${sessionId}/publish`, {
      recording: { evidenceId, mediaId },
    })
    assert.equal(published.status, 201)
    experimentId = published.body.id
    assert.equal(published.body.runRecord.evidence[0].sharedMediaId, mediaId)
    const opened = await ask(server, 'GET', `/experiments/${experimentId}`)
    assert.equal(opened.body.runRecord.evidence[0].byteLength, Buffer.from('atlas-bytes').length)
  } finally {
    const db = store.client.db(process.env.MONGODB_DB)
    if (experimentId) await db.collection('experiments').deleteOne({ _id: experimentId })
    await db.collection('monitorSessions').deleteOne({ _id: sessionId })
    if (mediaId) {
      const files = await db.collection('experimentMedia.files').find({ filename: mediaId }).toArray()
      const ids = files.map((file) => file._id)
      await db.collection('experimentMedia.chunks').deleteMany({ files_id: { $in: ids } })
      await db.collection('experimentMedia.files').deleteMany({ filename: mediaId })
    }
    server.close()
    await store.client.close()
  }
})
