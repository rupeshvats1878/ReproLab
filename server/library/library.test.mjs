import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import { LISTEN_HOST, start } from './index.mjs'
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
