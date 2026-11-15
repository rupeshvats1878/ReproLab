import { useEffect, useState, type FormEvent } from 'react'
import { Review } from '../components/Review.tsx'
import {
  BROWSER_MONITOR_SESSION_KEY,
  RESULTS_SELECTION_KEY,
  listMonitorSessions,
  loadMonitorSession,
  type MonitorSessionSummary,
  type RetrievedMonitor,
} from '../monitor/saveSession.ts'
import { ReferenceLab } from '../reference/ReferenceLab.tsx'
import type { ReviewController } from '../shared/types.ts'
import { MONITOR_SESSION_ID, chooseSavedSession, sessionChoiceLabel, sourceLabel, statusLabel } from './sessionBrowse.ts'
import './results.css'

type ListKind = 'loading' | 'ready' | 'empty' | 'unavailable' | 'unreachable'
type SessionKind = 'idle' | 'loading' | 'ready' | 'missing' | 'invalid' | 'unavailable' | 'unreachable'

export function Results(props: { review: ReviewController; active: boolean }) {
  const [trackedActive, setTrackedActive] = useState(props.active)
  const [refresh, setRefresh] = useState(0)
  const [summaries, setSummaries] = useState<MonitorSessionSummary[]>([])
  const [listKind, setListKind] = useState<ListKind>('loading')
  const [selectedId, setSelectedId] = useState('')
  const [loadToken, setLoadToken] = useState(0)
  const [lookup, setLookup] = useState('')
  const [session, setSession] = useState<RetrievedMonitor | null>(null)
  const [sessionKind, setSessionKind] = useState<SessionKind>('idle')

  if (props.active !== trackedActive) {
    setTrackedActive(props.active)
    if (props.active) {
      setListKind('loading')
      setRefresh((value) => value + 1)
    }
  }

  useEffect(() => {
    if (!props.active || refresh === 0) return
    let cancel = false
    void listMonitorSessions().then((result) => {
      if (cancel) return
      if (result.kind !== 'ok') {
        setSummaries([])
        setListKind(result.kind)
        return
      }
      setSummaries(result.sessions)
      setListKind(result.sessions.length === 0 ? 'empty' : 'ready')
      const explicitId = sessionStorage.getItem(RESULTS_SELECTION_KEY)
      const browserSessionId = sessionStorage.getItem(BROWSER_MONITOR_SESSION_KEY)
      setSelectedId((current) => chooseSavedSession({
        currentId: current,
        explicitId,
        browserSessionId,
        newestId: result.sessions[0]?.id ?? null,
      }))
      setSessionKind((current) => (current === 'idle' && (explicitId || browserSessionId || result.sessions[0]) ? 'loading' : current))
    })
    return () => {
      cancel = true
    }
  }, [props.active, refresh])

  useEffect(() => {
    if (!selectedId) return
    let cancel = false
    void loadMonitorSession(selectedId).then((result) => {
      if (cancel) return
      if (result.kind === 'ok') {
        setSession(result.session)
        setSessionKind('ready')
        return
      }
      setSession(null)
      setSessionKind(result.kind)
    })
    return () => {
      cancel = true
    }
  }, [selectedId, loadToken])

  function chooseSession(id: string) {
    sessionStorage.setItem(RESULTS_SELECTION_KEY, id)
    setSession(null)
    setSessionKind('loading')
    setSelectedId(id)
    setLoadToken((value) => value + 1)
  }

  function openById(event: FormEvent) {
    event.preventDefault()
    const id = lookup.trim()
    if (!MONITOR_SESSION_ID.test(id)) {
      setSession(null)
      setSessionKind('invalid')
      return
    }
    chooseSession(id)
  }

  return (
    <section className="results">
      <h2>Results</h2>
      <p>Saved monitor sessions and review records stay separate.</p>

      <section className="results-block" aria-labelledby="monitor-results">
        <h3 id="monitor-results">Monitor sessions</h3>
        {summaries.length > 0 ? (
          <label>
            Previous sessions
            <select value={summaries.some((item) => item.id === selectedId) ? selectedId : ''} onChange={(event) => chooseSession(event.target.value)}>
              {summaries.some((item) => item.id === selectedId) ? null : <option value="">Opened by ID</option>}
              {summaries.map((item) => (
                <option key={item.id} value={item.id}>{sessionChoiceLabel(item)}</option>
              ))}
            </select>
          </label>
        ) : null}
        <form className="results-lookup" onSubmit={openById}>
          <label>
            Open by session ID
            <input value={lookup} onChange={(event) => setLookup(event.target.value)} spellCheck={false} />
          </label>
          <button type="submit" className="primary-action">Open session</button>
        </form>
        {props.active && listKind !== 'ready' ? <p role="status">{listMessage(listKind)}</p> : null}
        {props.active && (sessionKind === 'loading' || sessionKind === 'missing' || sessionKind === 'invalid' || sessionKind === 'unavailable' || sessionKind === 'unreachable') ? (
          <p role="status">{sessionMessage(sessionKind)}</p>
        ) : null}
        {props.active && session && sessionKind === 'ready' ? <MonitorResult session={session} /> : null}
        <details>
          <summary>About these sessions</summary>
          <p>A published protocol does not configure them. No explanation is requested for a monitor session.</p>
        </details>
      </section>

      <section className="results-block" aria-labelledby="review-results">
        <h3 id="review-results">Review records</h3>
        <details>
          <summary>About these records</summary>
          <p>This visit’s record is filled while Monitor runs. Saved copies stay in this browser. They are not monitor sessions or replications.</p>
        </details>
        <Review
          protocol={props.review.protocol}
          onAcknowledgeOmission={props.review.acknowledgeOmission}
          onResolveOmission={props.review.resolveOmission}
          onAddHumanEvent={props.review.addHumanEvent}
          onLoadRun={props.review.loadRun}
        />
      </section>

      <details className="results-block">
        <summary>Reference analysis</summary>
        <p>MIT dye-dispersion recordings are an optional comparison. They are not this user’s monitor session or a replication result.</p>
        <ReferenceLab />
      </details>

      <details className="results-block">
        <summary>Replications</summary>
        <p>Open a publication from Library. A planned replication is not a performed monitor session.</p>
      </details>
    </section>
  )
}

