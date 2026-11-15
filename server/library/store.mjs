import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { GridFSBucket, MongoClient } from 'mongodb'
import { LibraryError } from './errors.mjs'
import { appendMonitorEvent, finishMonitorSession, monitorSession, presentMonitorSession, presentMonitorSummary, sameMonitorIdentity } from './monitorRecords.mjs'
import {
  appendExecutionEvent,
  beginExecution,
  compareExperiments,
  experimentRecord,
  experimentSummary,
  experimentTitleFilter,
  finishExecution,
  COMPLETION_NOTE,
  matchesExperimentTitle,
  presentReplication,
  recordedExperimentRecord,
  replicationRecord,
} from './records.mjs'

const DB_NAME = /^[A-Za-z0-9_-]{1,64}$/

export function createMemoryStore({ now = () => new Date().toISOString(), ids = randomUUID } = {}) {
  const experiments = []
  const replications = []
  const monitorSessions = []
  const media = new Map()
  return {
    async health() {
      return { database: 'available' }
    },
    async publish(input) {
      const record = experimentRecord(input, { id: ids(), publishedAt: now() })
      experiments.push(record)
      return structuredClone(record)
    },
    async list({ limit, offset, q = '', sort = 'newest' }) {
      const ordered = experiments.filter((item) => matchesExperimentTitle(item, q)).sort(compareExperiments(sort))
      return {
        experiments: ordered.slice(offset, offset + limit).map((item) => experimentSummary(structuredClone(item))),
        limit,
        offset,
        total: ordered.length,
      }
    },
    async open(id) {
      const found = experiments.find((item) => item.id === id)
      if (!found) throw new LibraryError('not_found')
      return structuredClone(found)
    },
    async replicate(experimentId) {
      const found = experiments.find((item) => item.id === experimentId)
      if (!found) throw new LibraryError('not_found')
      const record = replicationRecord(found, { id: ids(), createdAt: now() })
      replications.push(record)
      return presentReplication(record)
    },
    async openReplication(id) {
      const found = replications.find((item) => item.id === id)
      if (!found) throw new LibraryError('not_found')
      return presentReplication(found)
    },
    async startExecution(id) {
      const index = replications.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not_found')
      const next = beginExecution(replications[index], now())
      replications[index] = next
      return presentReplication(next)
    },
    async appendEvent(id, input) {
      const index = replications.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not_found')
      const result = appendExecutionEvent(replications[index], input, now())
      replications[index] = result.record
      return { created: result.created, replication: presentReplication(result.record) }
    },
    async finishExecution(id) {
      const index = replications.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not_found')
      const next = finishExecution(replications[index], now())
      replications[index] = next
      return presentReplication(next)
    },
    async openMonitorSession(id) {
      const found = monitorSessions.find((item) => item.id === id)
      if (!found) throw new LibraryError('not_found')
      return presentMonitorSession(found)
    },
    async listMonitorSessions({ limit, offset }) {
      const sorted = [...monitorSessions].sort((left, right) => {
        const time = String(right.recordedAt).localeCompare(String(left.recordedAt))
        return time || String(left.id).localeCompare(String(right.id))
      })
      return {
        sessions: sorted.slice(offset, offset + limit).map(presentMonitorSummary),
        limit,
        offset,
        total: sorted.length,
      }
    },
    async createMonitorSession(input) {
      const existing = monitorSessions.find((item) => item.id === input.sessionId)
      if (existing) {
        if (!sameMonitorIdentity(existing, input)) {
          throw new LibraryError('duplicate', 'sessionId')
        }
        return { created: false, session: presentMonitorSession(existing) }
      }
      const record = monitorSession(input, now())
      monitorSessions.push(record)
      return { created: true, session: presentMonitorSession(record) }
    },
    async appendMonitorEvent(id, input) {
      const index = monitorSessions.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not_found')
      const result = appendMonitorEvent(monitorSessions[index], input, now())
      monitorSessions[index] = result.session
      return { created: result.created, session: presentMonitorSession(result.session) }
    },
    async finishMonitorSession(id) {
      const index = monitorSessions.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not_found')
      const next = finishMonitorSession(monitorSessions[index], now())
      monitorSessions[index] = next
      return presentMonitorSession(next)
    },
    async publishRecordedExperiment(id, notes, recording = null) {
      const session = monitorSessions.find((item) => item.id === id)
      if (!session) throw new LibraryError('not_found')
      const existing = experiments.find((item) => item.monitorSessionId === id)
      if (existing) return { created: false, experiment: structuredClone(existing) }
      const shared = recording ? sharedFrom(media.get(recording.mediaId), recording) : null
      const record = recordedExperimentRecord(session, notes, { id: ids(), publishedAt: now(), shared })
      experiments.push(record)
      return { created: true, experiment: structuredClone(record) }
    },
    async saveMedia({ mimeType, bytes }) {
      const id = `media_${ids()}`
      media.set(id, { mimeType, bytes: Buffer.from(bytes) })
      return { id, byteLength: bytes.length, mimeType }
    },
    async openMedia(id) {
      const file = media.get(id)
      if (!file) throw new LibraryError('not_found')
      return mediaHandle(file.mimeType, file.bytes)
    },
  }
}

