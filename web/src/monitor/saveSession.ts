import type { PreparedMonitorProtocol } from '../prepare/sixWell.ts'
import type { MediaDraft } from '../shared/types.ts'
import type { LiveMonitorState } from './liveDecisions.ts'
import { eventsFromDecision, evidenceEvent, type StoredObservation } from './persistEvents.ts'

export interface SaveStatus {
  phase: 'idle' | 'saving' | 'saved' | 'failed' | 'finished'
  detail: string
}

interface SessionBody {
  sessionId: string
  sourceKind: 'live' | 'prerecorded' | 'synthetic'
  startedAtIso: string
  preparedProtocol?: PreparedMonitorProtocol | null
  procedureId?: 'six-well-colored-water' | 'three-cup-capture'
  captureProtocolId?: 'red-blue-then-green-red' | 'blue-red-then-green-blue'
}

const MONITOR_INDEX_KEY = 'reprolab-monitor-session-index'
export const BROWSER_MONITOR_SESSION_KEY = 'reprolab-monitor-session-id'
export const RESULTS_SELECTION_KEY = 'reprolab-results-selection'

export interface MonitorSessionRef {
  id: string
  sourceKind: 'live' | 'prerecorded' | 'synthetic'
  startedAtIso: string
}

export function rememberMonitorSession(entry: MonitorSessionRef, storage: Storage): void {
  const next = [entry, ...readMonitorIndex(storage).filter((item) => item.id !== entry.id)].slice(0, 20)
  storage.setItem(MONITOR_INDEX_KEY, JSON.stringify(next))
}

export function readMonitorIndex(storage: Storage): MonitorSessionRef[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(MONITOR_INDEX_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isMonitorRef)
  } catch {
    return []
  }
}

function isMonitorRef(value: unknown): value is MonitorSessionRef {
  if (!value || typeof value !== 'object') return false
  const entry = value as MonitorSessionRef
  return (
    typeof entry.id === 'string' &&
    (entry.sourceKind === 'live' || entry.sourceKind === 'prerecorded' || entry.sourceKind === 'synthetic') &&
    typeof entry.startedAtIso === 'string'
  )
}

type FetchImpl = (path: string, body?: unknown) => Promise<void>

