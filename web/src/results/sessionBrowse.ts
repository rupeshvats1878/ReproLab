export const MONITOR_SESSION_ID = /^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function sourceLabel(kind: string): string {
  if (kind === 'live') return 'Camera'
  if (kind === 'prerecorded') return 'Imported video'
  if (kind === 'synthetic') return 'Synthetic'
  return 'Unrecognized source'
}

export function statusLabel(blockedReason: string | null | undefined): string {
  if (blockedReason) return `Blocked: ${blockedReason}`
  return 'Status not recorded'
}

export function formatRecordedTime(iso: string | null | undefined): string {
  if (!iso) return 'Time not recorded'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function chooseSavedSession(input: {
  currentId: string
  explicitId: string | null
  browserSessionId: string | null
  newestId: string | null
}): string {
  if (input.currentId) return input.currentId
  if (input.explicitId) return input.explicitId
  if (input.browserSessionId) return input.browserSessionId
  return input.newestId ?? ''
}

export function sessionChoiceLabel(session: {
  sourceKind: string
  startedAtIso?: string | null
  recordedAt?: string | null
  blockedReason?: string | null
  captureProtocolId?: string
  preparedProtocol?: { title?: string } | null
}): string {
  const captureTitle = session.captureProtocolId === 'blue-red-then-green-blue' ? 'Recording 2 · BLUE → RED, then GREEN → BLUE' : session.captureProtocolId === 'red-blue-then-green-red' ? 'Recording 1 · RED → BLUE, then GREEN → RED' : null
  const title = session.preparedProtocol?.title || captureTitle || 'Protocol association not recorded'
  const when = formatRecordedTime(session.startedAtIso || session.recordedAt)
  const status = session.blockedReason ? 'Blocked' : 'Status not recorded'
  return `${title} · ${when} · ${sourceLabel(session.sourceKind)} · ${status}`
}
