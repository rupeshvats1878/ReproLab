import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { LISTEN_HOST, start } from './index.mjs'
import { presentReplication } from './records.mjs'
import { createLibraryServer } from './http.mjs'
import { createMemoryStore, createMongoStore, createStoreFromEnv, createUnavailableStore } from './store.mjs'
import { MongoClient } from 'mongodb'

const MISSING = '00000000-0000-4000-8000-000000000000'

function realDatabaseConfigured() {
  const uri = process.env.MONGODB_URI ?? ''
  const dbName = process.env.MONGODB_DB ?? ''
  if (!uri || !dbName) return false
  return !uri.includes('USER:PASSWORD') && !uri.includes('CLUSTER.example.net')
}

function publishBody(overrides = {}) {
  return {
    title: 'Dye dispersion',
    description: 'Approved colored-water protocol snapshot.',
    authorDisplayName: 'Ada',
    approvalAcknowledged: true,
    protocolSnapshot: { source: 'protocol-preparation', steps: ['Add dye', 'Stir'] },
    ...overrides,
  }
}

function listen(store) {
  const server = createServer(createLibraryServer({ store }))
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function ask(server, method, path, body) {
  const payload = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        method,
        path,
        headers: payload == null ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = text
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = text
          }
          resolve({ status: res.statusCode, body: parsed, text })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

test('copies the protocol snapshot into the publication and the planned replication', async () => {
  const store = createMemoryStore()
  const snapshot = { steps: ['Stir'] }
  const published = await store.publish({ ...publishBody(), protocolSnapshot: snapshot })
  snapshot.steps.push('changed input')
  published.protocolSnapshot.steps.push('changed result')
  const opened = await store.open(published.id)
  assert.deepEqual(opened.protocolSnapshot, { steps: ['Stir'] })
  const replication = await store.replicate(published.id)
  replication.protocolSnapshot.steps.push('changed replication')
  assert.deepEqual((await store.open(published.id)).protocolSnapshot, { steps: ['Stir'] })
  assert.equal(replication.status, 'planned')
})

test('rejects invalid publications before saving', async () => {
  const store = createMemoryStore()
  const server = await listen(store)
  try {
    const missingApproval = await ask(server, 'POST', '/experiments', publishBody({ approvalAcknowledged: false }))
    assert.equal(missingApproval.status, 400)
    assert.equal(missingApproval.body.error, 'approval_required')

    const blankTitle = await ask(server, 'POST', '/experiments', publishBody({ title: '   ' }))
    assert.equal(blankTitle.status, 400)
    assert.equal(blankTitle.body.field, 'title')

    const extra = await ask(server, 'POST', '/experiments', publishBody({ video: 'clip.mp4' }))
    assert.equal(extra.status, 400)

    const arraySnapshot = await ask(server, 'POST', '/experiments', publishBody({ protocolSnapshot: ['step'] }))
    assert.equal(arraySnapshot.status, 400)
    assert.equal(arraySnapshot.body.field, 'protocolSnapshot')

    const media = await ask(server, 'POST', '/experiments', publishBody({
      protocolSnapshot: { frame: 'data:image/jpeg;base64,AAAA' },
    }))
    assert.equal(media.status, 400)

    const listed = await ask(server, 'GET', '/experiments')
    assert.equal(listed.body.total, 0)
  } finally {
    server.close()
  }
})

test('rejects an oversized snapshot and an oversized body', async () => {
  const server = await listen(createMemoryStore())
  try {
    const oversizedSnapshot = await ask(server, 'POST', '/experiments', publishBody({
      protocolSnapshot: { notes: 'x'.repeat(33_000) },
    }))
    assert.equal(oversizedSnapshot.status, 400)
    assert.equal(oversizedSnapshot.body.field, 'protocolSnapshot')

    const oversizedBody = await ask(server, 'POST', '/experiments', 'y'.repeat(49 * 1024))
    assert.equal(oversizedBody.status, 413)
    assert.equal(oversizedBody.body.error, 'payload_too_large')
  } finally {
    server.close()
  }
})

test('keeps the published snapshot immutable and links a planned replication to it', async () => {
  let tick = 0
  const store = createMemoryStore({
    now: () => `2026-11-14T20:00:0${tick++}.000Z`,
    ids: (() => {
      let n = 0
      return () => `00000000-0000-4000-8000-00000000000${++n}`
    })(),
  })
  const server = await listen(store)
  try {
    const sent = publishBody()
    const created = await ask(server, 'POST', '/experiments', sent)
    assert.equal(created.status, 201)
    sent.protocolSnapshot.steps.push('tampered')
    const opened = await ask(server, 'GET', `/experiments/${created.body.id}`)
    assert.deepEqual(opened.body.protocolSnapshot, { source: 'protocol-preparation', steps: ['Add dye', 'Stir'] })
    opened.body.protocolSnapshot.steps.push('tampered again')

    const again = await ask(server, 'GET', `/experiments/${created.body.id}`)
    assert.deepEqual(again.body.protocolSnapshot.steps, ['Add dye', 'Stir'])

    const missing = await ask(server, 'POST', '/replications', { experimentId: MISSING })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error, 'not_found')

    const badId = await ask(server, 'POST', '/replications', { experimentId: 'not-an-id' })
    assert.equal(badId.status, 400)

    const replication = await ask(server, 'POST', '/replications', { experimentId: created.body.id })
    assert.equal(replication.status, 201)
    assert.equal(replication.body.status, 'planned')
    assert.equal(replication.body.experimentId, created.body.id)
    assert.deepEqual(replication.body.protocolSnapshot, again.body.protocolSnapshot)
    assert.match(replication.body.note, /does not mean the experiment was performed or reproduced/)

    const savedReplication = await ask(server, 'GET', `/replications/${replication.body.id}`)
    assert.equal(savedReplication.status, 200)
    assert.equal(savedReplication.body.id, replication.body.id)
    assert.equal(savedReplication.body.experimentId, created.body.id)
    assert.equal(savedReplication.body.status, 'planned')
    assert.deepEqual(savedReplication.body.protocolSnapshot, again.body.protocolSnapshot)

    const missingReplication = await ask(server, 'GET', `/replications/${MISSING}`)
    assert.equal(missingReplication.status, 404)
    assert.equal(missingReplication.body.error, 'not_found')

    const badReplication = await ask(server, 'GET', '/replications/not-an-id')
    assert.equal(badReplication.status, 400)
    assert.equal(badReplication.body.error, 'invalid_input')

    const removed = await ask(server, 'DELETE', `/experiments/${created.body.id}`)
    assert.equal(removed.status, 404)
    const stillThere = await ask(server, 'GET', `/experiments/${created.body.id}`)
    assert.equal(stillThere.status, 200)
  } finally {
    server.close()
  }
})

