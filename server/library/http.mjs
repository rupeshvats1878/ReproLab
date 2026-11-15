import { beginClipCheck, finishClipCheck, importAdapterReview, linkAdapterReview } from './clipObservation.mjs'
import { LibraryError } from './errors.mjs'
import { SHARED_MEDIA_LIMIT_BYTES, mediaContentType } from './mediaLimit.mjs'
import {
  validateExecutionEvent,
  validateExecutionFinish,
  validateExecutionStart,
  validateExperimentId,
  validateExperimentListQuery,
  validateListQuery,
  validateMonitorEvent,
  validateMonitorSession,
  validatePublish,
  validateReplication,
  validateSessionPublish,
} from './validate.mjs'

const MAX_BODY_BYTES = 48 * 1024
const MAX_EVENT_BYTES = 400_000

export function createLibraryServer({ store, mediaLimit = SHARED_MEDIA_LIMIT_BYTES }) {
  return async function handle(req, res) {
    try {
      await route(req, res, store, mediaLimit)
    } catch (error) {
      const response = publicError(error)
      send(res, response.status, response.body)
    }
  }
}

async function route(req, res, store, mediaLimit) {
  const origin = req.headers.origin
  if (localDevOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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
        const query = validateExperimentListQuery(url.searchParams)
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

  const replicationAction = /^\/replications\/([^/]+)\/(start|events|finish)$/.exec(url.pathname)
  if (req.method === 'POST' && replicationAction) {
    const id = validateExperimentId(decodeURIComponent(replicationAction[1]))
    const action = replicationAction[2]
    if (action === 'events') {
      const input = validateExecutionEvent(await readJson(req, MAX_EVENT_BYTES))
      await assertDatabase(store)
      const result = await store.appendEvent(id, input)
      send(res, result.created ? 201 : 200, result.replication)
      return
    }
    const read = action === 'start' ? validateExecutionStart : validateExecutionFinish
    read(await readJson(req))
    await assertDatabase(store)
    const replication = action === 'start' ? await store.startExecution(id) : await store.finishExecution(id)
    send(res, action === 'start' ? 201 : 200, replication)
    return
  }

  if (req.method === 'GET' && url.pathname === '/monitor-sessions') {
    const query = validateListQuery(url.searchParams)
    await assertDatabase(store)
    send(res, 200, await store.listMonitorSessions(query))
    return
  }

  if (req.method === 'POST' && url.pathname === '/monitor-sessions') {
    const input = validateMonitorSession(await readJson(req))
    await assertDatabase(store)
    const result = await store.createMonitorSession(input)
    send(res, result.created ? 201 : 200, result.session)
    return
  }

  const monitorAction = /^\/monitor-sessions\/([^/]+)(\/events)?$/.exec(url.pathname)
  if (monitorAction) {
    const id = decodeURIComponent(monitorAction[1])
    if (!/^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new LibraryError('invalid', 'sessionId')
    }
    const sessionId = `session_${id.slice('session_'.length).toLowerCase()}`
    if (req.method === 'GET' && !monitorAction[2]) {
      await assertDatabase(store)
      send(res, 200, await store.openMonitorSession(sessionId))
      return
    }
    if (req.method === 'POST' && monitorAction[2] === '/events') {
      const input = validateMonitorEvent(await readJson(req))
      await assertDatabase(store)
      const result = await store.appendMonitorEvent(sessionId, input)
      send(res, result.created ? 201 : 200, result.session)
      return
    }
  }

  const monitorFinish = /^\/monitor-sessions\/([^/]+)\/finish$/.exec(url.pathname)
  if (req.method === 'POST' && monitorFinish) {
    const sessionId = monitorSessionId(decodeURIComponent(monitorFinish[1]))
    validateExecutionFinish(await readJson(req))
    await assertDatabase(store)
    send(res, 200, await store.finishMonitorSession(sessionId))
    return
  }

  const monitorPublish = /^\/monitor-sessions\/([^/]+)\/publish$/.exec(url.pathname)
  if (req.method === 'POST' && monitorPublish) {
    const sessionId = monitorSessionId(decodeURIComponent(monitorPublish[1]))
    const { notes, recording } = validateSessionPublish(await readJson(req))
    await assertDatabase(store)
    const result = await store.publishRecordedExperiment(sessionId, notes, recording)
    send(res, result.created ? 201 : 200, result.experiment)
    return
  }

  if (req.method === 'POST' && url.pathname === '/media') {
    const mimeType = mediaContentType(req.headers['content-type'])
    const declared = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > mediaLimit) {
      req.resume()
      throw new LibraryError('too_large')
    }
    const bytes = await readBytes(req, mediaLimit)
    if (bytes.length === 0) throw new LibraryError('invalid', 'body')
    await assertDatabase(store)
    send(res, 201, await store.saveMedia({ mimeType, bytes }))
    return
  }

  const mediaPath = /^\/media\/(media_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url.pathname)
  if (mediaPath && (req.method === 'GET' || req.method === 'DELETE')) {
    const mediaId = `media_${mediaPath[1].slice('media_'.length).toLowerCase()}`
    await assertDatabase(store)
    if (req.method === 'DELETE') {
      send(res, 200, await store.deleteMedia(mediaId))
      return
    }
    const file = await store.openMedia(mediaId)
    await sendMedia(req, res, file)
    return
  }

  if (req.method === 'POST' && url.pathname === '/clip-observations') {
    const job = beginClipCheck(await readJson(req))
    send(res, 200, await finishClipCheck(job, { env: process.env }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/clip-observations/reviews/links') {
    send(res, 200, linkAdapterReview(await readJson(req)))
    return
  }

  if (req.method === 'POST' && url.pathname === '/clip-observations/reviews') {
    send(res, 200, importAdapterReview(await readJson(req)))
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

async function readJson(req, max = MAX_BODY_BYTES) {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > max) throw new LibraryError('too_large')
  const text = await readBody(req, max)
  if (!text) throw new LibraryError('invalid', 'body')
  try {
    return JSON.parse(text)
  } catch {
    throw new LibraryError('invalid', 'body')
  }
}

function readBytes(req, max) {
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
      if (!failed) resolve(Buffer.concat(chunks))
    })
    req.on('error', () => {
      if (!failed) reject(new LibraryError('invalid', 'body'))
    })
  })
}

