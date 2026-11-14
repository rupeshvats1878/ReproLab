import { randomUUID } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { LibraryError } from './errors.mjs'
import { experimentRecord, experimentSummary, replicationRecord } from './records.mjs'

const DB_NAME = /^[A-Za-z0-9_-]{1,64}$/

export function createMemoryStore({ now = () => new Date().toISOString(), ids = randomUUID } = {}) {
  const experiments = []
  const replications = []
  return {
    async health() {
      return { database: 'available' }
    },
    async publish(input) {
      const record = experimentRecord(input, { id: ids(), publishedAt: now() })
      experiments.push(record)
      return structuredClone(record)
    },
    async list({ limit, offset }) {
      const ordered = [...experiments].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
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
      return structuredClone(record)
    },
    async openReplication(id) {
      const found = replications.find((item) => item.id === id)
      if (!found) throw new LibraryError('not_found')
      return structuredClone(found)
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
    async list({ limit, offset }) {
      await requireDatabase()
      try {
        const total = await experiments().countDocuments()
        const docs = await experiments()
          .find({}, { projection: { protocolSnapshot: 0, _id: 0 } })
          .sort({ publishedAt: -1, id: 1 })
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
        return record
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
        return doc
      } catch (error) {
        if (error instanceof LibraryError) throw error
        throw new LibraryError('unavailable')
      }
    },
  }
}