test('paginates published summaries without protocol snapshots', async () => {
  let tick = 0
  const store = createMemoryStore({ now: () => `2026-11-14T20:00:0${tick++}.000Z` })
  const server = await listen(store)
  try {
    await ask(server, 'POST', '/experiments', publishBody({ title: 'First' }))
    await ask(server, 'POST', '/experiments', publishBody({ title: 'Second' }))
    await ask(server, 'POST', '/experiments', publishBody({ title: 'Third' }))
    const page = await ask(server, 'GET', '/experiments?limit=2&offset=0')
    assert.equal(page.status, 200)
    assert.equal(page.body.total, 3)
    assert.deepEqual(page.body.experiments.map((item) => item.title), ['Third', 'Second'])
    assert.equal('protocolSnapshot' in page.body.experiments[0], false)
    const next = await ask(server, 'GET', '/experiments?limit=2&offset=2')
    assert.equal(next.body.experiments[0].title, 'First')
    const bad = await ask(server, 'GET', '/experiments?limit=0')
    assert.equal(bad.status, 400)
    assert.equal(page.body.experiments[0].stepCount, 2)
    assert.equal('protocolVersion' in page.body.experiments[0], false)
  } finally {
    server.close()
  }
})

test('searches titles without treating the query as a regular expression', async () => {
  let tick = 0
  const store = createMemoryStore({ now: () => `2026-11-14T21:00:0${tick++}.000Z` })
  const server = await listen(store)
  try {
    await ask(server, 'POST', '/experiments', publishBody({
      title: 'Dye (a+b) check',
      protocolSnapshot: { version: 2, steps: [{ instruction: 'Add dye', quote: 'Add dye' }, { instruction: 'Stir' }] },
    }))
    await ask(server, 'POST', '/experiments', publishBody({ title: 'Plain water' }))
    await ask(server, 'POST', '/experiments', publishBody({ title: 'dye dispersion' }))

    const matched = await ask(server, 'GET', '/experiments?q=DYE&sort=oldest')
    assert.equal(matched.status, 200)
    assert.equal(matched.body.total, 2)
    assert.deepEqual(matched.body.experiments.map((item) => item.title), ['Dye (a+b) check', 'dye dispersion'])
    assert.equal(matched.body.experiments[0].protocolVersion, 2)
    assert.equal(matched.body.experiments[0].stepCount, 2)
    assert.equal('protocolSnapshot' in matched.body.experiments[0], false)

    const literal = await ask(server, 'GET', '/experiments?q=' + encodeURIComponent('(a+b)'))
    assert.equal(literal.body.total, 1)
    assert.equal(literal.body.experiments[0].title, 'Dye (a+b) check')

    const wildcard = await ask(server, 'GET', '/experiments?q=' + encodeURIComponent('.*'))
    assert.equal(wildcard.body.total, 0)
    assert.deepEqual(wildcard.body.experiments, [])

    const page = await ask(server, 'GET', '/experiments?q=dye&sort=newest&limit=1&offset=0')
    assert.equal(page.body.total, 2)
    assert.equal(page.body.experiments[0].title, 'dye dispersion')
    const olderPage = await ask(server, 'GET', '/experiments?q=dye&sort=newest&limit=1&offset=1')
    assert.equal(olderPage.body.experiments[0].title, 'Dye (a+b) check')

    const empty = await ask(server, 'GET', '/experiments?q=' + encodeURIComponent('no such title'))
    assert.equal(empty.body.total, 0)

    const badSort = await ask(server, 'GET', '/experiments?sort=popular')
    assert.equal(badSort.status, 400)
    const longQuery = await ask(server, 'GET', '/experiments?q=' + 'a'.repeat(121))
    assert.equal(longQuery.status, 400)
  } finally {
    server.close()
  }
})

