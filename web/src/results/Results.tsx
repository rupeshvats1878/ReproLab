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
import { deleteUnreferencedRecording, LibraryClientError, publishRecordedSession, uploadSharedRecording } from '../library/client.ts'
import { dropLocalMedia, readLocalMedia } from '../review/store.ts'
import { formatByteSize, nextPublicationAction, SHARED_RECORDING_LIMIT_BYTES } from './publishChoice.ts'
import { ReferenceLab } from '../reference/ReferenceLab.tsx'
import type { ReviewController } from '../shared/types.ts'
import { MONITOR_SESSION_ID, chooseSavedSession, sessionChoiceLabel, sourceLabel, statusLabel } from './sessionBrowse.ts'
import './results.css'

type ListKind = 'loading' | 'ready' | 'empty' | 'unavailable' | 'unreachable'
type SessionKind = 'idle' | 'loading' | 'ready' | 'missing' | 'invalid' | 'unavailable' | 'unreachable'

export function Results(props: { review: ReviewController; active: boolean; onOpenLibrary: (experimentId: string) => void }) {
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
      <p>Inspect a saved session, then publish a finished run.</p>

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
        {props.active && session && sessionKind === 'ready' ? <MonitorResult session={session} onOpenLibrary={props.onOpenLibrary} /> : null}
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

function MonitorResult({ session, onOpenLibrary }: { session: RetrievedMonitor; onOpenLibrary: (experimentId: string) => void }) {
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
        {session.finishedAt ? 'Finished' : 'Not finished'}
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
          <p>{evidence.length} evidence record{evidence.length === 1 ? '' : 's'}. A frame label is not the recording.</p>
        )}
      </details>
      <PublishRun session={session} onOpenLibrary={onOpenLibrary} />
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