function sharedFrom(file, recording) {
  if (!file) throw new LibraryError('invalid', 'mediaId')
  return {
    evidenceId: recording.evidenceId,
    mediaId: recording.mediaId,
    byteLength: file.bytes.length,
    mimeType: file.mimeType,
  }
}

function mediaHandle(mimeType, bytes) {
  return {
    mimeType,
    byteLength: bytes.length,
    open(start = 0, end = bytes.length) {
      return Readable.from(bytes.subarray(start, end))
    },
  }
}

export function createUnavailableStore() {
  return {
    async health() {
      return { database: 'unavailable' }
    },
    async publish() {
      throw new LibraryError('unavailable')
    },
    async list() {
      throw new LibraryError('unavailable')
    },
    async open() {
      throw new LibraryError('unavailable')
    },
    async replicate() {
      throw new LibraryError('unavailable')
    },
    async openReplication() {
      throw new LibraryError('unavailable')
    },
    async startExecution() {
      throw new LibraryError('unavailable')
    },
    async appendEvent() {
      throw new LibraryError('unavailable')
    },
    async finishExecution() {
      throw new LibraryError('unavailable')
    },
    async openMonitorSession() {
      throw new LibraryError('unavailable')
    },
    async listMonitorSessions() {
      throw new LibraryError('unavailable')
    },
    async createMonitorSession() {
      throw new LibraryError('unavailable')
    },
    async appendMonitorEvent() {
      throw new LibraryError('unavailable')
    },
    async finishMonitorSession() {
      throw new LibraryError('unavailable')
    },
    async publishRecordedExperiment() {
      throw new LibraryError('unavailable')
    },
    async saveMedia() {
      throw new LibraryError('unavailable')
    },
    async openMedia() {
      throw new LibraryError('unavailable')
    },
  }
}

export function createStoreFromEnv(env = process.env) {
  const uri = env.MONGODB_URI
  const dbName = env.MONGODB_DB
  if (!uri || !DB_NAME.test(dbName ?? '')) return createUnavailableStore()
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000,
  })
  return createMongoStore({ client, dbName })
}