test('does not save or leak errors when the database is unavailable', async () => {
  const server = await listen(createUnavailableStore())
  try {
    const health = await ask(server, 'GET', '/health')
    assert.equal(health.status, 200)
    assert.deepEqual(health.body, { database: 'unavailable' })
    const saved = await ask(server, 'POST', '/experiments', publishBody())
    assert.equal(saved.status, 503)
    assert.equal(saved.body.error, 'database_unavailable')
    const listed = await ask(server, 'GET', '/experiments?q=dye')
    assert.equal(listed.status, 503)
    assert.equal(listed.body.error, 'database_unavailable')
    assert.equal(saved.body.id, undefined)
    assert.equal(saved.text.includes('mongodb'), false)
  } finally {
    server.close()
  }
})

test('hides driver failures instead of reporting a saved experiment', async () => {
  const store = {
    async health() {
      return { database: 'available' }
    },
    async publish() {
      throw new Error('auth failed for mongodb+srv://user:secret@cluster.example.net')
    },
  }
  const server = await listen(store)
  try {
    const saved = await ask(server, 'POST', '/experiments', publishBody())
    assert.equal(saved.status, 500)
    assert.deepEqual(saved.body, { error: 'request_failed' })
    assert.equal(saved.text.includes('secret'), false)
    assert.equal(saved.text.includes('mongodb'), false)
  } finally {
    server.close()
  }
})

