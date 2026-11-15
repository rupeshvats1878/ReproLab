import { getVisionBlob, forgetVisionBlob } from '../vision/media.ts'
import type { RunRecord } from '../shared/types.ts'

export interface RunStore {
  save(record: RunRecord): Promise<void>
  list(): Promise<RunRecord[]>
  delete(id: string): Promise<void>
  putBlob(mediaId: string, blob: Blob): Promise<void>
  getBlob(mediaId: string): Promise<Blob | undefined>
  hasBlob(mediaId: string): Promise<boolean>
  deleteBlob(mediaId: string): Promise<void>
}

export function memoryRunStore(): RunStore {
  const runs = new Map<string, RunRecord>()
  const blobs = new Map<string, Blob>()
  return {
    async save(record) {
      runs.set(record.metadata.id, structuredClone(record))
    },
    async list() {
      return [...runs.values()].map((record) => structuredClone(record))
    },
    async delete(id) {
      const record = runs.get(id)
      runs.delete(id)
      for (const media of record?.media ?? []) { blobs.delete(media.mediaId); forgetVisionBlob(media.mediaId) }
    },
    async putBlob(mediaId, blob) {
      blobs.set(mediaId, blob)
    },
    async getBlob(mediaId) {
      return blobs.get(mediaId) ?? getVisionBlob(mediaId)
    },
    async hasBlob(mediaId) {
      return blobs.has(mediaId)
    },
    async deleteBlob(mediaId) {
      blobs.delete(mediaId)
      forgetVisionBlob(mediaId)
    },
  }
}

export function storageErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'This browser refused to store more LabBench data (storage quota).'
  }
  return 'LabBench could not use local storage.'
}

export async function saveRun(store: RunStore, record: RunRecord): Promise<RunRecord> {
  for (const item of record.media) {
    const blob = getVisionBlob(item.mediaId)
    if (blob) await store.putBlob(item.mediaId, blob)
  }
  const media = await Promise.all(
    record.media.map(async (item) => ({
      ...item,
      available: item.available && await store.hasBlob(item.mediaId),
    })),
  )
  const next: RunRecord = { ...record, media }
  await store.save(next)
  return next
}

const DB_NAME = 'labbench-review'
const DB_VERSION = 1

export function createRunStore(): RunStore {
  if (typeof indexedDB === 'undefined') return memoryRunStore()
  return indexedDbRunStore()
}

function indexedDbRunStore(): RunStore {
  return {
    async save(record) {
      const db = await openDb()
      try {
        const tx = db.transaction('runs', 'readwrite')
        tx.objectStore('runs').put(record, record.metadata.id)
        await transactionDone(tx)
      } finally {
        db.close()
      }
    },
    async list() {
      const db = await openDb()
      try {
        const tx = db.transaction('runs', 'readonly')
        const records = await requestToPromise(tx.objectStore('runs').getAll())
        await transactionDone(tx)
        return records as RunRecord[]
      } finally {
        db.close()
      }
    },
    async delete(id) {
      const db = await openDb()
      try {
        const read = db.transaction('runs', 'readonly')
        const record = (await requestToPromise(read.objectStore('runs').get(id))) as RunRecord | undefined
        await transactionDone(read)
        const tx = db.transaction(['runs', 'blobs'], 'readwrite')
        tx.objectStore('runs').delete(id)
        for (const media of record?.media ?? []) { tx.objectStore('blobs').delete(media.mediaId); forgetVisionBlob(media.mediaId) }
        await transactionDone(tx)
      } finally {
        db.close()
      }
    },
    async putBlob(mediaId, blob) {
      const db = await openDb()
      try {
        const tx = db.transaction('blobs', 'readwrite')
        tx.objectStore('blobs').put(blob, mediaId)
        await transactionDone(tx)
      } finally {
        db.close()
      }
    },
    async getBlob(mediaId) {
      const db = await openDb()
      try {
        const tx = db.transaction('blobs', 'readonly')
        const blob = (await requestToPromise(tx.objectStore('blobs').get(mediaId))) as Blob | undefined
        await transactionDone(tx)
        return blob ?? getVisionBlob(mediaId)
      } finally {
        db.close()
      }
    },
    async hasBlob(mediaId) {
      const blob = await this.getBlob(mediaId)
      return blob != null
    },
    async deleteBlob(mediaId) {
      forgetVisionBlob(mediaId)
      const db = await openDb()
      try {
        const tx = db.transaction('blobs', 'readwrite')
        tx.objectStore('blobs').delete(mediaId)
        await transactionDone(tx)
      } finally {
        db.close()
      }
    },
  }
}

export async function keepLocalMedia(mediaId: string, blob: Blob): Promise<void> {
  await createRunStore().putBlob(mediaId, blob)
}

export async function readLocalMedia(mediaId: string): Promise<Blob | undefined> {
  return getVisionBlob(mediaId) ?? createRunStore().getBlob(mediaId)
}

export async function dropLocalMedia(mediaId: string): Promise<void> {
  await createRunStore().deleteBlob(mediaId)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs')
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}
