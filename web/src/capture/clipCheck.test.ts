import { describe, expect, it } from 'vitest'
import { buildClipCheckRequest, clipHeadline, clipStatusCopy, localVideoId, shouldApplyClipResponse } from './clipCheck.ts'

describe('clip check requests', () => {
  it('sets the source offset from the clip start and rejects a window over 60 seconds', () => {
    const request = buildClipCheckRequest({
      sessionId: 'session_1',
      videoId: localVideoId({ name: 'recording 1.mov', bytes: 142963865 }),
      requestId: 'request_1',
      startSeconds: 84,
      endSeconds: 92,
    })
    expect(request).toMatchObject({ sourceOffsetMs: 84000, clipStartMs: 84000, clipEndMs: 92000 })
    expect(buildClipCheckRequest({
      sessionId: 'session_1',
      videoId: 'video',
      requestId: 'request_1',
      startSeconds: 0,
      endSeconds: 61,
    })).toBeNull()
  })

  it('ignores a stale or wrong-request response', () => {
    const active = { generation: 2, requestId: 'request_2' }
    expect(shouldApplyClipResponse(active, { generation: 2, requestId: 'request_2' })).toBe(true)
    expect(shouldApplyClipResponse(active, { generation: 1, requestId: 'request_2' })).toBe(false)
    expect(shouldApplyClipResponse(active, { generation: 2, requestId: 'request_1' })).toBe(false)
  })

  it('describes authorization, failure, and unverified results without presenting a detection', () => {
    expect(clipStatusCopy('awaiting-authorization')).toMatch(/Awaiting authorization/)
    expect(clipStatusCopy('awaiting-authorization')).toMatch(/No video was sent/)
    expect(clipStatusCopy('processing')).toMatch(/No result yet/)
    expect(clipStatusCopy('unavailable')).toMatch(/unavailable/)
    expect(clipStatusCopy('unavailable')).toMatch(/No video was sent/)
    expect(clipStatusCopy('rejected')).toMatch(/rejected/)
    expect(clipHeadline('hypothesis')).toMatch(/Unverified/)
    expect(clipStatusCopy('hypothesis')).toMatch(/person still has to review/)
    expect(clipStatusCopy('uncertain')).not.toMatch(/no visible transfer/)
    expect(clipStatusCopy('no-transfer')).toMatch(/no visible transfer/)
  })
})