test('missing configuration is an unavailable store and the service binds to localhost', async () => {
  const store = createStoreFromEnv({})
  const health = await store.health()
  assert.equal(health.database, 'unavailable')
  await assert.rejects(store.publish(publishBody()), (error) => error.code === 'unavailable')

  const server = start(createMemoryStore(), 0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const address = server.address()
    assert.equal(address.address, LISTEN_HOST)
    assert.equal(LISTEN_HOST, '127.0.0.1')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('an unreachable MongoDB server is unavailable and does not save', async () => {
  const client = new MongoClient('mongodb://127.0.0.1:1', { serverSelectionTimeoutMS: 300, connectTimeoutMS: 300 })
  const store = createMongoStore({ client, dbName: 'reprolab' })
  const server = await listen(store)
  try {
    const health = await ask(server, 'GET', '/health')
    assert.deepEqual(health.body, { database: 'unavailable' })
    const saved = await ask(server, 'POST', '/experiments', publishBody())
    assert.equal(saved.status, 503)
    assert.equal(saved.body.id, undefined)
    assert.equal(saved.text.includes('ECONNREFUSED'), false)
  } finally {
    server.close()
    await client.close()
  }
})

const executionSnapshot = {
  version: 1,
  steps: [
    { id: 'add-dye', instruction: 'Add dye' },
    { instruction: 'Mix thoroughly.' },
    { instruction: 'Wait 5 minutes.', duration: '5 minutes' },
    { instruction: 'Observe the dye color in a still frame.' },
  ],
}
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')
const completionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ownImageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const referenceImageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const correctionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
const secondCompletionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'

function humanCompletion(id, stepIndex, note = 'Done by hand') {
  return { id, type: 'human_completion', stepIndex, note }
}

function imageObservation(id, provenance, measurement = acceptedMeasurement()) {
  return {
    id,
    type: 'image_observation',
    stepIndex: 3,
    capturedAt: '2026-11-14T22:16:14.748Z',
    provenance,
    imageBase64: jpeg,
    source: { clipId: 'nonrotating', title: 'MIT • Non-rotating tank', locator: 'https://weathertank.mit.edu/links/projects/dye-stirring-an-introduction/dye-stirring-tank-examples' },
    videoTimeSec: 20,
    crop: { x: 32, y: 25, width: 36, height: 50 },
    measurement,
  }
}

function acceptedMeasurement() {
  return { metric: 'spatial_color_dispersion', value: 0.05, quality: 'accepted', reason: null, analysisVersion: 'rgb-chromaticity-6x6-v1' }
}

test('records append-only execution without changing the frozen snapshot', async () => {
  const store = createMemoryStore()
  const server = await listen(store)
  try {
    const published = await ask(server, 'POST', '/experiments', publishBody({ protocolSnapshot: executionSnapshot }))
    const experimentId = published.body.id
    const planned = await ask(server, 'POST', '/replications', { experimentId })
    const replicationId = planned.body.id
    assert.equal(planned.body.execution.sessionEnded, false)
    assert.deepEqual(planned.body.execution.unfinishedStepIndexes, [0, 1, 2, 3])

    const early = await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(completionId, 0))
    assert.equal(early.status, 409)
    assert.equal(early.body.error, 'invalid_state')

    const smuggled = await ask(server, 'POST', `/replications/${replicationId}/start`, { status: 'completed' })
    assert.equal(smuggled.status, 400)
    assert.equal((await ask(server, 'GET', `/replications/${replicationId}`)).body.status, 'planned')

    const started = await ask(server, 'POST', `/replications/${replicationId}/start`, {})
    assert.equal(started.status, 201)
    assert.equal(started.body.status, 'in_progress')
    assert.equal(typeof started.body.startedAt, 'string')
    assert.deepEqual(started.body.protocolSnapshot, executionSnapshot)
    assert.equal((await ask(server, 'POST', `/replications/${replicationId}/start`, {})).status, 409)

    const badStep = await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(secondCompletionId, 4))
    assert.equal(badStep.status, 400)
    assert.equal(badStep.body.field, 'stepIndex')
    assert.equal((await ask(server, 'GET', `/replications/${replicationId}`)).body.events.length, 0)

    const completed = await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(completionId, 0))
    assert.equal(completed.status, 201)
    assert.equal(completed.body.events[0].stepId, 'add-dye')
    assert.equal(completed.body.execution.steps[0].humanCompleted, true)
    const replay = await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(completionId, 0))
    assert.equal(replay.status, 200)
    assert.equal(replay.body.events.length, 1)
    const conflict = await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(completionId, 0, 'A different note'))
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.error, 'duplicate_event')
    assert.equal((await ask(server, 'GET', `/replications/${replicationId}`)).body.events.length, 1)

    const own = await ask(server, 'POST', `/replications/${replicationId}/events`, imageObservation(ownImageId, 'own_recording'))
    assert.equal(own.status, 201)
    assert.equal(own.body.execution.steps[3].humanCompleted, false)
    assert.equal(own.body.execution.steps[3].ownObservationCount, 1)
    assert.equal(own.body.events.at(-1).image.mediaType, 'image/jpeg')
    assert.equal(own.body.events.at(-1).image.byteLength, 4)
    assert.equal(own.body.events.at(-1).videoTimeSec, 20)
    assert.equal(own.body.events.at(-1).capturedAt, '2026-11-14T22:16:14.748Z')
    assert.deepEqual(own.body.events.at(-1).measurement, acceptedMeasurement())

    const reference = await ask(server, 'POST', `/replications/${replicationId}/events`, imageObservation(referenceImageId, 'imported_reference'))
    assert.equal(reference.status, 201)
    assert.equal(reference.body.execution.steps[3].humanCompleted, false)
    assert.equal(reference.body.execution.steps[3].referenceObservationCount, 1)
    assert.equal(reference.body.events.at(-1).provenance, 'imported_reference')

    const corrected = await ask(server, 'POST', `/replications/${replicationId}/events`, {
      id: correctionId,
      type: 'correction',
      stepIndex: 0,
      correctsEventId: completionId,
      note: 'That completion was reported on the wrong step.',
    })
    assert.equal(corrected.status, 201)
    assert.equal(corrected.body.events[0].type, 'human_completion')
    assert.equal(corrected.body.events[0].id, completionId)
    assert.equal(corrected.body.events.some((event) => event.id === correctionId), true)
    assert.equal(corrected.body.execution.steps[0].humanCompleted, false)

    const later = await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(secondCompletionId, 1, 'Mixed'))
    assert.equal(later.status, 201)
    assert.equal(later.body.execution.steps[1].stepId, null)
    assert.equal(later.body.execution.steps[1].humanCompleted, true)

    const notJpeg = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd9]).toString('base64')
    const rejectedImage = await ask(server, 'POST', `/replications/${replicationId}/events`, {
      ...imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'own_recording'),
      imageBase64: notJpeg,
    })
    assert.equal(rejectedImage.status, 400)
    assert.equal(rejectedImage.body.field, 'imageBase64')

    const oversized = Buffer.alloc(262145, 0)
    oversized[0] = 0xff
    oversized[1] = 0xd8
    oversized[2] = 0xff
    oversized[oversized.length - 2] = 0xff
    oversized[oversized.length - 1] = 0xd9
    const rejectedSize = await ask(server, 'POST', `/replications/${replicationId}/events`, {
      ...imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', 'own_recording'),
      imageBase64: oversized.toString('base64'),
    })
    assert.equal(rejectedSize.status, 400)
    assert.equal(rejectedSize.body.field, 'imageBase64')
    assert.equal((await ask(server, 'GET', `/replications/${replicationId}`)).body.events.length, 5)

    const finished = await ask(server, 'POST', `/replications/${replicationId}/finish`, {})
    assert.equal(finished.status, 200)
    assert.equal(finished.body.status, 'completed')
    assert.equal(finished.body.execution.sessionEnded, true)
    assert.deepEqual(finished.body.execution.unfinishedStepIndexes, [0, 2, 3])
    assert.match(finished.body.completionNote, /not that the experiment succeeded/)
    assert.deepEqual(finished.body.protocolSnapshot, executionSnapshot)
    assert.equal((await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 2))).status, 409)
    assert.equal((await ask(server, 'POST', `/replications/${replicationId}/events`, humanCompletion(completionId, 0))).status, 200)

    const saved = await ask(server, 'GET', `/replications/${replicationId}`)
    assert.equal(saved.body.events.length, 5)
    assert.deepEqual(saved.body.events.map((event) => event.id), [completionId, ownImageId, referenceImageId, correctionId, secondCompletionId])
    assert.deepEqual(saved.body.protocolSnapshot, executionSnapshot)
    const experiment = await ask(server, 'GET', `/experiments/${experimentId}`)
    assert.deepEqual(experiment.body.protocolSnapshot, executionSnapshot)
    saved.body.protocolSnapshot.steps.push({ instruction: 'tamper' })
    assert.deepEqual((await ask(server, 'GET', `/replications/${replicationId}`)).body.protocolSnapshot, executionSnapshot)
  } finally {
    server.close()
  }
})

