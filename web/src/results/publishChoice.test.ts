import { describe, expect, it } from 'vitest'
import { formatByteSize, nextPublicationAction, SHARED_RECORDING_LIMIT_BYTES } from './publishChoice.ts'

describe('publication recording choice', () => {
  it('uploads when a recording is requested and holds after a failed upload', () => {
    expect(nextPublicationAction({ includeRecording: true, uploadFailed: false, publishWithoutConfirmed: false })).toBe('upload')
    expect(nextPublicationAction({ includeRecording: true, uploadFailed: true, publishWithoutConfirmed: false })).toBe('hold')
    expect(nextPublicationAction({ includeRecording: true, uploadFailed: true, publishWithoutConfirmed: true })).toBe('publish-without')
    expect(nextPublicationAction({ includeRecording: false, uploadFailed: false, publishWithoutConfirmed: false })).toBe('publish-without')
  })

  it('states the shared limit in megabytes', () => {
    expect(SHARED_RECORDING_LIMIT_BYTES).toBe(80 * 1024 * 1024)
    expect(formatByteSize(SHARED_RECORDING_LIMIT_BYTES)).toBe('80.0 MB')
  })
})
