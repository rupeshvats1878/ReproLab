import { LibraryError } from './errors.mjs'

export const SIX_WELL_ORDER = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']
export const MONITOR_PROTOCOL_ID = 'six-well-colored-water'

const CAMERA_TYPES = new Set(['observation', 'alert', 'alert_update', 'evidence'])

export function monitorSession(input, recordedAt) {
  return {
    id: input.sessionId,
    sourceKind: input.sourceKind,
    protocolId: MONITOR_PROTOCOL_ID,
    protocolOrder: [...SIX_WELL_ORDER],
    startedAtIso: input.startedAtIso,
    preparedProtocol: input.preparedProtocol ?? null,
    recordedAt,
    blockedReason: null,
    events: [],
  }
}

export function appendMonitorEvent(session, input, recordedAt) {
  const events = Array.isArray(session.events) ? session.events : []
  const existing = events.find((event) => event.id === input.id)
  if (existing) {
    const rebuilt = buildEvent(session, events, input, existing.recordedAt)
    if (canonical(existing) !== canonical(rebuilt)) throw new LibraryError('duplicate', 'id')
    return { session, created: false }
  }
  if (session.blockedReason && (CAMERA_TYPES.has(input.type) || input.type === 'block')) {
    throw new LibraryError('invalid_state')
  }
  const event = buildEvent(session, events, input, recordedAt)
  const next = { ...session, events: [...events, event] }
  if (event.type === 'block') next.blockedReason = event.reason
  return { session: next, created: true }
}

export function sameMonitorIdentity(existing, input) {
  return existing.sourceKind === input.sourceKind
    && (existing.startedAtIso ?? null) === (input.startedAtIso ?? null)
    && JSON.stringify(existing.preparedProtocol ?? null) === JSON.stringify(input.preparedProtocol ?? null)
}

export function presentMonitorSession(session) {
  const events = Array.isArray(session.events) ? session.events.map((event) => structuredClone(event)) : []
  const alerts = events.filter((event) => event.type === 'alert').map((alert) => ({
    ...structuredClone(alert),
    updates: events.filter((event) => event.type === 'alert_update' && event.alertId === alert.id).map((event) => structuredClone(event)),
  }))
  return {
    id: session.id,
    sourceKind: session.sourceKind,
    protocol: {
      id: MONITOR_PROTOCOL_ID,
      order: [...SIX_WELL_ORDER],
      note: 'Only the fixed six-well order A1, A2, A3, B1, B2, B3 is stored. A published Prepare protocol is not a monitor protocol.',
    },
    startedAtIso: session.startedAtIso ?? null,
    preparedProtocol: session.preparedProtocol ?? null,
    recordedAt: session.recordedAt,
    blockedReason: session.blockedReason ?? null,
    events,
    observations: events.filter((event) => event.type === 'observation'),
    alerts,
    evidence: events.filter((event) => event.type === 'evidence'),
    humanReports: events.filter((event) => event.type === 'human_report'),
  }
}

function buildEvent(session, events, input, recordedAt) {
  const provenance = input.type === 'human_report' ? 'human' : session.sourceKind
  if (input.type === 'alert_update' || input.type === 'human_report') {
    const alert = events.find((event) => event.type === 'alert' && event.id === input.alertId)
    if (!alert) throw new LibraryError('invalid', 'alertId')
    if (input.type === 'human_report' && input.wellId !== alert.wellId) throw new LibraryError('invalid', 'wellId')
  }
  return {
    ...structuredClone(input),
    protocolIndex: input.wellId ? SIX_WELL_ORDER.indexOf(input.wellId) : null,
    provenance,
    recordedAt,
  }
}

function canonical(event) {
  const { recordedAt, ...client } = event
  void recordedAt
  return stable(client)
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
