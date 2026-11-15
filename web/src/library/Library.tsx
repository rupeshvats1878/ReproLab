import { useCallback, useEffect, useRef, useState } from 'react'
import { Run } from '../run/Run.tsx'
import {
  countLabel,
  listQuery,
  PAGE_SIZE,
  publishedLabel,
  recordLabel,
  stepLabel,
  versionLabel,
} from './browse.ts'
import { monitorProtocolFromInstructions, type PreparedMonitorProtocol } from '../prepare/sixWell.ts'
import { watchMomentMs } from '../vision/alignment.ts'
import {
  LibraryClientError,
  listExperiments,
  openExperiment,
  openReplication,
  sharedRecordingUrl,
  startReplication,
  type ExperimentPage,
  type ReplicationRecord,
  type SnapshotStep,
  type StoredExperiment,
} from './client.ts'
import './Library.css'

const OPEN_REPLICATION_KEY = 'reprolab-open-replication-id'

type LoadState = 'loading' | 'ready' | 'unavailable' | 'unreachable' | 'error'

export function Library(props: {
  focusId: string | null
  onFocusHandled: () => void
  onOpenResults: () => void
  onSetupMonitoring: (protocol: PreparedMonitorProtocol) => void
}) {
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [status, setStatus] = useState<LoadState>('loading')
  const [page, setPage] = useState<ExperimentPage>({ experiments: [], limit: PAGE_SIZE, offset: 0, total: null })
  const [opened, setOpened] = useState<StoredExperiment | null>(null)
  const [replication, setReplication] = useState<ReplicationRecord | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [copyNote, setCopyNote] = useState('')
  const [busy, setBusy] = useState(false)
  const focused = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listExperiments(listQuery({ q: query, sort, offset }))
      .then((result) => {
        if (cancelled) return
        setPage(result)
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setPage({ experiments: [], limit: PAGE_SIZE, offset, total: null })
        setStatus(loadFailure(reason))
        setError(message(reason))
      })
    return () => {
      cancelled = true
    }
  }, [query, sort, offset, reload])

  useEffect(() => {
    const savedId = sessionStorage.getItem(OPEN_REPLICATION_KEY)
    if (!savedId) return
    let cancelled = false
    void openReplication(savedId)
      .then((record) => {
        if (!cancelled) setReplication(record)
      })
      .catch(() => {
        if (!cancelled) sessionStorage.removeItem(OPEN_REPLICATION_KEY)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openSelected = useCallback(async (id: string) => {
    setBusy(true)
    setError('')
    setCopyNote('')
    setRunId(null)
    try {
      const record = await openExperiment(id)
      setOpened(record)
      setNotice('Opened the published snapshot. Local drafts in Prepare are separate.')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }, [])

  const focusId = props.focusId
  const onFocusHandled = props.onFocusHandled
  useEffect(() => {
    if (!focusId) {
      focused.current = null
      return
    }
    if (focused.current === focusId) return
    focused.current = focusId
    onFocusHandled()
    void openSelected(focusId)
  }, [focusId, onFocusHandled, openSelected])

  async function replicate() {
    if (!opened || busy) return
    setBusy(true)
    setError('')
    try {
      const record = await startReplication(opened.id)
      sessionStorage.setItem(OPEN_REPLICATION_KEY, record.id)
      setReplication(record)
      setNotice('Created a planned replication. It has not been started.')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopyNote('Copied the publication id.')
    } catch {
      setCopyNote('The publication id is shown above.')
    }
  }

  const searching = query.length > 0
  const shownReplication = replication && opened && replication.experimentId === opened.id ? replication : null

  return (
    <section className="library-lab">
      <h2>Experiment library</h2>
      <p>Inspect what was recorded and repeat the procedure.</p>
      <details className="library-note">
        <summary>About this library</summary>
        <p>Shared on this network. A finished monitor session is published from Results. This screen does not sign anyone in, and a publication is not a public website.</p>
      </details>
      <form
        className="library-toolbar"
        onSubmit={(event) => {
          event.preventDefault()
          setStatus('loading')
          setError('')
          setQuery(draftQuery.trim())
          setOffset(0)
          setReload((value) => value + 1)
        }}
      >
        <label>
          Search titles
          <input
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            maxLength={120}
          />
        </label>
        <button type="submit" className="primary-action">Search</button>
        <label>
          Sort
          <select
            value={sort}
            onChange={(event) => {
              setStatus('loading')
              setError('')
              setSort(event.target.value === 'oldest' ? 'oldest' : 'newest')
              setOffset(0)
            }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
        <button type="button" onClick={() => { setStatus('loading'); setError(''); setReload((value) => value + 1) }}>Refresh</button>
        <button type="button" onClick={props.onOpenResults}>Publish from Results</button>
      </form>
      {error ? <p role="alert" className="library-warning">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      {runId ? (
        <div className="library-record">
          <button type="button" onClick={() => setRunId(null)}>Back</button>
          <p>This record stays planned until you start it here. It is not a monitor session.</p>
          <Run replicationId={runId} />
        </div>
      ) : opened ? (
        <Publication
          record={opened}
          replication={shownReplication}
          busy={busy}
          copyNote={copyNote}
          onBack={() => setOpened(null)}
          onCopy={() => void copyId(opened.id)}
          onReplicate={() => void replicate()}
          onOpenRun={(id) => setRunId(id)}
          onSetupMonitoring={props.onSetupMonitoring}
        />
      ) : (
        <Browser
          status={status}
          page={page}
          searching={searching}
          query={query}
          offset={offset}
          onOpen={(id) => void openSelected(id)}
          onPrevious={() => { setStatus('loading'); setError(''); setOffset((value) => Math.max(0, value - PAGE_SIZE)) }}
          onNext={() => { setStatus('loading'); setError(''); setOffset((value) => value + PAGE_SIZE) }}
          onOpenResults={props.onOpenResults}
        />
      )}
    </section>
  )
}

function Browser(props: {
  status: LoadState
  page: ExperimentPage
  searching: boolean
  query: string
  offset: number
  onOpen: (id: string) => void
  onPrevious: () => void
  onNext: () => void
  onOpenResults: () => void
}) {
  if (props.status === 'loading') return <p role="status">Loading publications.</p>
  if (props.status === 'unavailable') {
    return <p role="status">The database is unavailable. Published experiments cannot be listed.</p>
  }
  if (props.status === 'unreachable') {
    return <p role="status">The library service is not reachable. Published experiments cannot be listed.</p>
  }
  if (props.status === 'error') return null
  if (props.page.experiments.length === 0) {
    return (
      <div role="status">
        <p>{props.searching ? `No publications match “${props.query}”.` : 'No publications yet.'}</p>
        <button type="button" className="primary-action" onClick={props.onOpenResults}>Publish from Results</button>
      </div>
    )
  }
  const total = props.page.total
  const canNext = total != null
    ? props.offset + props.page.experiments.length < total
    : props.page.experiments.length === PAGE_SIZE
  return (
    <div>
      <p>{countLabel(props.page.experiments.length, total, props.searching)}</p>
      <table className="library-table">
        <thead>
          <tr>
            <th>Published experiment</th>
            <th>Protocol version</th>
            <th>Steps</th>
            <th>Published</th>
            <th>Record</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.page.experiments.map((experiment) => (
            <tr key={experiment.id}>
              <td>{experiment.title}</td>
              <td>{versionLabel(experiment.protocolVersion)}</td>
              <td>{stepLabel(experiment.stepCount)}</td>
              <td>{publishedLabel(experiment.publishedAt)}</td>
              <td>{recordLabel(experiment.kind)}</td>
              <td><button type="button" onClick={() => props.onOpen(experiment.id)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="library-cards">
        {props.page.experiments.map((experiment) => (
          <article key={experiment.id} className="library-card">
            <h3>{experiment.title}</h3>
            <p>{versionLabel(experiment.protocolVersion)}</p>
            <p>{stepLabel(experiment.stepCount)}</p>
            <p>{publishedLabel(experiment.publishedAt)}</p>
            <p>{recordLabel(experiment.kind)}</p>
            <button type="button" onClick={() => props.onOpen(experiment.id)}>Open</button>
          </article>
        ))}
      </div>
      <div className="library-pages">
        <button type="button" onClick={props.onPrevious} disabled={props.offset === 0}>Previous</button>
        <button type="button" onClick={props.onNext} disabled={!canNext}>Next</button>
      </div>
    </div>
  )
}

function Publication(props: {
  record: StoredExperiment
  replication: ReplicationRecord | null
  busy: boolean
  copyNote: string
  onBack: () => void
  onCopy: () => void
  onReplicate: () => void
  onOpenRun: (id: string) => void
  onSetupMonitoring: (protocol: PreparedMonitorProtocol) => void
}) {
  const snapshot = props.record.protocolSnapshot
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : []
  const run = props.record.runRecord
  const monitoring = monitorProtocolFromInstructions(
    steps.filter((step): step is SnapshotStep => typeof step === 'object' && step !== null),
    typeof snapshot.id === 'string' ? snapshot.id : props.record.id,
    typeof snapshot.version === 'number' ? snapshot.version : 1,
    props.record.title,
  )
  const source = typeof snapshot.sourceText === 'string' && snapshot.sourceText.trim() ? snapshot.sourceText : ''
  const quotes = steps.flatMap((step, index) => {
    const quote = stepQuote(step)
    return quote ? [{ index, quote }] : []
  })
  return (
    <div className="library-record">
      <button type="button" onClick={props.onBack}>Back to the list</button>
      <h3>{props.record.title}</h3>
      <p>{recordLabel(props.record.kind)}. Frozen protocol {versionLabel(typeof snapshot.version === 'number' ? snapshot.version : undefined)}.</p>
      {run ? <RecordedSummary run={run} /> : null}
      {steps.length === 0 ? <p>No steps were stored in this snapshot.</p> : (
        <ol>
          {steps.map((step, index) => (
            <li key={`${index}-${stepInstruction(step)}`}>{stepInstruction(step)}</li>
          ))}
        </ol>
      )}
      {source ? (
        <details>
          <summary>Source text</summary>
          <p>{source}</p>
        </details>
      ) : null}
      {quotes.length > 0 ? (
        <details>
          <summary>Supporting quotes</summary>
          <ul>
            {quotes.map((item) => (
              <li key={`${item.index}-${item.quote}`}>Step {item.index + 1}: {item.quote}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <details>
        <summary>Details</summary>
        <p>A published protocol does not configure the six-well detector. A planned replication is not a monitor session.</p>
        <p>Publication id {props.record.id}</p>
        <button type="button" onClick={props.onCopy}>Copy</button>
        {props.copyNote ? <p role="status">{props.copyNote}</p> : null}
        {props.record.description ? <p>{props.record.description}</p> : null}
        {props.record.monitorSessionId ? <p>Monitor session {props.record.monitorSessionId}</p> : null}
        {props.record.publishedAt ? <p>Published {publishedLabel(props.record.publishedAt)}</p> : null}
        {run ? <ObservationHistory run={run} /> : null}
      </details>
      <button type="button" className="primary-action" onClick={props.onReplicate} disabled={props.busy}>Repeat experiment</button>
      {props.replication ? (
        <div>
          <p>Replication status: {props.replication.status === 'planned' ? 'Planned' : props.replication.status}.</p>
          <p>{props.replication.note} The original run is not copied.</p>
          <button type="button" onClick={() => props.onOpenRun(props.replication!.id)}>Open record</button>
          {monitoring ? (
            <button type="button" onClick={() => props.onSetupMonitoring(monitoring)}>Set up monitoring</button>
          ) : (
            <p>Automatic monitoring is unavailable for this procedure.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function RecordedSummary({ run }: { run: NonNullable<StoredExperiment['runRecord']> }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const alerts = run.alerts ?? []
  const unresolved = alerts.filter((alert) => (alert.updates?.length ?? 0) === 0)
  const corrections = alerts.reduce((count, alert) => count + (alert.updates?.length ?? 0), 0)
  const reports = run.humanReports ?? []
  const evidence = run.evidence ?? []
  const shared = evidence.find((item) => item.available && item.sharedMediaId)
  const markers = run.humanMarkers ?? []
  const capture = run.procedureId === 'three-cup-capture'
  const source = capture
    ? 'Three-cup capture. Automatic checks are not connected.'
    : run.sourceKind === 'synthetic'
    ? 'Synthetic demonstration.'
    : run.sourceKind === 'prerecorded'
      ? 'Imported video.'
      : run.sourceKind === 'live'
        ? 'Camera.'
        : 'Source not recorded.'
  function watch(momentMs: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = momentMs / 1000
    void video.play().catch(() => undefined)
  }
  return (
    <div>
      <p>{source} {run.observationCount ?? run.observations?.length ?? 0} observations. {alerts.length} deviations. {corrections} observed corrections. {reports.length} human reports.</p>
      {shared?.sharedMediaId ? (
        <div>
          <video ref={videoRef} className="library-recording" src={sharedRecordingUrl(shared.sharedMediaId)} controls playsInline />
          <p>This recording is stored with the shared library. Anyone who can open this library can play it. This library does not sign anyone in.</p>
        </div>
      ) : run.sourceKind === 'synthetic' ? (
        <p>Synthetic demonstration. No camera recording is stored.</p>
      ) : (
        <p>No recording was included. A frame label is not footage.</p>
      )}
      {capture ? <p>RED, GREEN, and BLUE are physical cup labels. Operator markers are not model judgments.</p> : null}
      {markers.length > 0 ? (
        <ul>
          {markers.map((marker) => {
            const moment = shared ? watchMomentMs(marker.observationTimestamp ?? -1, shared.runStartOffsetMs ?? 0, shared.durationMs) : null
            return (
              <li key={marker.id ?? marker.label}>
                {marker.label}. Reported by a person at {marker.observationTimestamp} ms.
                {moment == null ? '' : <button type="button" onClick={() => watch(moment)}>Watch moment</button>}
              </li>
            )
          })}
        </ul>
      ) : null}
      {unresolved.length > 0 ? (
        <ul>
          {unresolved.map((alert) => {
            const moment = shared ? watchMomentMs(alert.observationTimestamp, shared.runStartOffsetMs ?? 0, shared.durationMs) : null
            return (
              <li key={alert.id}>
                {alert.wellId} unresolved. {alert.observedState}
                {alert.evidence?.label ? ` Frame label: ${alert.evidence.label}.` : ''}
                {moment == null ? '' : (
                  <button type="button" onClick={() => watch(moment)}>Watch moment</button>
                )}
              </li>
            )
          })}
        </ul>
      ) : <p>No unresolved deviation was stored.</p>}
      {reports.length > 0 ? (
        <ul>
          {reports.map((report) => (
            <li key={report.id ?? report.humanNote}>{report.wellId}: {report.humanNote}{report.humanReportedState ? ` Reported ${report.humanReportedState}.` : ''} A report is not an observed correction.</li>
          ))}
        </ul>
      ) : null}
      {run.notes ? <p>Notes: {run.notes}</p> : <p>No researcher notes.</p>}
      {evidence.length === 0 ? <p>No recording metadata was stored.</p> : (
        <ul>
          {evidence.map((item) => (
            <li key={item.id ?? item.label}>
              {item.label || 'Evidence label not recorded'}.
              {item.available && item.sharedMediaId
                ? ` Shared recording, ${item.byteLength ?? 'unknown'} bytes.`
                : ' Not included. No file was stored in the library.'}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ObservationHistory({ run }: { run: NonNullable<StoredExperiment['runRecord']> }) {
  const observations = run.observations ?? []
  if (observations.length === 0) return <p>No observation timestamps were stored.</p>
  return (
    <div>
      <p>{observations.length} observation timestamps.</p>
      <ul>
        {observations.map((item, index) => (
          <li key={item.id ?? index}>{item.observationTimestamp ?? 'Time not recorded'} ms</li>
        ))}
      </ul>
    </div>
  )
}

function stepInstruction(step: SnapshotStep | string): string {
  if (typeof step === 'string' && step.trim()) return step
  if (typeof step === 'object' && step && typeof step.instruction === 'string' && step.instruction.trim()) return step.instruction
  return 'Step'
}

function stepQuote(step: SnapshotStep | string): string | null {
  if (typeof step !== 'object' || !step || typeof step.quote !== 'string') return null
  const quote = step.quote.trim()
  return quote ? quote : null
}

function loadFailure(reason: unknown): LoadState {
  if (reason instanceof LibraryClientError && reason.status === 503) return 'unavailable'
  if (reason instanceof LibraryClientError && reason.status === 0) return 'unreachable'
  return 'error'
}

function message(reason: unknown): string {
  return reason instanceof LibraryClientError ? reason.message : 'The experiment library request failed.'
}
