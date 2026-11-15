import { describe, expect, it } from 'vitest'
import { buildAdapterImport, buildClipCheckRequest, buildRecordingLink, clipHeadline, clipIdentityCopy, clipRailItems, clipStatusCopy, localVideoId, sourceHashFromManifest, shouldApplyClipResponse, type ClipCheckResponse } from './clipCheck.ts'

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

  it('shows a linked hypothesis on the original recording and hides an unconfirmed result', () => {
    const linked: ClipCheckResponse = {
      status: 'hypothesis',
      provenance: 'synthetic',
      linked: true,
      sessionId: 'external-session',
      videoId: 'recording-1',
      sourceOffsetMs: 84000,
      needsHumanVerification: true,
      association: {
        kind: 'user-confirmed',
        monitorSessionId: 'session_1',
        monitorVideoId: 'local-1-recording.mov',
        recordingDurationMs: 200000,
        sessionId: 'external-session',
        videoId: 'recording-1',
        sourceOffsetMs: 84000,
        clipStartMs: 84000,
        clipEndMs: 92000,
      },
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
    const items = clipRailItems(linked, 'local-1-recording.mov')
    expect(items.map((item) => item.mediaMs)).toEqual([85000, 86000])
    expect(items.every((item) => item.source === 'Synthetic fixture')).toBe(true)
    expect(items.every((item) => item.detail.includes('does not complete a step'))).toBe(true)
    expect(clipIdentityCopy(linked)).toMatch(/user confirmation/)
    expect(clipIdentityCopy(linked)).toMatch(/external-session/)
    expect(clipIdentityCopy(linked)).toMatch(/not an observation/)
    expect(clipRailItems({ ...linked, linked: false, association: null })).toEqual([])
    expect(clipRailItems(linked, 'local-2-other.mov')).toEqual([])
    expect(clipRailItems({
      ...linked,
      provenance: 'adapter',
      association: linked.association && { ...linked.association, recordingDurationMs: 85500 },
      events: [{ ...linked.events![0], evidenceTimestampsMs: [86000] }],
    }, 'local-1-recording.mov').map((item) => item.mediaMs)).toEqual([85000])
    expect(clipRailItems({
      ...linked,
      status: 'uncertain',
      provenance: 'adapter',
      events: [{ ...linked.events![0], seekable: false, evidenceTimestampsMs: [93000] }],
    }, 'local-1-recording.mov')).toMatchObject([{ seekable: false, mediaMs: 85000, source: 'Unverified' }])
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

  it('builds a recording link without rewriting the saved document', () => {
    const document = {
      sessionId: 'local-review-recording-1',
      videoId: 'recording-1',
      sourceOffsetMs: 84000,
      videoDurationMs: 8000,
    }
    const built = buildRecordingLink({
      requestId: 'request_1',
      document,
      monitorSessionId: 'session_1',
      monitorVideoId: 'local-9-recording.mov',
      recordingDurationMs: 180000,
      recordingSha256: null,
      manifestSha256: null,
      confirm: true,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.sessionId).toBe('local-review-recording-1')
    expect(built.body.document).toBe(document)
    expect(built.body.confirm).toBe(true)
    expect(JSON.stringify(built.body)).not.toMatch(/clipPath|authorize/)
    expect(sourceHashFromManifest({ sourceSha256AfterEncoding: 'ab'.repeat(32) })).toEqual({ ok: true, sha256: 'ab'.repeat(32) })
    expect(sourceHashFromManifest({ sha256: 'ab'.repeat(32) })).toEqual({ ok: true, sha256: null })
  })
})