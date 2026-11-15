import { useEffect, useState } from 'react'
import { Review } from '../components/Review.tsx'
import { readMonitorIndex, readMonitorSession, type MonitorSessionRef, type RetrievedMonitor } from '../monitor/saveSession.ts'
import { ReferenceLab } from '../reference/ReferenceLab.tsx'
import type { ReviewController } from '../shared/types.ts'
import './results.css'

export function Results(props: { review: ReviewController; active: boolean }) {
  const [trackedActive, setTrackedActive] = useState(props.active)
  const [index, setIndex] = useState<MonitorSessionRef[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [session, setSession] = useState<RetrievedMonitor | null>(null)
  const [loadNote, setLoadNote] = useState('No monitor session has been saved in this browser yet.')

  if (props.active !== trackedActive) {
    setTrackedActive(props.active)
    if (props.active) {
      const next = readMonitorIndex(localStorage)
      setIndex(next)
      setSelectedId((current) => (current && next.some((item) => item.id === current) ? current : next[0]?.id ?? ''))
      if (next.length === 0) {
        setSession(null)
        setLoadNote('No monitor session has been saved in this browser yet.')
      }
    }
  }

  useEffect(() => {
    if (!selectedId) return
    let cancel = false
    void readMonitorSession(selectedId).then((found) => {
      if (cancel) return
      setSession(found)
      setLoadNote(found ? 'Retrieved from the library.' : 'This session was not retrieved. It is not shown as stored.')
    })
    return () => {
      cancel = true
    }
  }, [selectedId])

  return (
    <section className="results">
      <h2>Results</h2>
      <p>Monitor sessions, colored-water review records, and replications are separate. A planned replication is not a performed monitor session.</p>

      <section className="results-block" aria-labelledby="monitor-results">
        <h3 id="monitor-results">Monitor sessions</h3>
        <p>These are six-well colored-water sessions saved through the monitor API. A published protocol does not configure them.</p>
        {index.length > 1 ? (
          <label>
            Session
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {index.map((item) => (
                <option key={item.id} value={item.id}>
                  {sourceLabel(item.sourceKind)} · {item.startedAtIso}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p role="status">{loadNote}</p>
        {session ? <MonitorResult session={session} /> : null}
        <p>No Gemini explanation is requested for a monitor session. The explanation endpoint accepts a colored-water review record, which is a different document.</p>
      </section>

      <section className="results-block" aria-labelledby="review-results">
        <h3 id="review-results">Colored-water review records</h3>
        <p>This visit’s review record is filled by the monitor while it runs. Saved copies stay in this browser. They are not Atlas monitor sessions and they are not replication records.</p>
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

      <section className="results-block">
        <h3>Replications</h3>
        <p>Open a publication from Prepare, then Experiment library. Starting a replication records a plan. The execution screen stays on that record and is not mixed into the monitor results above.</p>
      </section>
    </section>
  )
}

function MonitorResult({ session }: { session: RetrievedMonitor }) {
  const alerts = session.alerts ?? []
  const reports = session.humanReports ?? []
  const evidence = session.evidence ?? []
  return (
    <div>
      <p>
        {sourceLabel(session.sourceKind)} · {session.id}
        {session.startedAtIso ? ` · started ${session.startedAtIso}` : ''}
      </p>
      {session.blockedReason ? <p>Session blocked: {session.blockedReason}</p> : null}
      {session.preparedProtocol ? (
        <div>
          <p>Approved protocol: {session.preparedProtocol.title}, version {session.preparedProtocol.version}. This is not a library replication.</p>
          <ol>
            {session.preparedProtocol.steps.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
          <p>These instructions were copied when the session started. A later draft edit does not change them.</p>
        </div>
      ) : (
        <p>Protocol association not recorded.</p>
      )}
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
      <h4>Evidence</h4>
      {evidence.length === 0 ? (
        <p>No separate recording was stored. Frame metadata on an alert is not video playback.</p>
      ) : (
        <p>{evidence.length} evidence record{evidence.length === 1 ? '' : 's'} stored. This screen does not play those bytes.</p>
      )}
    </div>
  )
}

function sourceLabel(kind: string): string {
  if (kind === 'live') return 'Live camera'
  if (kind === 'prerecorded') return 'Imported video'
  if (kind === 'synthetic') return 'Synthetic demonstration'
  return `Unrecognized source (${kind || 'missing'})`
}
