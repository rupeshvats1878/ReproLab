import type { MediaDraft } from '../shared/types.ts'
import type { LiveMonitorState } from './liveDecisions.ts'
import { eventsFromDecision, evidenceEvent, type StoredObservation } from './persistEvents.ts'

export interface SaveStatus {
  phase: 'idle' | 'saving' | 'saved' | 'failed'
  detail: string
}

interface SessionBody {
  sessionId: string
  sourceKind: 'live' | 'prerecorded' | 'synthetic'
  startedAtIso: string
}

type FetchImpl = (path: string, body?: unknown) => Promise<void>

export function createMonitorSaver(notify: (status: SaveStatus) => void, fetchImpl: FetchImpl = postMonitor) {
  let tail = Promise.resolve()
  let pending = 0
  let failed = false
  let opened: SessionBody | null = null
  const sent = new Set<string>()
  let blockId: string | null = null

  function report() {
    if (pending > 0) notify({ phase: 'saving', detail: 'Saving. Not stored yet.' })
    else if (failed) notify({ phase: 'failed', detail: 'Save failed. Unsent events are not stored.' })
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

  async function postOnce(path: string, body: { id?: string }) {
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
        await send('/monitor-sessions', input)
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('reprolab-monitor-session-id', input.sessionId)
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
  let response: Response
  try {
    response = await fetch(`/library/monitor-sessions/${encodeURIComponent(id)}`)
  } catch {
    return null
  }
  if (!response.ok) return null
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') return null
  return body as RetrievedMonitor
}

export interface RetrievedMonitor {
  id: string
  sourceKind: string
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
