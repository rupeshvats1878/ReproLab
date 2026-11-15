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
  sessionId?: string
  videoId?: string
  sourceOffsetMs?: number
  status?: string
  message?: string | null
  reason?: string
  needsHumanVerification?: boolean
  remoteCallMade?: boolean
  provenance?: 'synthetic' | 'adapter' | string
  matchesOpenReview?: boolean
  events?: ClipEvent[]
  appearances?: ClipAppearance[]
}

export interface ClipEvent {
  eventId: string
  eventStartMs: number
  eventEndMs?: number
  evidenceTimestampsMs?: number[]
  seekable?: boolean
  needsHumanVerification: boolean
  sourceCupId?: string | null
  destinationCupId?: string | null
}

export interface ClipAppearance {
  cupId?: string | null
  label?: string
  evidenceTimestampsMs?: number[]
  seekable?: boolean
  needsHumanVerification?: boolean
}

export interface ClipRailItem {
  id: string
  time: string
  mediaMs: number
  source: string
  title: string
  detail: string
  seekable: boolean
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

export function buildAdapterImport(args: {
  monitorSessionId: string
  monitorVideoId: string
  requestId: string
  document: unknown
}): { ok: true; body: ClipImportRequest } | { ok: false; error: string } {
  if (!args.document || typeof args.document !== 'object' || Array.isArray(args.document)) {
    return { ok: false, error: 'The adapter result was not a JSON object. No video was sent.' }
  }
  const document = args.document as Record<string, unknown>
  if (typeof document.sessionId !== 'string' || typeof document.videoId !== 'string') {
    return { ok: false, error: 'The adapter result has no session or video id. No video was sent.' }
  }
  if (!Number.isInteger(document.sourceOffsetMs) || !Number.isInteger(document.videoDurationMs)) {
    return { ok: false, error: 'The adapter result has no clip offset or duration. No video was sent.' }
  }
  const sourceOffsetMs = document.sourceOffsetMs as number
  const duration = document.videoDurationMs as number
  if (sourceOffsetMs < 0 || duration <= 0 || duration > CLIP_LIMIT_MS) {
    return { ok: false, error: 'The adapter result is outside the 60 second clip limit. No video was sent.' }
  }
  return {
    ok: true,
    body: {
      sessionId: document.sessionId,
      videoId: document.videoId,
      requestId: args.requestId,
      sourceOffsetMs,
      clipStartMs: sourceOffsetMs,
      clipEndMs: sourceOffsetMs + duration,
      monitorSessionId: args.monitorSessionId,
      monitorVideoId: args.monitorVideoId,
      document: args.document,
    },
  }
}

export interface ClipImportRequest extends ClipCheckRequest {
  monitorSessionId: string
  monitorVideoId: string
  document: unknown
}

export function clipStatusCopy(status: string | undefined, message?: string | null, reason?: string, remoteCallMade?: boolean): string {
  const transport = remoteCallMade === true ? 'A clip was submitted.' : 'No video was sent.'
  if (status === 'processing') return 'Checking this clip. No result yet.'
  if (status === 'awaiting-authorization') return `Awaiting authorization. ${transport}`
  if (status === 'rejected') return message || `This response was rejected. ${transport}`
  if (status === 'unavailable') {
    if (message) return message
    if (reason) return `The clip check is unavailable (${reason}). ${transport}`
    return `The clip check is unavailable. ${transport}`
  }
  if (status === 'no-transfer') return 'The model reported no visible transfer. A person still has to review it.'
  if (status === 'uncertain') return 'The result is uncertain. A person still has to review it.'
  if (status === 'hypothesis') return 'Unverified model hypothesis. A person still has to review it. It does not complete a step.'
  if (message) return message
  return 'The clip check did not return a usable result. No video was sent.'
}

export function clipIdentityCopy(result: ClipCheckResponse): string {
  if (result.provenance === 'synthetic') {
    return result.matchesOpenReview
      ? 'Synthetic fixture for this session. It is not an observation.'
      : 'Synthetic fixture for a different session. Its events are not shown.'
  }
  if (result.matchesOpenReview) return 'Saved adapter result for this session. It does not complete a step.'
  if (result.sessionId && result.videoId) {
    return `Saved result for ${result.sessionId} / ${result.videoId}. It does not match this session, so its events are not shown.`
  }
  return 'Saved adapter result. It does not complete a step.'
}

/** Rail rows for a reviewed result. Times are already original-media milliseconds. */
export function clipRailItems(result: ClipCheckResponse | null): ClipRailItem[] {
  if (!result?.matchesOpenReview) return []
  if (result.status !== 'hypothesis' && result.status !== 'uncertain') return []
  const source = result.provenance === 'synthetic' ? 'Synthetic fixture' : 'Unverified'
  const items: ClipRailItem[] = []
  for (const event of result.events ?? []) {
    if (event.needsHumanVerification !== true) continue
    const evidence = event.evidenceTimestampsMs ?? []
    const title = event.sourceCupId && event.destinationCupId ? `${event.sourceCupId} → ${event.destinationCupId}` : 'Unclear transfer'
    if (event.seekable === false) {
      items.push({
        id: event.eventId,
        time: formatClipMs(event.eventStartMs),
        mediaMs: event.eventStartMs,
        source,
        title,
        detail: 'Seeking is disabled. This time is not a valid event interval. It does not complete a step.',
        seekable: false,
      })
      continue
    }
    items.push({
      id: event.eventId,
      time: formatClipMs(event.eventStartMs),
      mediaMs: event.eventStartMs,
      source,
      title,
      detail: `${evidence.length > 0 ? `Evidence at ${evidence.map(formatClipMs).join(', ')}. ` : ''}Unverified hypothesis on the original recording. It does not complete a step.`,
      seekable: true,
    })
    evidence.forEach((timestamp, index) => {
      items.push({
        id: `${event.eventId}:evidence:${index}`,
        time: formatClipMs(timestamp),
        mediaMs: timestamp,
        source,
        title: 'Evidence',
        detail: 'Evidence timestamp on the original recording. It does not complete a step.',
        seekable: true,
      })
    })
  }
  for (const [index, appearance] of (result.appearances ?? []).entries()) {
    const evidence = appearance.evidenceTimestampsMs ?? []
    items.push({
      id: `appearance:${index}`,
      time: formatClipMs(evidence[0] ?? result.sourceOffsetMs ?? 0),
      mediaMs: evidence[0] ?? result.sourceOffsetMs ?? 0,
      source,
      title: appearance.cupId ? `${appearance.cupId} appearance` : 'Appearance',
      detail: `${appearance.label ?? 'unclear'}. ${evidence.length > 0 ? `Evidence at ${evidence.map(formatClipMs).join(', ')}. ` : ''}It does not complete a step.`,
      seekable: appearance.seekable === true,
    })
  }
  return items
}

function formatClipMs(value: number): string {
  const seconds = value / 1000
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
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
