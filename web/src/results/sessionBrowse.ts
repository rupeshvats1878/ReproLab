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

export function sessionChoiceLabel(session: {
  sourceKind: string
  startedAtIso?: string | null
  recordedAt?: string | null
  blockedReason?: string | null
  preparedProtocol?: { title?: string } | null
}): string {
  const title = session.preparedProtocol?.title || 'Protocol association not recorded'
  const when = formatRecordedTime(session.startedAtIso || session.recordedAt)
  const status = session.blockedReason ? 'Blocked' : 'Status not recorded'
  return `${title} · ${when} · ${sourceLabel(session.sourceKind)} · ${status}`
}
