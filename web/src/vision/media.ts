import type { FinalPlateDraft, MediaDraft, WellId, WellState } from '../shared/types.ts'
import { WELL_IDS } from '../shared/types.ts'

const RECORDER_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const

/** Session-lived bytes. JSON records only the id. Reload leaves metadata with available false. */
const visionBlobs = new Map<string, Blob>()

export function rememberVisionBlob(mediaId: string, blob: Blob): void {
  visionBlobs.set(mediaId, blob)
}

export function getVisionBlob(mediaId: string): Blob | undefined {
  return visionBlobs.get(mediaId)
}

export function visionBlobIds(): string[] {
  return [...visionBlobs.keys()]
}

export function chooseRecorderMime(isTypeSupported: (mime: string) => boolean): string | undefined {
  return RECORDER_CANDIDATES.find((mime) => isTypeSupported(mime))
}

export function durationMsFromSeconds(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return Math.round(seconds * 1000)
}

export function cameraRecordingDraft(args: {
  mediaId: string
  ok: boolean
  mimeType?: string
  runStartOffsetMs: number
  durationMs?: number
  label: string
}): MediaDraft {
  if (!args.ok) {
    return {
      mediaId: args.mediaId,
      kind: 'camera_recording',
      available: false,
      mimeType: args.mimeType,
      runStartOffsetMs: args.runStartOffsetMs,
      label: `${args.label} (recording failed)`,
    }
  }
  return {
    mediaId: args.mediaId,
    kind: 'camera_recording',
    available: true,
    mimeType: args.mimeType,
    runStartOffsetMs: args.runStartOffsetMs,
    ...(args.durationMs == null ? {} : { durationMs: args.durationMs }),
    label: args.label,
  }
}

export function prerecordedDraft(args: {
  mediaId: string
  mimeType?: string
  runStartOffsetMs: number
  durationMs?: number
  label: string
}): MediaDraft {
  return {
    mediaId: args.mediaId,
    kind: 'prerecorded_source',
    available: true,
    mimeType: args.mimeType,
    runStartOffsetMs: args.runStartOffsetMs,
    ...(args.durationMs == null ? {} : { durationMs: args.durationMs }),
    label: args.label,
  }
}

export function finalImageDraft(args: {
  mediaId: string
  ok: boolean
  mimeType?: string
  label: string
}): MediaDraft {
  return {
    mediaId: args.mediaId,
    kind: 'final_plate_image',
    available: args.ok,
    mimeType: args.mimeType,
    runStartOffsetMs: 0,
    label: args.ok ? args.label : `${args.label} (image unavailable)`,
  }
}

/** The plan expects every well to end filled. Unknown stays unknown and does not match. */
export function finalAssessmentFromStates(
  elapsedMs: number,
  mediaId: string | undefined,
  states: Readonly<Record<WellId, WellState>>,
): FinalPlateDraft {
  return {
    elapsedMs,
    ...(mediaId ? { mediaId } : {}),
    wells: WELL_IDS.map((wellId) => {
      const state = states[wellId]
      return {
        wellId,
        state,
        matchesExpectedFilled: state === 'filled',
      }
    }),
  }
}

export function releaseTracks(stream: { getTracks(): Array<{ stop(): void }> } | null): number {
  if (!stream) return 0
  const tracks = stream.getTracks()
  for (const track of tracks) track.stop()
  return tracks.length
}

export function revokeObjectUrl(revoke: (url: string) => void, url: string | null): void {
  if (url) revoke(url)
}

/** Runs each cleanup once. A second release is a no-op. */
export class CleanupBag {
  private fns: Array<() => void> = []

  add(fn: () => void): void {
    this.fns.push(fn)
  }

  release(): void {
    const pending = this.fns.splice(0)
    for (const fn of pending) fn()
  }
}

export function cameraErrorCopy(error: unknown): { phase: 'denied' | 'missing' | 'failed'; message: string } {
  const name = errorName(error)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return {
      phase: 'denied',
      message: 'Camera permission was denied. Allow the camera for live input, or choose a video file or a synthetic sequence.',
    }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return {
      phase: 'missing',
      message: 'No usable camera was found. Choose a prerecorded video or a synthetic sequence.',
    }
  }
  const detail = error instanceof Error && error.message ? error.message : 'The camera failed to start.'
  return { phase: 'failed', message: detail }
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error && 'name' in error && typeof error.name === 'string') {
    return error.name
  }
  return ''
}

/**
 * Read duration from a blob with a temporary video element.
 * The caller stores the integer. A failure omits durationMs; it does not reject the recording.
 */
export function measureVideoDuration(blob: Blob, timeoutMs = 4000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    let settled = false
    const finish = (value: number | undefined) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(undefined), timeoutMs)
    video.preload = 'metadata'
    video.onloadedmetadata = () => finish(durationMsFromSeconds(video.duration))
    video.onerror = () => finish(undefined)
    video.src = url
  })
}
