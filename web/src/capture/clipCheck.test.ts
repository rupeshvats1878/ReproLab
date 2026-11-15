import { describe, expect, it } from 'vitest'
import { buildAdapterImport, buildClipCheckRequest, clipHeadline, clipIdentityCopy, clipRailItems, clipStatusCopy, localVideoId, shouldApplyClipResponse, type ClipCheckResponse } from './clipCheck.ts'

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
    expect(shouldApplyClipResponse(active, { generation: 2 })).toBe(false)
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
    expect(clipStatusCopy('hypothesis')).toMatch(/does not complete a step/)
    expect(clipStatusCopy('uncertain')).not.toMatch(/no visible transfer/)
    expect(clipStatusCopy('no-transfer')).toMatch(/no visible transfer/)
    expect(clipStatusCopy('unavailable', null, 'remote_disabled')).toMatch(/remote_disabled/)
    expect(clipStatusCopy('unavailable', null, 'timeout', true)).toMatch(/A clip was submitted/)
    expect(clipStatusCopy('unavailable', null, 'timeout', true)).not.toMatch(/No video was sent/)
  })

  it('shows a synthetic hypothesis on the original recording and hides a mismatched result', () => {
    const matching: ClipCheckResponse = {
      status: 'hypothesis',
      provenance: 'synthetic',
      matchesOpenReview: true,
      sourceOffsetMs: 84000,
      needsHumanVerification: true,
      events: [{
        eventId: 'request_1:0',
        sourceCupId: 'RED',
        destinationCupId: 'BLUE',
        eventStartMs: 85000,
        eventEndMs: 87000,
        evidenceTimestampsMs: [86000],
        seekable: true,
        needsHumanVerification: true,
      }],
    }
    const items = clipRailItems(matching)
    expect(items.map((item) => item.mediaMs)).toEqual([85000, 86000])
    expect(items.every((item) => item.source === 'Synthetic fixture')).toBe(true)
    expect(items.every((item) => item.detail.includes('does not complete a step'))).toBe(true)
    expect(clipIdentityCopy(matching)).toMatch(/Synthetic fixture/)
    expect(clipIdentityCopy(matching)).toMatch(/not an observation/)
    expect(clipRailItems({ ...matching, matchesOpenReview: false })).toEqual([])
    expect(clipRailItems({
      ...matching,
      status: 'uncertain',
      provenance: 'adapter',
      events: [{ ...matching.events![0], seekable: false, evidenceTimestampsMs: [93000] }],
    })).toMatchObject([{ seekable: false, mediaMs: 85000, source: 'Unverified' }])
  })

  it('builds an import from the saved document without adding the offset again', () => {
    const built = buildAdapterImport({
      monitorSessionId: 'session_1',
      monitorVideoId: 'local-1-recording.mov',
      requestId: 'request_1',
      document: {
        sessionId: 'local-review-recording-1',
        videoId: 'recording-1',
        sourceOffsetMs: 84000,
        videoDurationMs: 8000,
        events: [{ eventStartMs: 85000 }],
      },
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body).toMatchObject({ sourceOffsetMs: 84000, clipStartMs: 84000, clipEndMs: 92000 })
    expect(JSON.stringify(built.body)).not.toMatch(/clipPath|authorize/)
  })
})