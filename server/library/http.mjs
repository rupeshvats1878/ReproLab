import { LibraryError } from './errors.mjs'
import { validateExperimentId, validateListQuery, validatePublish, validateReplication } from './validate.mjs'

const MAX_BODY_BYTES = 48 * 1024

export function createLibraryServer({ store }) {
  return async function handle(req, res) {
    try {
      await route(req, res, store)
    } catch (error) {
      const response = publicError(error)
      send(res, response.status, response.body)
    }
  }
}

async function route(req, res, store) {
  const origin = req.headers.origin
  if (localDevOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') {
    const health = await store.health()
    send(res, 200, { database: health.database === 'available' ? 'available' : 'unavailable' })
    return
  }

  if (req.method === 'POST' && url.pathname === '/experiments') {
    const input = validatePublish(await readJson(req))
    await assertDatabase(store)
    send(res, 201, await store.publish(input))
    return
  }

  if (req.method === 'GET' && url.pathname === '/experiments') {
    const query = validateListQuery(url.searchParams)
    await assertDatabase(store)
    send(res, 200, await store.list(query))
    return
  }

  const experimentPath = /^\/experiments\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'GET' && experimentPath) {
    const id = validateExperimentId(decodeURIComponent(experimentPath[1]))
    await assertDatabase(store)
    send(res, 200, await store.open(id))
    return
  }

  if (req.method === 'POST' && url.pathname === '/replications') {
    const { experimentId } = validateReplication(await readJson(req))
    await assertDatabase(store)
    send(res, 201, await store.replicate(experimentId))
    return
  }

  const replicationPath = /^\/replications\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'GET' && replicationPath) {
    const id = validateExperimentId(decodeURIComponent(replicationPath[1]))
    await assertDatabase(store)
    send(res, 200, await store.openReplication(id))
    return
  }

  send(res, 404, { error: 'not_found' })
}

async function assertDatabase(store) {
  const health = await store.health()
  if (health.database !== 'available') throw new LibraryError('unavailable')
}

async function readJson(req) {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new LibraryError('too_large')
  const text = await readBody(req, MAX_BODY_BYTES)
  if (!text) throw new LibraryError('invalid', 'body')
  try {
    return JSON.parse(text)
  } catch {
    throw new LibraryError('invalid', 'body')
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > max) {
        failed = true
        reject(new LibraryError('too_large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => {
      if (!failed) reject(new LibraryError('invalid', 'body'))
    })
  })
}

function publicError(error) {
  if (error instanceof LibraryError) {
    if (error.code === 'approval_required') return { status: 400, body: { error: 'approval_required' } }
    if (error.code === 'invalid') return { status: 400, body: { error: 'invalid_input', field: error.field ?? 'body' } }
    if (error.code === 'not_found') return { status: 404, body: { error: 'not_found' } }
    if (error.code === 'too_large') return { status: 413, body: { error: 'payload_too_large' } }
    if (error.code === 'unavailable') return { status: 503, body: { error: 'database_unavailable' } }
  }
  return { status: 500, body: { error: 'request_failed' } }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function localDevOrigin(origin) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}