function MonitorResult({ session }: { session: RetrievedMonitor }) {
  const alerts = session.alerts ?? []
  const reports = session.humanReports ?? []
  const evidence = session.evidence ?? []
  const observations = session.observations ?? []
  const [copyNote, setCopyNote] = useState('')
  return (
    <div>
      <p role="status">Retrieved from the library.</p>
      <p>
        {session.preparedProtocol ? `${session.preparedProtocol.title}, version ${session.preparedProtocol.version}` : 'Protocol association not recorded'}
        {' · '}
        {sourceLabel(session.sourceKind)}
        {' · '}
        {statusLabel(session.blockedReason)}
      </p>
      <p>{session.startedAtIso ? `Started ${session.startedAtIso}` : 'Start time not recorded.'}</p>
      {session.preparedProtocol ? (
        <div>
          <p>Copied for this session. Not a library replication.</p>
          <ol>
            {session.preparedProtocol.steps.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
          <p>These instructions were copied when the session started. A later draft edit does not change them.</p>
        </div>
      ) : null}
      <h4>Detected issues</h4>
      {alerts.length === 0 ? <p>No issue was retrieved.</p> : null}
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id}>
            {alert.wellId} at {alert.observationTimestamp} ms. {alert.observedState}
            {(alert.updates?.length ?? 0) === 0 ? ' No observed correction was stored.' : ` Observed corrections: ${alert.updates?.length}.`}
            {alert.evidence?.label ? ` Supporting frame: ${alert.evidence.label}.` : ' No supporting frame label was stored.'}
          </li>
        ))}
      </ul>
      <h4>Human reports</h4>
      {reports.length === 0 ? <p>No human report was stored.</p> : <p>{reports.length} human report{reports.length === 1 ? '' : 's'}. A report is not an observed correction.</p>}
      <details>
        <summary>Evidence and history</summary>
        <p>{observations.length} stored observation{observations.length === 1 ? '' : 's'}.</p>
        {observations.length > 0 ? (
          <ul>
            {observations.map((item, index) => {
              const observation = item as { observationTimestamp?: number }
              return <li key={`${observation.observationTimestamp ?? 'time'}-${index}`}>{observation.observationTimestamp ?? 'Time not recorded'} ms</li>
            })}
          </ul>
        ) : null}
        {evidence.length === 0 ? (
          <p>No separate recording was stored. Frame metadata on an alert is not video playback.</p>
        ) : (
          <p>{evidence.length} evidence record{evidence.length === 1 ? '' : 's'} stored. This screen does not play those bytes.</p>
        )}
      </details>
      <details>
        <summary>Details</summary>
        <p className="session-id">{session.id}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(session.id).then(
              () => setCopyNote('Session ID copied.'),
              () => setCopyNote('Copy failed. Select the ID and copy it manually.'),
            )
          }}
        >
          Copy session ID
        </button>
        {copyNote ? <p>{copyNote}</p> : null}
      </details>
    </div>
  )
}

function listMessage(kind: ListKind): string {
  if (kind === 'loading') return 'Loading saved sessions.'
  if (kind === 'empty') return 'No monitor sessions are saved.'
  if (kind === 'unavailable') return 'The database was not reached. Saved sessions cannot be listed.'
  return 'The library service is not reachable. Saved sessions cannot be listed.'
}

function sessionMessage(kind: Exclude<SessionKind, 'idle' | 'ready'>): string {
  if (kind === 'loading') return 'Loading this session.'
  if (kind === 'missing') return 'No saved session has that ID.'
  if (kind === 'invalid') return 'That session ID is not valid.'
  if (kind === 'unavailable') return 'The database was not reached. This session was not loaded.'
  return 'The library service is not reachable. This session was not loaded.'
}
