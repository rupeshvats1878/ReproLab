import { describe, expect, it } from 'vitest'
import { DEMO_COMPLETE } from '../shared/exampleRun.ts'
import { memoryRunStore, saveRun, storageErrorMessage } from './store.ts'

describe('local run store', () => {
  it('saves, restores, and deletes a record without embedding blobs', () => {
    const store = memoryRunStore()
    return (async () => {
      const saved = await saveRun(store, DEMO_COMPLETE)
      expect(saved.media.every((media) => media.available === false)).toBe(true)
      await store.putBlob(
        DEMO_COMPLETE.media[0]!.mediaId,
        new Blob(['bytes-not-in-json'], { type: 'video/webm' }),
      )
      const withVideo = await saveRun(store, {...DEMO_COMPLETE, media: DEMO_COMPLETE.media.map((m, i) => ({...m, available: i === 0}))})
      expect(withVideo.media[0]?.available).toBe(true)
      expect(withVideo.media[1]?.available).toBe(false)
      expect(JSON.stringify(withVideo)).not.toContain('bytes-not-in-json')
      const listed = await store.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]?.metadata.id).toBe(DEMO_COMPLETE.metadata.id)
      const blob = await store.getBlob(DEMO_COMPLETE.media[0]!.mediaId)
      expect(await blob?.text()).toBe('bytes-not-in-json')
      await store.delete(DEMO_COMPLETE.metadata.id)
      expect(await store.list()).toEqual([])
      expect(await store.getBlob(DEMO_COMPLETE.media[0]!.mediaId)).toBeUndefined()
    })()
  })

  it('describes a quota failure', () => {
    const error = new Error('full')
    error.name = 'QuotaExceededError'
    expect(storageErrorMessage(error)).toMatch(/quota/i)
    expect(storageErrorMessage(new Error('nope'))).toMatch(/could not use local storage/i)
  })
})
