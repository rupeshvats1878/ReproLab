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
  linked?: boolean
  linkStatus?: string | null
  association?: ClipAssociation | null
  clipStartMs?: number
  clipEndMs?: number
  events?: ClipEvent[]
  appearances?: ClipAppearance[]
  raw?: unknown
}

export interface ClipAssociation {
  kind: 'hash-verified' | 'user-confirmed'
  monitorSessionId: string
  monitorVideoId: string
  recordingDurationMs: number
  sessionId: string
  videoId: string
  sourceOffsetMs: number
  clipStartMs: number
  clipEndMs: number
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

export interface ClipLinkRequest extends ClipImportRequest {
  recordingDurationMs: number
  recordingSha256: string | null
  manifestSha256: string | null
  confirm: boolean
}

const SHA256 = /^[0-9a-f]{64}$/i

export function sourceHashFromManifest(value: unknown): { ok: true; sha256: string | null } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'The manifest was not a JSON object. No video was sent.' }
  }
  const record = value as Record<string, unknown>
  const fields = ['sourceSha256', 'sourceSha256AfterEncoding', 'originalRecordingSha256']
  for (const field of fields) {
    if (field in record && (typeof record[field] !== 'string' || !SHA256.test(record[field]))) {
      return { ok: false, error: 'The manifest source hash is not a SHA-256 hex string. No video was sent.' }
    }
  }
  const hashes = fields.flatMap((field) => typeof record[field] === 'string' ? [record[field].toLowerCase()] : [])
  if (new Set(hashes).size > 1) {
    return { ok: false, error: 'The manifest lists two different source hashes. No video was sent.' }
  }
  const chosen = hashes[0] ?? null
  if (chosen == null) return { ok: true, sha256: null }
  if (!SHA256.test(chosen)) return { ok: false, error: 'The manifest source hash is not a SHA-256 hex string. No video was sent.' }
  return { ok: true, sha256: chosen.toLowerCase() }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Build a link request. The document is sent unchanged, beside the selected recording. */
export function buildRecordingLink(args: {
  requestId: string
  document: unknown
  monitorSessionId: string
  monitorVideoId: string
  recordingDurationMs: number
  recordingSha256: string | null
  manifestSha256: string | null
  confirm: boolean
}): { ok: true; body: ClipLinkRequest } | { ok: false; error: string } {
  const built = buildAdapterImport({
    monitorSessionId: args.monitorSessionId,
    monitorVideoId: args.monitorVideoId,
    requestId: args.requestId,
    document: args.document,
  })
  if (!built.ok) return built
  if (!Number.isInteger(args.recordingDurationMs) || args.recordingDurationMs <= 0) {
    return { ok: false, error: 'The recording duration is not loaded yet. No video was sent.' }
  }
  if (args.recordingSha256 != null && !SHA256.test(args.recordingSha256)) {
    return { ok: false, error: 'The recording hash is not a SHA-256 hex string. No video was sent.' }
  }
  if (args.manifestSha256 != null && !SHA256.test(args.manifestSha256)) {
    return { ok: false, error: 'The manifest source hash is not a SHA-256 hex string. No video was sent.' }
  }
  return {
    ok: true,
    body: {
      ...built.body,
      recordingDurationMs: args.recordingDurationMs,
      recordingSha256: args.recordingSha256,
      manifestSha256: args.manifestSha256,
      confirm: args.confirm,
    },
  }
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
  const ids = result.sessionId && result.videoId ? `${result.sessionId} / ${result.videoId}` : 'the saved result'
  if (result.linkStatus === 'recording-mismatch') {
    return `Saved result for ${ids}. This recording does not match the supplied hash, so its events are not shown.`
  }
  if (result.linkStatus === 'recording-bounds' || result.linkStatus === 'evidence-out-of-range') {
    return `Saved result for ${ids}. Its clip is outside this recording, so its events are not shown.`
  }
  if (result.linked && result.association) {
    const how = result.association.kind === 'hash-verified' ? 'recording hash' : 'user confirmation'
    if (result.provenance === 'synthetic') {
      return `Synthetic fixture linked by ${how}. Adapter session ${result.sessionId}, video ${result.videoId}. It is not an observation.`
    }
    return `Linked by ${how}. Adapter session ${result.sessionId}, video ${result.videoId}. It does not complete a step.`
  }
  if (result.provenance === 'synthetic') {
    return `Synthetic fixture for ${ids}. It is not linked to this recording, so its events are not shown. It is not an observation.`
  }
  return `Saved result for ${ids}. It is not linked to this recording, so its events are not shown.`
}

export function clipAssociationCopy(result: ClipCheckResponse): string {
  if (result.association?.kind === 'hash-verified') return 'Association: hash-verified.'
  if (result.association?.kind === 'user-confirmed') return 'Association: user-confirmed.'
  return 'Association: not linked.'
}

/** Rail rows for a linked result. Times are already original-media milliseconds. */
export function clipRailItems(result: ClipCheckResponse | null, activeVideoId?: string): ClipRailItem[] {
  if (!result?.linked || !result.association) return []
  if (activeVideoId && result.association.monitorVideoId !== activeVideoId) return []
  if (result.status !== 'hypothesis' && result.status !== 'uncertain') return []
  const duration = result.association.recordingDurationMs
  const source = result.provenance === 'synthetic' ? 'Synthetic fixture' : 'Unverified'
  const items: ClipRailItem[] = []
  for (const event of result.events ?? []) {
    if (event.needsHumanVerification !== true) continue
    if (event.eventStartMs > duration) continue
    const evidence = (event.evidenceTimestampsMs ?? []).filter((timestamp) => timestamp >= 0 && timestamp <= duration)
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
    const evidence = (appearance.evidenceTimestampsMs ?? []).filter((timestamp) => timestamp >= 0 && timestamp <= duration)
    if ((appearance.evidenceTimestampsMs ?? []).length > 0 && evidence.length === 0) continue
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