function parseByteRange(header, total) {
  if (header == null || header === '') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match || total <= 0) return 'invalid'
  const startText = match[1]
  const endText = match[2]
  if (startText === '' && endText === '') return 'invalid'
  let start = startText === '' ? null : Number(startText)
  let end = endText === '' ? null : Number(endText)
  if (start == null) {
    if (end <= 0) return 'invalid'
    start = Math.max(0, total - end)
    end = total - 1
  } else if (end == null) {
    end = total - 1
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= total || end < start) return 'invalid'
  return { start, end: Math.min(end, total - 1) }
}

function sendMedia(req, res, file) {
  return new Promise((resolve, reject) => {
    const total = file.byteLength
    const range = parseByteRange(req.headers.range, total)
    res.setHeader('accept-ranges', 'bytes')
    res.setHeader('content-type', file.mimeType)
    res.setHeader('cache-control', 'private, max-age=0')
    if (range === 'invalid') {
      res.writeHead(416, { 'content-range': `bytes */${total}` })
      res.end()
      resolve()
      return
    }
    const start = range ? range.start : 0
    const end = range ? range.end + 1 : total
    if (range) {
      res.writeHead(206, {
        'content-range': `bytes ${range.start}-${range.end}/${total}`,
        'content-length': end - start,
      })
    } else {
      res.writeHead(200, { 'content-length': total })
    }
    const stream = file.open(start, end)
    stream.on('error', reject)
    res.on('error', reject)
    stream.on('end', resolve)
    stream.pipe(res)
  })
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
    if (error.code === 'invalid_state') return { status: 409, body: { error: 'invalid_state' } }
    if (error.code === 'duplicate') return { status: 409, body: { error: 'duplicate_event', field: error.field ?? 'id' } }
    if (error.code === 'unavailable') return { status: 503, body: { error: 'database_unavailable' } }
  }
  return { status: 500, body: { error: 'request_failed' } }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function monitorSessionId(id) {
  if (!/^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new LibraryError('invalid', 'sessionId')
  }
  return `session_${id.slice('session_'.length).toLowerCase()}`
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
