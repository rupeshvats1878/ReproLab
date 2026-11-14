import { useEffect, useMemo, useRef, useState } from 'react'
import { SYNTHETIC_DEMO_RUNS } from '../shared/exampleRun.ts'
import { evidenceIsCovered, evidenceOffsetMs } from '../shared/protocol.ts'
import { compareRuns } from '../review/compare.ts'
import {
  CAMERA_MISSED_NOTE,
  CORRECTION_TEXT,
  LEAVE_UNRESOLVED_NOTE,
  runRecordFromState,
} from '../review/engine.ts'
import {
  explanationRequestFromRuns,
  isCurrentExplanation,
  validateExplanation,
  type ExplanationResponse,
} from '../review/explanation.ts'
import { groupAlerts, laterObservedFill, readingLabel, unconfirmedWells } from '../review/present.ts'
import { createRunStore, saveRun, storageErrorMessage, type RunStore } from '../review/store.ts'
import type {
  AlertId,
  HumanEvent,
  MediaAvailability,
  OmissionAlert,
  ProtocolState,
  ReviewProps,
  RunRecord,
} from '../shared/types.ts'
import './Review.css'

const EXPLAIN_URL = 'http://127.0.0.1:8787/explain'

export function Review(props: ReviewProps) {
  const { protocol, onAcknowledgeOmission, onResolveOmission, onAddHumanEvent, onLoadRun } = props
  const store = useMemo(() => createRunStore(), [])
  const [useFixtures, setUseFixtures] = useState(false)
  const [saved, setSaved] = useState<RunRecord[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)
  const [removedId, setRemovedId] = useState<string | null>(null)
  const [ai, setAi] = useState<ExplanationResponse | null>(null)
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'ready' | 'unavailable' | 'rejected'>('idle')
  const [aiError, setAiError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const comparisonRecords = useMemo(() => useFixtures ? SYNTHETIC_DEMO_RUNS : saved, [useFixtures, saved])
  const comparison = useMemo(() => compareRuns(comparisonRecords), [comparisonRecords])
  useEffect(() => {
    requestSeq.current += 1
    setAi(null)
    setAiState('idle')
  }, [comparisonRecords])

  async function refreshSaved() {
    setSaved(await store.list())
  }

  useEffect(() => {
    let cancelled = false
    void store
      .list()
      .then((runs) => {
        if (!cancelled) setSaved(runs)
      })
      .catch((error: unknown) => {
        if (!cancelled) setStorageError(storageErrorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [store])

  async function saveCurrent() {
    const record = runRecordFromState({ protocol })
    if (!record) return
    try {
      const stored = await saveRun(store, record)
      setStorageError(null)
      await refreshSaved()
      if (protocol.phase === 'completed') onLoadRun(stored)
    } catch (error) {
      setStorageError(storageErrorMessage(error))
    }
  }

  async function deleteSaved(id: string) {
    try {
      await store.delete(id)
      setStorageError(null)
      setRemovedId(id)
      await refreshSaved()
    } catch (error) {
      setStorageError(storageErrorMessage(error))
    }
  }

  async function requestExplanation() {
    const requestId = requestSeq.current + 1
    requestSeq.current = requestId
    const request = explanationRequestFromRuns(comparisonRecords)
    setAiState('loading')
    setAiError(null)
    try {
      const response = await fetch(EXPLAIN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(20000),
      })
      if (!isCurrentExplanation(requestSeq.current, requestId)) return
      if (!response.ok) {
        setAi(null)
        setAiState('unavailable')
        return
      }
      const body: unknown = await response.json()
      if (!isCurrentExplanation(requestSeq.current, requestId)) return
      const errors = validateExplanation(request, body)
      if (errors.length > 0) {
        setAi(null)
        setAiError(errors.join(' '))
        setAiState('rejected')
        return
      }
      setAi(body as ExplanationResponse)
      setAiState('ready')
    } catch {
      if (!isCurrentExplanation(requestSeq.current, requestId)) return
      setAi(null)
      setAiState('unavailable')
    }
  }

  const record = runRecordFromState({ protocol })
  const openHold = protocol.phase === 'running' && protocol.alerts.some((alert) => alert.status === 'open' && !protocol.humanEvents.some(e => e.alertId === alert.id && e.note === LEAVE_UNRESOLVED_NOTE))
  const groups = groupAlerts(protocol.alerts)

  return (
    <section className="review" aria-labelledby="review-title">
      <div className="review-heading">
        <h2 id="review-title">Review</h2>
        <p>
          Possible omissions, human responses, and evidence timestamps for one six-well colored-water
          run. A flag is a possible skip, not a confirmed cause.
        </p>
      </div>

      <p className="review-live">
        Phase <strong>{protocol.phase}</strong>
        {' · '}
        Expected well <strong>{protocol.expectedWellId ?? 'None'}</strong>
        {' · '}
        Elapsed <strong>{protocol.elapsedMs} ms</strong>
        {protocol.metadata ? ` · ${protocol.metadata.title}` : ' · no run loaded'}
      </p>

      {protocol.metadata?.syntheticFixture ? (
        <div className="fixture-banner">
          <p>Synthetic fixture. This is not a live bench result and it does not include video bytes.</p>
        </div>
      ) : null}

      {openHold ? (
        <p className="review-hold" role="status">
          Checklist hold: a possible omission is waiting for a person. New observations are still
          recorded. The camera grid still follows those observations.
        </p>
      ) : null}

      {storageError ? (
        <p className="review-error" role="alert">
          {storageError}
        </p>
      ) : null}

      {removedId && removedId === protocol.metadata?.id ? (
        <p className="review-note">
          Removed from this browser. This view is the last loaded copy until you open another run.
        </p>
      ) : null}

      <div className="review-block">
        <h3>Synthetic demos</h3>
        <p>These three authored records are the demo. They are labeled synthetic and contain no footage.</p>
        <ul className="fixture-list">
          {SYNTHETIC_DEMO_RUNS.map((run) => (
            <li key={run.metadata.id}>
              <h4>{run.metadata.title}</h4>
              <p>{run.metadata.notes}</p>
              <button type="button" disabled={protocol.phase === 'running'} onClick={() => onLoadRun(run)}>
                Open {run.metadata.title}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="review-block">
        <h3>Saved in this browser</h3>
        <p>JSON stays in IndexedDB. Video and image bytes are a separate store and are not uploaded.</p>
        <button type="button" onClick={() => void saveCurrent()} disabled={!record}>
          Save current run
        </button>
        {saved.length === 0 ? <p>No saved runs in this browser.</p> : null}
        <ul className="fixture-list">
          {saved.map((run) => (
            <li key={run.metadata.id}>
              <h4>
                {run.metadata.title}
                {run.metadata.syntheticFixture ? ' · synthetic' : ''}
              </h4>
              <p className="fixture-meta">
                {notResolvedLabel(run)} · {run.media.filter((media) => media.available).length} media files
                stored
              </p>
              <div className="review-actions">
                <button type="button" disabled={protocol.phase === 'running'} onClick={() => onLoadRun(run)}>
                  Open
                </button>
                <button type="button" onClick={() => void deleteSaved(run.metadata.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="review-block">
        <h3>Run comparison</h3>
        <label><input type="checkbox" checked={useFixtures} onChange={e => setUseFixtures(e.target.checked)} /> Use synthetic examples instead of saved runs</label>
        <p>{useFixtures ? 'Synthetic examples — not actual bench results.' : `Comparing ${saved.length} saved runs. Save each completed run to include it.`}</p>
        <p className="review-kicker">Deterministic summary</p>
        <p>{comparison.summary}</p>
        <p>{comparison.caveat}</p>
        <ul className="fixture-list">
          {comparison.runs.map((run) => (
            <li key={run.runId}>
              <h4>
                {run.title}
                {run.synthetic ? ' · synthetic' : ''}
              </h4>
              <p>Observed filled after a flag: {listWells(run.observedFilled)}</p>
              <p>User-reported filled: {listWells(run.reportedFilled)}</p>
              <p>Unresolved: {listWells(run.unresolved)}</p>
              <p>Unknown wells: {listWells(run.unknownWells)}</p>
              <p>Final image empty: {listWells(run.finalEmpty)}; unknown: {listWells(run.finalUnknown)}</p>
              {run.evidence.length === 0 ? <p>No evidence timestamps on human events.</p> : null}
              <ul>
                {run.evidence.map((link) => (
                  <li key={`${link.mediaId}-${link.elapsedMs}`}>
                    {link.label} at {link.elapsedMs} ms
                    {link.mediaOffsetMs == null
                      ? ' · no media record for this reference'
                      : ` · file offset ${link.mediaOffsetMs} ms`}
                    {link.covered ? ' · playback covered' : ' · playback unavailable'}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="review-kicker">Live model explanation</p>
        <button type="button" onClick={() => void requestExplanation()} disabled={aiState === 'loading' || comparisonRecords.length === 0}>
          Request an evidence-backed explanation
        </button>
        {aiState === 'unavailable' ? <p>Live AI explanation is unavailable.</p> : null}
        {aiState === 'rejected' ? <p>The explanation was rejected. {aiError}</p> : null}
        {aiState === 'ready' && ai ? (
          <div>
            <p>{ai.summary}</p>
            <p>Uncertainty: {ai.uncertainty}</p>
            <ul>
              {ai.citations.map((citation) => (
                <li key={`${citation.runId}-${citation.eventId}`}>
                  {citation.claim} ({citation.runId}, {citation.eventId})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {record ? (
        <RunDetail
          protocol={protocol}
          record={record}
          groups={groups}
          store={store}
          onAcknowledgeOmission={onAcknowledgeOmission}
          onResolveOmission={onResolveOmission}
          onAddHumanEvent={onAddHumanEvent}
        />
      ) : (
        <p>Open a synthetic demo or a saved run to see its timeline.</p>
      )}
    </section>
  )
}

function listWells(wells: readonly string[]): string {
  return wells.length === 0 ? 'None' : wells.join(', ')
}

function notResolvedLabel(run: RunRecord): string {
  const count = run.alerts.filter((alert) => alert.status !== 'resolved').length
  return `${count} alert${count === 1 ? '' : 's'} not resolved`
}

function RunDetail(props: {
  protocol: ProtocolState
  record: RunRecord
  groups: OmissionAlert[][]
  store: RunStore
  onAcknowledgeOmission: (alertId: AlertId) => void
  onResolveOmission: (alertId: AlertId, note?: string) => void
  onAddHumanEvent: ReviewProps['onAddHumanEvent']
}) {
  const { protocol, record, groups, store, onAcknowledgeOmission, onResolveOmission, onAddHumanEvent } =
    props
  const unconfirmed = unconfirmedWells(record)

  return (
    <>
      <div className="review-block">
        <h3>Timeline</h3>
        <ol className="review-timeline">
          {timelineRows(protocol).map((row) => (
            <li key={row.key}>
              <span className="fixture-meta">{row.at} ms</span> {row.text}
            </li>
          ))}
        </ol>
      </div>

      <div className="review-block">
        <h3>Possible omissions</h3>
        {groups.length === 0 ? <p>No omission alerts in this run.</p> : null}
        {groups.map((group) => (
          <div key={group[0]?.sourceObservationId} className="review-group">
            <p>
              Raised together at {group[0]?.raisedAtElapsedMs} ms from {group[0]?.sourceObservationId}.
            </p>
            <ul className="fixture-list">
              {group.map((alert) => {
                const source = record.observations
                  .find((observation) => observation.id === alert.sourceObservationId)
                  ?.wells.find((reading) => reading.wellId === alert.wellId)?.state
                const observed = laterObservedFill(record, alert)
                return (
                  <li key={alert.id}>
                    <h4>
                      {alert.wellId} · {alert.status}
                    </h4>
                    <p>{source ? readingLabel(source) : 'Source reading is missing.'}</p>
                    <MediaLink media={record.media.find(m => m.kind === 'camera_recording' || m.kind === 'prerecorded_source')} elapsedMs={alert.raisedAtElapsedMs} store={store} title="Alert evidence" />
                    {observed ? (
                      <p>
                        Observed filled at {observed.elapsedMs} ms ({observed.observationId}). The original alert remains in the history.
                      </p>
                    ) : (
                      <p>No later observation shows this well filled.</p>
                    )}
                    <p>{alert.resolvedObservationId ? `Resolved by camera observation ${alert.resolvedObservationId}.` : completionText(protocol, alert, observed != null)}</p>
                    {alert.status !== 'resolved' ? (
                      <div className="review-actions">
                        {alert.status === 'open' ? (
                          <button
                            type="button"
                            onClick={() => {
                              onAcknowledgeOmission(alert.id)
                              onAddHumanEvent({
                                kind: 'correction_note',
                                alertId: alert.id,
                                wellId: alert.wellId,
                                note: CORRECTION_TEXT,
                              })
                            }}
                          >
                            Yes, I skipped it.
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onResolveOmission(alert.id, CAMERA_MISSED_NOTE)}
                        >
                          I completed it; the camera missed it.
                        </button>
                        {alert.status === 'open' ? (
                          <button
                            type="button"
                            onClick={() =>
                              onAddHumanEvent({
                                kind: 'correction_note',
                                alertId: alert.id,
                                wellId: alert.wellId,
                                note: LEAVE_UNRESOLVED_NOTE,
                              })
                            }
                          >
                            Leave unresolved and continue.
                          </button>
                        ) : null}
                        {alert.status === 'acknowledged' ? (
                          <button
                            type="button"
                            onClick={() =>
                              onResolveOmission(alert.id, 'Filled the omitted well, then verified.')
                            }
                          >
                            Verify and resolve
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <h4>Not confirmed filled</h4>
        {unconfirmed.length === 0 ? (
          <p>Every required well has an observed filled reading.</p>
        ) : (
          <ul>
            {unconfirmed.map((well) => (
              <li key={well.wellId}>
                {well.wellId} is {well.state}. An empty or unknown well is not an omission alert by
                itself unless a later required well was filled.
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="review-block">
        <h3>Final image</h3>
        {!protocol.finalAssessment ? <p>No final plate assessment is stored.</p> : null}
        {protocol.finalAssessment ? (
          <ul className="fixture-list">
            {protocol.finalAssessment.wells.map((well) => {
              const corrections = protocol.humanEvents.filter(
                (event) =>
                  event.kind === 'correction_note' &&
                  event.wellId === well.wellId &&
                  event.note?.includes('final-image reading'),
              )
              return (
                <li key={well.wellId}>
                  <h4>{well.wellId}</h4>
                  <p>
                    Original detector result: {well.state}.{' '}
                    {well.matchesExpectedFilled
                      ? 'It matches the plan that the well ends filled.'
                      : 'It does not match the plan that the well ends filled.'}{' '}
                    This is occupancy, not an assay result.
                  </p>
                  {corrections.map((event) => (
                    <p key={event.id}>
                      Person reported {event.reportedState ?? 'a note'} at {event.elapsedMs} ms. The
                      original assessment is unchanged. {event.note}
                    </p>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      onAddHumanEvent({
                        kind: 'correction_note',
                        wellId: well.wellId,
                        reportedState: well.state === 'filled' ? 'empty' : 'filled',
                        note: `Person corrected the final-image reading for ${well.wellId}. The original detector result stays ${well.state}.`,
                      })
                    }
                  >
                    Record a different reading
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
        {protocol.finalAssessment?.mediaId ? (
          <MediaLink
            media={protocol.media.find((item) => item.mediaId === protocol.finalAssessment?.mediaId)}
            elapsedMs={protocol.finalAssessment.elapsedMs}
            store={store}
          />
        ) : null}
      </div>

      <div className="review-block">
        <h3>Evidence</h3>
        {protocol.media.length === 0 ? <p>No media metadata is stored for this run.</p> : null}
        <ul className="fixture-list">
          {protocol.media.map((media) => (
            <li key={media.mediaId}>
              <h4>{media.label}</h4>
              <p className="fixture-meta">
                {media.kind} · {media.available ? 'bytes stored' : 'bytes not stored'} · offset{' '}
                {media.runStartOffsetMs} ms
                {media.durationMs == null ? '' : ` · duration ${media.durationMs} ms`}
              </p>
            </li>
          ))}
        </ul>
        {protocol.humanEvents
          .filter((event) => event.evidence)
          .map((event) => (
            <MediaLink
              key={event.id}
              media={protocol.media.find((item) => item.mediaId === event.evidence?.mediaId)}
              elapsedMs={event.evidence?.elapsedMs ?? event.elapsedMs}
              store={store}
              title={event.note ?? event.kind}
            />
          ))}
      </div>
    </>
  )
}

function timelineRows(protocol: ProtocolState): { key: string; at: number; text: string }[] {
  const rows = [
    ...protocol.observations.map((observation) => ({
      key: observation.id,
      at: observation.elapsedMs,
      text: `Observation ${observation.id}. Camera readings stay as recorded.`,
    })),
    ...protocol.alerts.map((alert) => ({
      key: alert.id,
      at: alert.raisedAtElapsedMs,
      text: `Possible omission ${alert.wellId} (${alert.status}), from ${alert.sourceObservationId}.`,
    })),
    ...protocol.humanEvents.map((event) => ({
      key: event.id,
      at: event.elapsedMs,
      text: eventText(protocol, event),
    })),
  ]
  if (protocol.finalAssessment) {
    rows.push({
      key: protocol.finalAssessment.id,
      at: protocol.finalAssessment.elapsedMs,
      text: `Final plate assessment ${protocol.finalAssessment.id}.`,
    })
  }
  return rows.sort((left, right) => left.at - right.at || left.key.localeCompare(right.key))
}

function eventText(protocol: ProtocolState, event: HumanEvent): string {
  const reportedOnly = event.reportedState === 'filled' && event.wellId && protocol.wellStates[event.wellId] !== 'filled'
  if (event.kind === 'omission_acknowledged') {
    return `${event.note ?? 'Acknowledged'} This is a human response. The camera row is unchanged.`
  }
  if (event.kind === 'omission_resolved') {
    return reportedOnly
      ? `${event.note ?? 'Resolved'} User-reported completion only. The camera has not shown this well filled.`
      : `${event.note ?? 'Resolved'} Person resolved the alert. Camera history is unchanged.`
  }
  return `${event.note ?? 'Note'} Human note${event.reportedState ? `, reported ${event.reportedState}` : ''}.`
}

function completionText(protocol: ProtocolState, alert: OmissionAlert, observed: boolean): string {
  const reported = protocol.humanEvents.some(
    (event) => event.alertId === alert.id && event.reportedState === 'filled',
  )
  if (observed && reported) return 'Both an observed fill and a user-reported completion are on the record.'
  if (observed) return 'Completion is from a later camera observation.'
  if (reported) return 'Completion is user-reported only.'
  return 'No completion is recorded.'
}

function MediaLink(props: {
  media: MediaAvailability | undefined
  elapsedMs: number
  store: RunStore
  title?: string
}) {
  const { media, elapsedMs, store, title } = props
  const [playback, setPlayback] = useState<{ mediaId: string; url: string } | null>(null)
  const covered = media ? evidenceIsCovered(media, elapsedMs) : false
  const offset = media ? evidenceOffsetMs(media.runStartOffsetMs, elapsedMs) : null
  const url = covered && media && playback?.mediaId === media.mediaId ? playback.url : null

  useEffect(() => {
    if (!media || !covered) return undefined
    const mediaId = media.mediaId
    let objectUrl: string | null = null
    let cancelled = false
    void store.getBlob(mediaId).then((blob) => {
      if (!blob) return
      const nextUrl = URL.createObjectURL(blob)
      if (cancelled) {
        URL.revokeObjectURL(nextUrl)
        return
      }
      objectUrl = nextUrl
      setPlayback({ mediaId, url: nextUrl })
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [covered, media, store])

  if (!media || offset == null) {
    return <p>No media record for this reference. Playback is not linked.</p>
  }

  return (
    <div className="review-evidence">
      {title ? <p>{title}</p> : null}
      <p>
        {covered
          ? `Playback available. Run time ${elapsedMs} ms is file offset ${offset} ms.`
          : `Playback unavailable. Run time ${elapsedMs} ms is file offset ${offset} ms. The timestamp is kept.`}
      </p>
      {url && media.kind === 'final_plate_image' ? <img src={url} alt={media.label} /> : null}
      {url && media.kind !== 'final_plate_image' ? (
        <video
          src={url}
          controls
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = Math.max(0, offset) / 1000
          }}
        />
      ) : null}
    </div>
  )
}
