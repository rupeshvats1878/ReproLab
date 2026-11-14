import { describe, expect, it } from 'vitest'
import {
  CleanupBag,
  cameraErrorCopy,
  cameraRecordingDraft,
  chooseRecorderMime,
  durationMsFromSeconds,
  finalAssessmentFromStates,
  finalImageDraft,
  getVisionBlob,
  prerecordedDraft,
  releaseTracks,
  rememberVisionBlob,
  revokeObjectUrl,
} from './media.ts'
import { initialWellStates } from '../shared/protocol.ts'

describe('media metadata and cleanup', () => {
  it('picks the first supported recorder mime type', () => {
    expect(chooseRecorderMime((mime) => mime === 'video/webm')).toBe('video/webm')
    expect(chooseRecorderMime(() => false)).toBeUndefined()
  })

  it('rounds a finite duration and omits an unknown one', () => {
    expect(durationMsFromSeconds(1.234)).toBe(1234)
    expect(durationMsFromSeconds(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(durationMsFromSeconds(-1)).toBeUndefined()
  })

  it('does not mark a failed recording or a failed still as available', () => {
    const failed = cameraRecordingDraft({
      mediaId: 'media_failed',
      ok: false,
      runStartOffsetMs: -200,
      label: 'Live camera',
    })
    expect(failed.available).toBe(false)
    expect(failed.durationMs).toBeUndefined()
    expect(failed.label).toMatch(/failed/i)
    expect(failed.runStartOffsetMs).toBe(-200)

    const saved = cameraRecordingDraft({
      mediaId: 'media_ok',
      ok: true,
      mimeType: 'video/webm',
      runStartOffsetMs: 0,
      durationMs: 3200,
      label: 'Live camera',
    })
    expect(saved.available).toBe(true)
    expect(saved.durationMs).toBe(3200)

    const image = finalImageDraft({
      mediaId: 'media_image',
      ok: true,
      mimeType: 'image/png',
      label: 'Final plate',
    })
    expect(image.kind).toBe('final_plate_image')
    expect(image.runStartOffsetMs).toBe(0)
    expect(image.durationMs).toBeUndefined()

    const missing = finalImageDraft({
      mediaId: 'media_missing',
      ok: false,
      label: 'Final plate',
    })
    expect(missing.available).toBe(false)
  })

  it('keeps unknown wells unknown on a final-image assessment', () => {
    const states = { ...initialWellStates(), A1: 'filled' as const, A2: 'empty' as const }
    const draft = finalAssessmentFromStates(5000, 'media_image', states)
    const a1 = draft.wells.find((well) => well.wellId === 'A1')
    const a2 = draft.wells.find((well) => well.wellId === 'A2')
    const a3 = draft.wells.find((well) => well.wellId === 'A3')
    expect(a1).toMatchObject({ state: 'filled', matchesExpectedFilled: true })
    expect(a2).toMatchObject({ state: 'empty', matchesExpectedFilled: false })
    expect(a3).toMatchObject({ state: 'unknown', matchesExpectedFilled: false })
    expect(draft.mediaId).toBe('media_image')
  })

  it('stores blobs outside the JSON draft and releases tracks, urls, and timers once', () => {
    const blob = new Blob(['frame'], { type: 'image/png' })
    rememberVisionBlob('media_blob', blob)
    expect(getVisionBlob('media_blob')).toBe(blob)

    const file = prerecordedDraft({
      mediaId: 'media_blob',
      runStartOffsetMs: 250,
      durationMs: 8000,
      label: 'clip.webm',
    })
    expect(JSON.stringify(file)).not.toContain('frame')

    let stopped = 0
    expect(releaseTracks({ getTracks: () => [{ stop: () => (stopped += 1) }, { stop: () => (stopped += 1) }] })).toBe(2)
    expect(stopped).toBe(2)
    expect(releaseTracks(null)).toBe(0)

    const revoked: string[] = []
    revokeObjectUrl((url) => revoked.push(url), 'blob:one')
    revokeObjectUrl((url) => revoked.push(url), null)
    expect(revoked).toEqual(['blob:one'])

    const bag = new CleanupBag()
    let calls = 0
    bag.add(() => {
      calls += 1
    })
    bag.release()
    bag.release()
    expect(calls).toBe(1)
  })

  it('names camera permission and missing-device failures', () => {
    expect(cameraErrorCopy({ name: 'NotAllowedError' }).phase).toBe('denied')
    expect(cameraErrorCopy({ name: 'NotFoundError' }).phase).toBe('missing')
    expect(cameraErrorCopy(new Error('busy')).phase).toBe('failed')
  })
})