export function createMonitorSaver(notify: (status: SaveStatus) => void, fetchImpl: FetchImpl = postMonitor) {
  let tail = Promise.resolve()
  let pending = 0
  let failed = false
  let closed = false
  let opened: SessionBody | null = null
  const sent = new Set<string>()
  let blockId: string | null = null

  function report() {
    if (pending > 0) notify({ phase: 'saving', detail: 'Saving. Not stored yet.' })
    else if (failed) notify({ phase: 'failed', detail: 'Save failed. Unsent events are not stored.' })
    else if (closed) notify({ phase: 'finished', detail: 'Finished. This does not mean the run succeeded.' })
    else if (opened) notify({ phase: 'saved', detail: 'Saved.' })
    else notify({ phase: 'idle', detail: 'Not saved.' })
  }

  function enqueue(task: () => Promise<void>) {
    pending += 1
    report()
    tail = tail
      .then(task)
      .catch(() => {
        failed = true
      })
      .finally(() => {
        pending -= 1
        report()
      })
  }

  async function send(path: string, body: unknown) {
    try {
      await fetchImpl(path, body)
    } catch {
      await fetchImpl(path, body)
    }
  }

  async function postOnce(path: string, body: { id?: string; [key: string]: unknown }) {
    if (body.id && sent.has(body.id)) return
    await send(path, body)
    if (body.id) sent.add(body.id)
  }

  return {
    open(input: SessionBody) {
      opened = input
      blockId = null
      enqueue(async () => {
        failed = false
        await send('/monitor-sessions', {
          sessionId: input.sessionId,
          sourceKind: input.sourceKind,
          startedAtIso: input.startedAtIso,
          ...(input.preparedProtocol ? { preparedProtocol: input.preparedProtocol } : {}),
          ...(input.procedureId === 'three-cup-capture' ? { procedureId: input.procedureId, captureProtocolId: input.captureProtocolId } : {}),
        })
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(BROWSER_MONITOR_SESSION_KEY, input.sessionId)
          sessionStorage.setItem(RESULTS_SELECTION_KEY, input.sessionId)
        }
        if (typeof localStorage !== 'undefined') {
          rememberMonitorSession(
            { id: input.sessionId, sourceKind: input.sourceKind, startedAtIso: input.startedAtIso },
            localStorage,
          )
        }
      })
    },
    saveStep(args: {
      previous: LiveMonitorState
      next: LiveMonitorState
      observation?: StoredObservation | null
    }) {
      if (!opened || opened.sessionId !== args.next.sessionId) {
        if (args.observation) enqueue(async () => {
          throw new Error('The session is not open. Nothing was saved.')
        })
        return
      }
      if (args.observation === null) {
        enqueue(async () => {
          throw new Error('The observation was not stored.')
        })
        return
      }
      if (!args.previous.blockedReason && args.next.blockedReason && !blockId) {
        blockId = `decision_${crypto.randomUUID()}`
      }
      const path = `/monitor-sessions/${encodeURIComponent(opened.sessionId)}/events`
      const observation = args.observation
      let decisions: ReturnType<typeof eventsFromDecision>
      try {
        decisions = eventsFromDecision(args.previous, args.next, blockId)
      } catch {
        enqueue(async () => {
          throw new Error('The decision was not stored.')
        })
        return
      }
      const bodies = [...(observation ? [observation] : []), ...decisions]
      if (bodies.length === 0) return
      enqueue(async () => {
        for (const body of bodies) await postOnce(path, body as { id: string })
      })
    },
    finish() {
      if (!opened) {
        enqueue(async () => {
          throw new Error('The session is not open. It was not finished.')
        })
        return
      }
      const sessionId = opened.sessionId
      enqueue(async () => {
        await send(`/monitor-sessions/${encodeURIComponent(sessionId)}/finish`, {})
        closed = true
        failed = false
      })
    },
    saveMarker(marker: { id: string; marker: string; observationTimestamp: number }) {
      if (!opened) return
      const path = `/monitor-sessions/${encodeURIComponent(opened.sessionId)}/events`
      enqueue(async () => {
        await postOnce(path, {
          id: marker.id,
          type: 'human_marker',
          marker: marker.marker,
          observationTimestamp: marker.observationTimestamp,
        })
      })
    },
    saveEvidence(draft: MediaDraft, observationTimestamp: number) {
      if (!opened) return
      const body = evidenceEvent(draft, observationTimestamp)
      const path = `/monitor-sessions/${encodeURIComponent(opened.sessionId)}/events`
      enqueue(async () => {
        await postOnce(path, body as { id: string })
      })
    },
  }
}

export function postMonitor(path: string, body?: unknown): Promise<void> {
  return postMonitorWith(fetch, path, body)
}