export function createMongoStore({ client, dbName }) {
  const experiments = () => client.db(dbName).collection('experiments')
  const replications = () => client.db(dbName).collection('replications')
  const monitorSessions = () => client.db(dbName).collection('monitorSessions')

  async function available() {
    try {
      await client.db(dbName).command({ ping: 1 })
      return true
    } catch {
      return false
    }
  }

  async function requireDatabase() {
    if (!(await available())) throw new LibraryError('unavailable')
  }

  return {
    client,
    async health() {
      return { database: (await available()) ? 'available' : 'unavailable' }
    },
    async publish(input) {
      await requireDatabase()
      const record = experimentRecord(input, { id: randomUUID(), publishedAt: new Date().toISOString() })
      try {
        await experiments().insertOne({ ...record, _id: record.id })
      } catch {
        throw new LibraryError('unavailable')
      }
      return record
    },
    async list({ limit, offset, q = '', sort = 'newest' }) {
      await requireDatabase()
      try {
        const filter = experimentTitleFilter(q)
        const direction = sort === 'oldest' ? 1 : -1
        const total = await experiments().countDocuments(filter)
        const docs = await experiments()
          .find(filter, {
            projection: {
              _id: 0,
              id: 1,
              title: 1,
              description: 1,
              authorDisplayName: 1,
              approvalAcknowledged: 1,
              publishedAt: 1,
              kind: 1,
              'protocolSnapshot.version': 1,
              'protocolSnapshot.steps': 1,
            },
          })
          .sort({ publishedAt: direction, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray()
        return { experiments: docs.map(experimentSummary), limit, offset, total }
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async open(id) {
      await requireDatabase()
      try {
        const doc = await experiments().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!doc) throw new LibraryError('not_found')
        return doc
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async replicate(experimentId) {
      await requireDatabase()
      try {
        const experiment = await experiments().findOne({ _id: experimentId }, { projection: { _id: 0 } })
        if (!experiment) throw new LibraryError('not_found')
        const record = replicationRecord(experiment, { id: randomUUID(), createdAt: new Date().toISOString() })
        await replications().insertOne({ ...record, _id: record.id })
        return presentReplication(record)
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async openReplication(id) {
      await requireDatabase()
      try {
        const doc = await replications().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!doc) throw new LibraryError('not_found')
        return presentReplication(doc)
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async startExecution(id) {
      await requireDatabase()
      const startedAt = new Date().toISOString()
      try {
        const updated = await replications().findOneAndUpdate(
          { _id: id, status: 'planned' },
          { $set: { status: 'in_progress', startedAt } },
          { returnDocument: 'after', projection: { _id: 0 } },
        )
        const doc = updatedDocument(updated)
        if (doc) return presentReplication(doc)
        const existing = await replications().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!existing) throw new LibraryError('not_found')
        throw new LibraryError('invalid_state')
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async appendEvent(id, input) {
      await requireDatabase()
      try {
        const current = await replications().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!current) throw new LibraryError('not_found')
        const recordedAt = new Date().toISOString()
        const decision = appendExecutionEvent(current, input, recordedAt)
        if (!decision.created) return { created: false, replication: presentReplication(decision.record) }
        const event = decision.record.events[decision.record.events.length - 1]
        const updated = await replications().findOneAndUpdate(
          {
            _id: id,
            status: 'in_progress',
            events: { $not: { $elemMatch: { id: event.id } } },
          },
          { $push: { events: event } },
          { returnDocument: 'after', projection: { _id: 0 } },
        )
        const doc = updatedDocument(updated)
        if (doc) return { created: true, replication: presentReplication(doc) }
        const again = await replications().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!again) throw new LibraryError('not_found')
        const retry = appendExecutionEvent(again, input, recordedAt)
        if (!retry.created) return { created: false, replication: presentReplication(retry.record) }
        throw new LibraryError('invalid_state')
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async finishExecution(id) {
      await requireDatabase()
      const finishedAt = new Date().toISOString()
      try {
        const updated = await replications().findOneAndUpdate(
          { _id: id, status: 'in_progress' },
          { $set: { status: 'completed', finishedAt, completionNote: COMPLETION_NOTE } },
          { returnDocument: 'after', projection: { _id: 0 } },
        )
        const doc = updatedDocument(updated)
        if (doc) return presentReplication(doc)
        const existing = await replications().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!existing) throw new LibraryError('not_found')
        throw new LibraryError('invalid_state')
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async openMonitorSession(id) {
      await requireDatabase()
      try {
        const doc = await monitorSessions().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!doc) throw new LibraryError('not_found')
        return presentMonitorSession(doc)
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async listMonitorSessions({ limit, offset }) {
      await requireDatabase()
      try {
        const total = await monitorSessions().countDocuments()
        const docs = await monitorSessions()
          .find({}, { projection: { events: 0, _id: 0 } })
          .sort({ recordedAt: -1, id: 1 })
          .skip(offset)
          .limit(limit)
          .toArray()
        return { sessions: docs.map(presentMonitorSummary), limit, offset, total }
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async createMonitorSession(input) {
      await requireDatabase()
      const record = monitorSession(input, new Date().toISOString())
      try {
        await monitorSessions().insertOne({ ...record, _id: record.id })
        return { created: true, session: presentMonitorSession(record) }
      } catch (error) {
        if (error instanceof LibraryError) throw error
        if (error?.code !== 11000) throw new LibraryError('unavailable')
        const existing = await monitorSessions().findOne({ _id: record.id }, { projection: { _id: 0 } })
        if (!existing) throw new LibraryError('unavailable')
        if (!sameMonitorIdentity(existing, input)) {
          throw new LibraryError('duplicate', 'sessionId')
        }
        return { created: false, session: presentMonitorSession(existing) }
      }
    },
    async appendMonitorEvent(id, input) {
      await requireDatabase()
      try {
        const current = await monitorSessions().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!current) throw new LibraryError('not_found')
        const recordedAt = new Date().toISOString()
        const decision = appendMonitorEvent(current, input, recordedAt)
        if (!decision.created) return { created: false, session: presentMonitorSession(decision.session) }
        const event = decision.session.events[decision.session.events.length - 1]
        const filter = {
          _id: id,
          events: { $not: { $elemMatch: { id: event.id } } },
        }
        if (event.provenance !== 'human') filter.blockedReason = null
        const update = { $push: { events: event } }
        if (event.type === 'block') update.$set = { blockedReason: event.reason }
        const updated = await monitorSessions().findOneAndUpdate(filter, update, {
          returnDocument: 'after',
          projection: { _id: 0 },
        })
        const doc = updatedDocument(updated)
        if (doc) return { created: true, session: presentMonitorSession(doc) }
        const again = await monitorSessions().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!again) throw new LibraryError('not_found')
        const retry = appendMonitorEvent(again, input, recordedAt)
        if (!retry.created) return { created: false, session: presentMonitorSession(retry.session) }
        throw new LibraryError('invalid_state')
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async finishMonitorSession(id) {
      await requireDatabase()
      try {
        const current = await monitorSessions().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!current) throw new LibraryError('not_found')
        if (current.finishedAt) return presentMonitorSession(current)
        const finishedAt = new Date().toISOString()
        const updated = await monitorSessions().findOneAndUpdate(
          { _id: id, $or: [{ finishedAt: null }, { finishedAt: { $exists: false } }] },
          { $set: { finishedAt } },
          { returnDocument: 'after', projection: { _id: 0 } },
        )
        const doc = updatedDocument(updated)
        if (doc) return presentMonitorSession(doc)
        const again = await monitorSessions().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!again) throw new LibraryError('not_found')
        if (again.finishedAt) return presentMonitorSession(again)
        throw new LibraryError('invalid_state')
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
    async saveMedia({ mimeType, bytes }) {
      await requireDatabase()
      const id = `media_${randomUUID()}`
      const bucket = new GridFSBucket(client.db(dbName), { bucketName: 'experimentMedia' })
      await new Promise((resolve, reject) => {
        const upload = bucket.openUploadStream(id, {
          contentType: mimeType,
          metadata: { role: 'experiment-recording' },
        })
        upload.on('error', reject)
        upload.on('finish', resolve)
        upload.end(Buffer.from(bytes))
      })
      return { id, byteLength: bytes.length, mimeType }
    },
    async openMedia(id) {
      await requireDatabase()
      const bucket = new GridFSBucket(client.db(dbName), { bucketName: 'experimentMedia' })
      const files = await bucket.find({ filename: id }).sort({ uploadDate: -1 }).limit(1).toArray()
      const file = files[0]
      if (!file) throw new LibraryError('not_found')
      return {
        mimeType: file.contentType || 'application/octet-stream',
        byteLength: file.length,
        open(start = 0, end = file.length) {
          return bucket.openDownloadStream(file._id, { start, end })
        },
      }
    },
    async publishRecordedExperiment(id, notes, recording = null) {
      await requireDatabase()
      try {
        const existing = await experiments().findOne({ monitorSessionId: id }, { projection: { _id: 0 } })
        if (existing) return { created: false, experiment: existing }
        const session = await monitorSessions().findOne({ _id: id }, { projection: { _id: 0 } })
        if (!session) throw new LibraryError('not_found')
        let shared = null
        if (recording) {
          let file
          try {
            file = await this.openMedia(recording.mediaId)
          } catch (error) {
            if (error instanceof LibraryError && error.code === 'not_found') throw new LibraryError('invalid', 'mediaId')
            throw error
          }
          shared = {
            evidenceId: recording.evidenceId,
            mediaId: recording.mediaId,
            byteLength: file.byteLength,
            mimeType: file.mimeType,
          }
        }
        const record = recordedExperimentRecord(session, notes, { id: randomUUID(), publishedAt: new Date().toISOString(), shared })
        try {
          await experiments().insertOne({ ...record, _id: record.id })
        } catch (error) {
          if (error?.code === 11000) {
            const raced = await experiments().findOne({ monitorSessionId: id }, { projection: { _id: 0 } })
            if (raced) return { created: false, experiment: raced }
          }
          throw new LibraryError('unavailable')
        }
        return { created: true, experiment: record }
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
  }
}

function updatedDocument(result) {
  if (!result) return null
  if (Object.hasOwn(result, 'value')) return result.value ?? null
  return result
}
