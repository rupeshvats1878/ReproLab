export const CLIP_LIMIT_MS = 60_000

export interface ClipCheckRequest {
  sessionId: string
  videoId: string
  requestId: string
  sourceOffsetMs: number
  clipStartMs: number
  clipEndMs: number
}

export interface ClipCheckResponse {
  requestId?: string
  status?: string
  message?: string | null
  reason?: string
  needsHumanVerification?: boolean
  remoteCallMade?: boolean
  events?: Array<{
    eventId: string
    eventStartMs: number
    eventEndMs?: number
    seekable?: boolean
    needsHumanVerification: boolean
    sourceCupId?: string | null
    destinationCupId?: string | null
  }>
}

export function localVideoId(file: { name: string; bytes: number }): string {
  const name = file.name.replace(/[^\w. -]+/g, '').slice(0, 80) || 'recording'
  return `local-${file.bytes}-${name}`
}

/** The source offset is the clip start. Callers must not add it to adapter timestamps. */
export function buildClipCheckRequest(args: {
  sessionId: string
  videoId: string
  requestId: string
  startSeconds: number
  endSeconds: number
}): ClipCheckRequest | null {
  if (!Number.isFinite(args.startSeconds) || !Number.isFinite(args.endSeconds)) return null
  const clipStartMs = Math.round(args.startSeconds * 1000)
  const clipEndMs = Math.round(args.endSeconds * 1000)
  const duration = clipEndMs - clipStartMs
  if (clipStartMs < 0 || duration <= 0 || duration > CLIP_LIMIT_MS) return null
  return {
    sessionId: args.sessionId,
    videoId: args.videoId,
    requestId: args.requestId,
    sourceOffsetMs: clipStartMs,
    clipStartMs,
    clipEndMs,
  }
}

export function shouldApplyClipResponse(
  active: { generation: number; requestId: string },
  incoming: { generation: number; requestId?: string },
): boolean {
  return active.generation === incoming.generation && incoming.requestId === active.requestId
}

export function clipStatusCopy(status: string | undefined, message?: string | null): string {
  if (status === 'processing') return 'Checking this clip. No result yet.'
  if (status === 'awaiting-authorization') return 'Awaiting authorization. No video was sent.'
  if (status === 'rejected') return message || 'This response was rejected. No video was sent.'
  if (status === 'unavailable') return message || 'The clip check is unavailable. No video was sent.'
  if (status === 'no-transfer') return 'The model reported no visible transfer. A person still has to review it.'
  if (status === 'uncertain') return 'The result is uncertain. A person still has to review it.'
  if (status === 'hypothesis') return 'Unverified model hypothesis. A person still has to review it.'
  if (message) return message
  return 'The clip check did not return a usable result. No video was sent.'
}

export function clipHeadline(status: string | undefined): string {
  if (status === 'processing') return 'Checking this clip.'
  if (status === 'awaiting-authorization') return 'Awaiting authorization.'
  if (status === 'unavailable') return 'Clip check unavailable.'
  if (status === 'rejected') return 'Clip response rejected.'
  if (status === 'no-transfer') return 'No transfer reported.'
  if (status === 'uncertain') return 'Uncertain result.'
  if (status === 'hypothesis') return 'Unverified hypothesis.'
  return 'No observation yet.'
}