export async function postMonitorWith(fetchImpl: typeof fetch, path: string, body?: unknown): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(`/library${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    throw new Error('The monitor store is not reachable. Nothing was saved.')
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const error = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : ''
    if (error === 'database_unavailable') throw new Error('The database was not reached. Nothing was saved.')
    if (error === 'duplicate_event') throw new Error('That event was already saved with different details. Nothing new was saved.')
    if (error === 'invalid_state') throw new Error('The session is blocked. This event was not saved.')
    throw new Error('The monitor store did not save this event.')
  }
}

export async function readMonitorSession(id: string): Promise<RetrievedMonitor | null> {
  const loaded = await loadMonitorSession(id)
  return loaded.kind === 'ok' ? loaded.session : null
}

export interface MonitorSessionSummary {
  id: string
  sourceKind: string
  startedAtIso: string | null
  recordedAt: string
  blockedReason: string | null
  preparedProtocol: { id: string; version: number; title: string } | null
}

export type MonitorListResult =
  | { kind: 'ok'; sessions: MonitorSessionSummary[] }
  | { kind: 'unavailable' }
  | { kind: 'unreachable' }

export type MonitorSessionResult =
  | { kind: 'ok'; session: RetrievedMonitor }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }
  | { kind: 'unreachable' }

export async function listMonitorSessions(): Promise<MonitorListResult> {
  let response: Response
  try {
    response = await fetch('/library/monitor-sessions?limit=20')
  } catch {
    return { kind: 'unreachable' }
  }
  if (response.status === 503) return { kind: 'unavailable' }
  if (!response.ok) return { kind: 'unreachable' }
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || !('sessions' in body) || !Array.isArray(body.sessions)) {
    return { kind: 'unreachable' }
  }
  return { kind: 'ok', sessions: body.sessions.filter(isMonitorSummary) }
}

export async function loadMonitorSession(id: string): Promise<MonitorSessionResult> {
  let response: Response
  try {
    response = await fetch(`/library/monitor-sessions/${encodeURIComponent(id)}`)
  } catch {
    return { kind: 'unreachable' }
  }
  if (response.status === 404) return { kind: 'missing' }
  if (response.status === 400) return { kind: 'invalid' }
  if (response.status === 503) return { kind: 'unavailable' }
  if (!response.ok) return { kind: 'unreachable' }
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') return { kind: 'unreachable' }
  return { kind: 'ok', session: body as RetrievedMonitor }
}

function isMonitorSummary(value: unknown): value is MonitorSessionSummary {
  if (!value || typeof value !== 'object') return false
  const record = value as MonitorSessionSummary
  return typeof record.id === 'string'
    && typeof record.sourceKind === 'string'
    && (record.recordedAt == null || typeof record.recordedAt === 'string')
}

export interface RetrievedMonitor {
  id: string
  sourceKind: string
  startedAtIso?: string | null
  blockedReason?: string | null
  finishedAt?: string | null
  procedureId?: string
  protocol?: { captureProtocolId?: string; approvedSteps?: string[] }
  humanMarkers?: Array<{ id?: string; marker?: string; label?: string; cups?: string[]; observationTimestamp?: number; provenance?: string }>
  preparedProtocol?: {
    id: string
    version: number
    title: string
    steps: string[]
  } | null
  alerts?: Array<{
    id: string
    wellId: string
    observedState: string
    observationTimestamp: number
    updates?: unknown[]
    evidence?: { label?: string; frameIndex?: number | null; observationTimestamp?: number }
  }>
  humanReports?: unknown[]
  evidence?: unknown[]
  observations?: unknown[]
}

export function describeRetrieved(session: RetrievedMonitor): string {
  const alerts = session.alerts ?? []
  const first = alerts[0]
  const updateCount = alerts.reduce((count, alert) => count + (alert.updates?.length ?? 0), 0)
  const alertEvidence = first?.evidence
  const evidence = (session.evidence ?? []).map((item) => {
    const record = item as { label?: string; observationTimestamp?: number; frameIndex?: number | null }
    const frame = record.frameIndex == null ? '' : `, frame ${record.frameIndex}`
    return `${record.label ?? 'evidence'} at ${record.observationTimestamp ?? '?'} ms${frame}`
  })
  return [
    `${session.id} · ${session.sourceKind}`,
    first
      ? `Original alert ${first.wellId} at ${first.observationTimestamp} ms: ${first.observedState}. Later updates: ${updateCount}. Supporting frame: ${alertEvidence?.label ?? 'none'} at ${alertEvidence?.observationTimestamp ?? '?'} ms, frame ${alertEvidence?.frameIndex ?? 'none'}.`
      : 'No alert was retrieved.',
    `Human reports: ${session.humanReports?.length ?? 0}.`,
    evidence.length > 0
      ? `Recordings: ${evidence.join('; ')}.`
      : 'No separate recording was stored. The supporting frame stays on the alert.',
  ].join(' ')
}
