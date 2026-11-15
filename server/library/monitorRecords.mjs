import { LibraryError } from './errors.mjs'

export const SIX_WELL_ORDER = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']
export const MONITOR_PROTOCOL_ID = 'six-well-colored-water'
export const THREE_CUP_PROCEDURE_ID = 'three-cup-capture'

const CAPTURE_PROTOCOL_LINES = {
  'red-blue-then-green-red': [
    'RED and BLUE should look uniformly mixed. GREEN will have visible streaks.',
    'Expected transfers: RED → BLUE, then GREEN → RED.',
  ],
  'blue-red-then-green-blue': [
    'First transfer: BLUE → RED.',
    'Second transfer: GREEN → BLUE.',
  ],
}

export function captureProtocolIdOf(value) {
  return value === 'blue-red-then-green-blue' ? 'blue-red-then-green-blue' : 'red-blue-then-green-red'
}

export function captureProtocolLines(id) {
  return [...CAPTURE_PROTOCOL_LINES[captureProtocolIdOf(id)]]
}

const CAMERA_TYPES = new Set(['observation', 'alert', 'alert_update', 'evidence'])
const SIX_WELL_EVENT_TYPES = new Set(['observation', 'alert', 'alert_update', 'human_report'])

export function procedureIdOf(session) {
  return session?.procedureId === THREE_CUP_PROCEDURE_ID ? THREE_CUP_PROCEDURE_ID : MONITOR_PROTOCOL_ID
}

export function monitorSession(input, recordedAt) {
  const procedureId = input.procedureId === THREE_CUP_PROCEDURE_ID ? THREE_CUP_PROCEDURE_ID : MONITOR_PROTOCOL_ID
  return {
    id: input.sessionId,
    sourceKind: input.sourceKind,
    procedureId,
    protocolId: procedureId,
    captureProtocolId: procedureId === THREE_CUP_PROCEDURE_ID ? captureProtocolIdOf(input.captureProtocolId) : null,
    protocolOrder: procedureId === THREE_CUP_PROCEDURE_ID ? ['RED', 'GREEN', 'BLUE'] : [...SIX_WELL_ORDER],
    startedAtIso: input.startedAtIso,
    preparedProtocol: input.preparedProtocol ?? null,
    recordedAt,
    blockedReason: null,
    finishedAt: null,
    events: [],
  }
}

export function finishMonitorSession(session, finishedAt) {
  if (session.finishedAt) return session
  return { ...session, finishedAt }
}

export function appendMonitorEvent(session, input, recordedAt) {
  const events = Array.isArray(session.events) ? session.events : []
  const existing = events.find((event) => event.id === input.id)
  if (session.finishedAt && !existing) throw new LibraryError('invalid_state')
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
  const incomingProcedure = input.procedureId === THREE_CUP_PROCEDURE_ID ? THREE_CUP_PROCEDURE_ID : MONITOR_PROTOCOL_ID
  const existingProtocol = procedureIdOf(existing) === THREE_CUP_PROCEDURE_ID ? captureProtocolIdOf(existing.captureProtocolId) : null
  const incomingProtocol = incomingProcedure === THREE_CUP_PROCEDURE_ID ? captureProtocolIdOf(input.captureProtocolId) : null
  return existing.sourceKind === input.sourceKind
    && procedureIdOf(existing) === incomingProcedure
    && existingProtocol === incomingProtocol
    && (existing.startedAtIso ?? null) === (input.startedAtIso ?? null)
    && JSON.stringify(existing.preparedProtocol ?? null) === JSON.stringify(input.preparedProtocol ?? null)
}

export function presentMonitorSummary(session) {
  const protocol = session.preparedProtocol ?? null
  return {
    id: session.id,
    sourceKind: session.sourceKind,
    startedAtIso: session.startedAtIso ?? null,
    recordedAt: session.recordedAt ?? null,
    blockedReason: session.blockedReason ?? null,
    finishedAt: session.finishedAt ?? null,
    procedureId: procedureIdOf(session),
    preparedProtocol: protocol
      ? { id: protocol.id, version: protocol.version, title: protocol.title }
      : null,
  }
}

export function presentMonitorSession(session) {
  const events = Array.isArray(session.events) ? session.events.map((event) => structuredClone(event)) : []
  const alerts = events.filter((event) => event.type === 'alert').map((alert) => ({
    ...structuredClone(alert),
    updates: events.filter((event) => event.type === 'alert_update' && event.alertId === alert.id).map((event) => structuredClone(event)),
  }))
  const procedureId = procedureIdOf(session)
  return {
    id: session.id,
    sourceKind: session.sourceKind,
    procedureId,
    protocol: procedureId === THREE_CUP_PROCEDURE_ID
      ? {
          id: THREE_CUP_PROCEDURE_ID,
          order: ['RED', 'GREEN', 'BLUE'],
          captureProtocolId: captureProtocolIdOf(session.captureProtocolId),
          approvedSteps: captureProtocolLines(session.captureProtocolId),
          note: 'Capture only. Automatic checks are not connected. RED, GREEN, and BLUE are physical cup labels.',
        }
      : {
          id: MONITOR_PROTOCOL_ID,
          order: [...SIX_WELL_ORDER],
          note: 'Only the fixed six-well order A1, A2, A3, B1, B2, B3 is stored. A published Prepare protocol is not a monitor protocol.',
        },
    startedAtIso: session.startedAtIso ?? null,
    preparedProtocol: session.preparedProtocol ?? null,
    recordedAt: session.recordedAt,
    blockedReason: session.blockedReason ?? null,
    finishedAt: session.finishedAt ?? null,
    events,
    observations: events.filter((event) => event.type === 'observation'),
    alerts,
    evidence: events.filter((event) => event.type === 'evidence'),
    humanReports: events.filter((event) => event.type === 'human_report'),
    humanMarkers: events.filter((event) => event.type === 'human_marker'),
  }
}

function buildEvent(session, events, input, recordedAt) {
  const capture = procedureIdOf(session) === THREE_CUP_PROCEDURE_ID
  if (capture && SIX_WELL_EVENT_TYPES.has(input.type)) throw new LibraryError('invalid_state')
  if (!capture && input.type === 'human_marker') throw new LibraryError('invalid_state')
  const provenance = input.type === 'human_report' || input.type === 'human_marker' ? 'human' : session.sourceKind
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