test('image observations keep video time, crop, and a rejected measurement', async () => {
  const store = createMemoryStore()
  const server = await listen(store)
  try {
    const published = await ask(server, 'POST', '/experiments', publishBody({ protocolSnapshot: executionSnapshot }))
    const planned = await ask(server, 'POST', '/replications', { experimentId: published.body.id })
    const replicationId = planned.body.id
    await ask(server, 'POST', `/replications/${replicationId}/start`, {})
    const rejected = {
      metric: 'spatial_color_dispersion',
      value: null,
      quality: 'rejected',
      reason: 'Too much dark/clipped area; choose a clear liquid region',
      analysisVersion: 'rgb-chromaticity-6x6-v1',
    }
    const saved = await ask(server, 'POST', `/replications/${replicationId}/events`, imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10', 'imported_reference', rejected))
    assert.equal(saved.status, 201)
    assert.equal(saved.body.events[0].measurement.value, null)
    assert.equal(saved.body.events[0].measurement.reason, rejected.reason)
    assert.notEqual(saved.body.events[0].measurement.value, 0)
    const zero = await ask(server, 'POST', `/replications/${replicationId}/events`, imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11', 'imported_reference', { ...rejected, value: 0 }))
    assert.equal(zero.status, 400)
    assert.equal(zero.body.field, 'measurement')
    const negative = await ask(server, 'POST', `/replications/${replicationId}/events`, { ...imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12', 'imported_reference'), videoTimeSec: -0.01 })
    assert.equal(negative.status, 400)
    assert.equal(negative.body.field, 'videoTimeSec')
    const crop = await ask(server, 'POST', `/replications/${replicationId}/events`, { ...imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13', 'imported_reference'), crop: { x: 98, y: 0, width: 5, height: 20 } })
    assert.equal(crop.status, 400)
    assert.equal(crop.body.field, 'crop')
    const extra = await ask(server, 'POST', `/replications/${replicationId}/events`, { ...imageObservation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14', 'imported_reference'), analysisVersion: 'rgb-chromaticity-6x6-v1' })
    assert.equal(extra.status, 400)
    assert.equal((await ask(server, 'GET', `/replications/${replicationId}`)).body.events.length, 1)
  } finally {
    server.close()
  }
})

test('older image events stay readable without invented method metadata', () => {
  const presented = presentReplication({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20',
    experimentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21',
    protocolSnapshot: executionSnapshot,
    status: 'in_progress',
    note: 'Planned replication. This record does not mean the experiment was performed or reproduced.',
    createdAt: '2026-11-14T22:11:30.873Z',
    startedAt: '2026-11-14T22:20:00.000Z',
    finishedAt: null,
    completionNote: null,
    events: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22',
      type: 'image_observation',
      stepIndex: 3,
      measurement: { dispersion: 0.05 },
    }],
  })
  assert.deepEqual(presented.events[0].measurement, { dispersion: 0.05 })
  assert.equal(Object.hasOwn(presented.events[0], 'source'), false)
  assert.equal(Object.hasOwn(presented.events[0], 'videoTimeSec'), false)
  assert.equal(Object.hasOwn(presented.events[0], 'crop'), false)
  assert.equal(Object.hasOwn(presented.events[0].measurement, 'analysisVersion'), false)
})

test('an unavailable database does not start a replication session', async () => {
  const server = await listen(createUnavailableStore())
  try {
    const started = await ask(server, 'POST', `/replications/${MISSING}/start`, {})
    assert.equal(started.status, 503)
    assert.equal(started.body.error, 'database_unavailable')
    assert.equal(started.body.id, undefined)
  } finally {
    server.close()
  }
})

test('real MongoDB publish, list, open, and planned replication', {
  skip: realDatabaseConfigured()
    ? false
    : 'MONGODB_URI or MONGODB_DB is not set to a real database. This check was not run against Atlas.',
}, async () => {
  const store = createStoreFromEnv(process.env)
  const marker = `library-test-${randomUUID()}`
  let experimentId
  let replicationId
  try {
    const health = await store.health()
    assert.equal(health.database, 'available')
    const published = await store.publish({
      ...publishBody({ title: marker }),
      protocolSnapshot: { marker, revision: 1 },
    })
    experimentId = published.id
    const listed = await store.list({ limit: 50, offset: 0 })
    assert.equal(listed.experiments.some((item) => item.id === experimentId && item.title === marker), true)
    const opened = await store.open(experimentId)
    assert.deepEqual(opened.protocolSnapshot, { marker, revision: 1 })
    const replication = await store.replicate(experimentId)
    replicationId = replication.id
    assert.equal(replication.status, 'planned')
    assert.deepEqual(replication.protocolSnapshot, opened.protocolSnapshot)
    const reread = await store.openReplication(replicationId)
    assert.equal(reread.id, replicationId)
    assert.equal(reread.experimentId, experimentId)
    assert.equal(reread.status, 'planned')
    assert.deepEqual(reread.protocolSnapshot, opened.protocolSnapshot)
  } finally {
    const dbName = process.env.MONGODB_DB
    if (experimentId) await store.client.db(dbName).collection('experiments').deleteOne({ _id: experimentId })
    if (replicationId) await store.client.db(dbName).collection('replications').deleteOne({ _id: replicationId })
    await store.client.close()
  }
})

test('real MongoDB execution persists and leaves existing demo records unchanged', {
  skip: realDatabaseConfigured()
    ? false
    : 'MONGODB_URI or MONGODB_DB is not set to a real database. This check was not run against Atlas.',
}, async () => {
  const store = createStoreFromEnv(process.env)
  const dbName = process.env.MONGODB_DB
  const protectedRecords = [
    ['experiments', 'bc946568-26e7-4585-82a2-8949e7164200'],
    ['replications', 'e847960c-13c0-42b3-b585-df6d4e95208d'],
    ['replications', 'c72934c1-506b-4f01-aac1-865498e859b6'],
  ]
  const before = []
  let experimentId
  let replicationId
  try {
    for (const [collection, id] of protectedRecords) {
      before.push(await store.client.db(dbName).collection(collection).findOne({ _id: id }))
    }
    const published = await store.publish({
      ...publishBody({ title: `execution-test-${randomUUID()}` }),
      protocolSnapshot: executionSnapshot,
    })
    experimentId = published.id
    const planned = await store.replicate(experimentId)
    replicationId = planned.id
    const started = await store.startExecution(replicationId)
    assert.equal(started.status, 'in_progress')
    const saved = await store.appendEvent(replicationId, {
      id: completionId,
      type: 'human_completion',
      stepIndex: 0,
      note: 'Persisted completion',
    })
    assert.equal(saved.created, true)
    const replay = await store.appendEvent(replicationId, {
      id: completionId,
      type: 'human_completion',
      stepIndex: 0,
      note: 'Persisted completion',
    })
    assert.equal(replay.created, false)
    assert.equal(replay.replication.events.length, 1)
    await assert.rejects(
      store.appendEvent(replicationId, humanCompletion('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 9)),
      (error) => error.code === 'invalid' && error.field === 'stepIndex',
    )
    const corrected = await store.appendEvent(replicationId, {
      id: correctionId,
      type: 'correction',
      stepIndex: 0,
      correctsEventId: completionId,
      note: 'Retract the persisted completion.',
    })
    assert.equal(corrected.replication.events.length, 2)
    assert.equal(corrected.replication.execution.steps[0].humanCompleted, false)
    const finished = await store.finishExecution(replicationId)
    assert.equal(finished.status, 'completed')
    assert.deepEqual(finished.execution.unfinishedStepIndexes, [0, 1, 2, 3])
    const reread = await store.openReplication(replicationId)
    assert.equal(reread.status, 'completed')
    assert.deepEqual(reread.events.map((event) => event.id), [completionId, correctionId])
    assert.deepEqual(reread.protocolSnapshot, executionSnapshot)
    assert.deepEqual((await store.open(experimentId)).protocolSnapshot, executionSnapshot)
  } finally {
    if (experimentId) await store.client.db(dbName).collection('experiments').deleteOne({ _id: experimentId })
    if (replicationId) await store.client.db(dbName).collection('replications').deleteOne({ _id: replicationId })
    for (let index = 0; index < protectedRecords.length; index += 1) {
      const [collection, id] = protectedRecords[index]
      const after = await store.client.db(dbName).collection(collection).findOne({ _id: id })
      assert.deepEqual(after, before[index])
    }
    if (replicationId) {
      const removed = await store.client.db(dbName).collection('replications').findOne({ _id: replicationId })
      assert.equal(removed, null)
    }
    await store.client.close()
  }
})