function PublishRun({ session, onOpenLibrary }: { session: RetrievedMonitor; onOpenLibrary: (experimentId: string) => void }) {
  const [notes, setNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedId, setPublishedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [includeRecording, setIncludeRecording] = useState(false)
  const [uploadFailed, setUploadFailed] = useState(false)
  const [localFile, setLocalFile] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const alerts = session.alerts ?? []
  const unresolved = alerts.filter((alert) => (alert.updates?.length ?? 0) === 0)
  const corrections = alerts.reduce((count, alert) => count + (alert.updates?.length ?? 0), 0)
  const reports = session.humanReports ?? []
  const evidence = (session.evidence ?? []) as LocalEvidence[]
  const recording = evidence.find((item) => item.available && (item.kind === 'camera_recording' || item.kind === 'prerecorded_source') && item.id)
  const synthetic = session.sourceKind === 'synthetic'
  useEffect(() => {
    if (!recording?.id) return undefined
    let cancelled = false
    let url = ''
    void readLocalMedia(recording.id).then((blob) => {
      if (cancelled || !blob) return
      url = URL.createObjectURL(blob)
      setLocalFile(blob)
      setPreviewUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [recording?.id])
  if (!session.finishedAt) {
    return <p>This session is not finished. Finish it in Monitor before publishing. Stopping the camera does not finish it.</p>
  }
  const capture = session.procedureId === 'three-cup-capture'
  if (!session.preparedProtocol && !capture) {
    return <p>No approved procedure is stored with this session, so it cannot be published.</p>
  }
  const overLimit = localFile != null && localFile.size > SHARED_RECORDING_LIMIT_BYTES
  async function publish(confirmWithout: boolean, retryUpload = false) {
    if (publishing || (!session.preparedProtocol && session.procedureId !== 'three-cup-capture')) return
    const action = nextPublicationAction({
      includeRecording: includeRecording && !overLimit && localFile != null,
      uploadFailed: retryUpload ? false : uploadFailed,
      publishWithoutConfirmed: confirmWithout,
    })
    if (action === 'hold') return
    setPublishing(true)
    setError('')
    try {
      let shared: { evidenceId: string; mediaId: string } | null = null
      let uploadedId: string | null = null
      if (action === 'upload') {
        if (!localFile || !recording?.id) throw new LibraryClientError('The local recording is not available.')
        const uploaded = await uploadSharedRecording(localFile)
        uploadedId = uploaded.id
        shared = { evidenceId: recording.id, mediaId: uploaded.id }
      }
      let saved
      try {
        saved = await publishRecordedSession(session.id, notes, shared)
      } catch (reason) {
        if (uploadedId) await deleteUnreferencedRecording(uploadedId)
        throw reason
      }
      const referenced = saved.runRecord?.evidence?.some((item) => item.sharedMediaId === uploadedId)
      if (uploadedId && !referenced) await deleteUnreferencedRecording(uploadedId)
      if (shared && referenced && recording?.id) await dropLocalMedia(recording.id).catch(() => undefined)
      setUploadFailed(false)
      setPublishedId(saved.id)
    } catch (reason: unknown) {
      setPublishedId(null)
      if (action === 'upload') setUploadFailed(true)
      setError(reason instanceof LibraryClientError ? reason.message : 'Publishing failed. Nothing new was saved.')
    } finally {
      setPublishing(false)
    }
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); void publish(false) }}>
      <h4>Publish experiment</h4>
      <p>Finished does not mean the run succeeded. Unresolved issues stay in the publication.</p>
      {synthetic ? <p>Synthetic demonstration. Not a camera recording.</p> : null}
      {capture ? <p>Three-cup capture. Automatic checks are not connected. Markers are reports from a person, not camera judgments.</p> : null}
      <p>{capture ? 'Three-cup capture' : `${session.preparedProtocol?.title}, version ${session.preparedProtocol?.version}`}. {sourceLabel(session.sourceKind)}.</p>
      {session.preparedProtocol ? (
        <ol>
          {session.preparedProtocol.steps.map((instruction) => <li key={instruction}>{instruction}</li>)}
        </ol>
      ) : null}
      <p>{session.observations?.length ?? 0} recorded observations. {alerts.length} deviations. {corrections} observed corrections. {reports.length} human reports.</p>
      {unresolved.length > 0 ? (
        <ul>
          {unresolved.map((alert) => (
            <li key={alert.id}>{alert.wellId} remains unresolved. {alert.observedState}</li>
          ))}
        </ul>
      ) : <p>No unresolved deviation was stored.</p>}
      {recording && localFile && previewUrl ? (
        <div>
          <p>Local recording preview. This file is not in the library until you include it.</p>
          <video className="publish-preview" src={previewUrl} controls playsInline />
          <label className="check-field">
            <input
              type="checkbox"
              checked={includeRecording && !overLimit}
              disabled={overLimit || publishing}
              onChange={(event) => {
                setIncludeRecording(event.target.checked)
                setUploadFailed(false)
              }}
            />
            Include recording ({formatByteSize(localFile.size)}). Limit {formatByteSize(SHARED_RECORDING_LIMIT_BYTES)}.
          </label>
          {overLimit ? <p role="alert">This file is over the library limit, so it cannot be included. You can still publish the run.</p> : null}
        </div>
      ) : recording ? (
        <p>A recording was saved for this browser, but the file is not available now. Publishing will not include it.</p>
      ) : (
        <p>No recording file is available. A frame label is not footage. You can still publish the run.</p>
      )}
      <label>
        Researcher notes
        <textarea value={notes} rows={3} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Optional outcome and limitations" />
      </label>
      <button type="submit" className="primary-action" disabled={publishing}>
        {publishing ? 'Publishing…' : includeRecording && !overLimit && localFile ? 'Publish with recording' : 'Publish'}
      </button>
      {uploadFailed ? (
        <p role="alert">
          {error} The local file is still here.
          <button type="button" onClick={() => void publish(false, true)} disabled={publishing}>Retry upload</button>
          <button type="button" onClick={() => void publish(true)} disabled={publishing}>Publish without recording</button>
        </p>
      ) : error ? <p role="alert">{error}</p> : null}
      {publishedId ? (
        <p role="status">
          Published {publishedId}.
          <button type="button" onClick={() => onOpenLibrary(publishedId)}>View in Library</button>
        </p>
      ) : null}
    </form>
  )
}

interface LocalEvidence {
  id?: string
  kind?: string
  label?: string
  available?: boolean
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
