import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { expectedWellId } from '../shared/protocol.ts'
import { PROTOCOL_ORDER, WELL_GRID, type WellId, type WellState } from '../shared/types.ts'
import type { MonitorProps } from '../shared/types.ts'
import { type FrameEvidence, type LiveAlert, type LiveDecisionEntry } from '../monitor/liveDecisions.ts'
import { describeRetrieved, readMonitorSession } from '../monitor/saveSession.ts'
import { sourceLabel } from '../results/sessionBrowse.ts'
import type { PreparedMonitorProtocol } from '../prepare/sixWell.ts'
import { formatRgb, rgbToCss, COLOR_PRESETS, type ColorPresetId } from '../vision/color.ts'
import { normalizedToContent, type WellRegions } from '../vision/geometry.ts'
import { SYNTHETIC_SEQUENCES } from '../vision/synthetic.ts'
import { useVisionSession, type VisionSession } from '../vision/useVisionSession.ts'
import type { WellMeasurement } from '../vision/analyze.ts'
import type { PixelRect } from '../vision/geometry.ts'
import './Monitor.css'

const STATE_LABEL: Record<WellState, string> = {
  empty: 'Empty',
  filled: 'Filled',
  unknown: 'Unknown',
}

export function Monitor(props: MonitorProps & { preparedProtocol?: PreparedMonitorProtocol | null }) {
  const { protocol, preparedProtocol = null } = props
  const session = useVisionSession(props, preparedProtocol)
  const [wellSize, setWellSize] = useState(0.2)
  const [humanNote, setHumanNote] = useState('')
  const [reportedState, setReportedState] = useState<WellState>('filled')
  const [correctionFor, setCorrectionFor] = useState<string | null>(null)
  const [correctionHidden, setCorrectionHidden] = useState(false)
  const storedObservations = protocol.observations.length
  const lastTrace = session.traces.at(-1)
  const expected = expectedWellId(PROTOCOL_ORDER, session.stableStates)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const unresolved = session.live.alerts.filter((alert) => alert.status !== 'corrected')
  const priority =
    [...unresolved].sort((left, right) => {
      if (left.status !== right.status) return left.status === 'open' ? -1 : 1
      return left.protocolIndex - right.protocolIndex
    })[0] ?? null
  const selected = session.live.alerts.find((alert) => alert.id === chosenId) ?? priority
  const otherAlerts = unresolved.filter((alert) => alert.id !== selected?.id)
  const guide = guideCopy(session, expected, selected)
  const issueActive = selected != null && selected.status !== 'corrected'
  const highlightedWell = issueActive ? selected.wellId : expected
  const demoEnded = session.inputKind === 'synthetic' && session.playbackNote.includes('ended')
  const showSummary = demoEnded && !session.summaryHeld
  const running = session.localPhase === 'running'
  const pictureReady = session.cameraPhase === 'live' || session.inputKind === 'prerecorded'
  const [setupStep, setSetupStep] = useState<SetupStep>('camera')
  const [runningSeen, setRunningSeen] = useState(running)
  const [setupOpen, setSetupOpen] = useState(true)
  if (!pictureReady && setupStep !== 'camera') setSetupStep('camera')
  if (running !== runningSeen) {
    setRunningSeen(running)
    setSetupOpen(!running)
  }

  if (session.correctionNote !== correctionFor) {
    setCorrectionFor(session.correctionNote)
    setCorrectionHidden(false)
  }

  useEffect(() => {
    if (!session.correctionNote) return
    const timer = window.setTimeout(() => setCorrectionHidden(true), 3200)
    return () => window.clearTimeout(timer)
  }, [session.correctionNote])

  function startSkipDemo(): void {
    session.useSynthetic('skip-a2-then-fill')
    session.startRun()
  }

  return (
    <section className="monitor" aria-labelledby="monitor-title" data-debug={session.debugOverlay ? 'true' : 'false'} data-running={running ? 'true' : 'false'}>
      <div className="monitor-heading">
        <h2 id="monitor-title">Monitor</h2>
        <p>Six-well colored-water procedure. Fixed order A1, A2, A3, B1, B2, B3.</p>
        {preparedProtocol ? (
          <div>
            <p>
              Approved protocol: {preparedProtocol.title}, version {preparedProtocol.version}. The camera has not been started.
            </p>
            <details>
              <summary>Instructions for this session</summary>
              <ol>
                {preparedProtocol.steps.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ol>
            </details>
          </div>
        ) : null}
      </div>

      <div className="live-split">
        <div className="live-stage">
          <div className="stage" ref={session.bindStage} onPointerDown={session.onStagePointerDown}>
            {session.inputKind === 'synthetic' ? (
              <p className="synthetic-flag" role="status">
                Synthetic demonstration
              </p>
            ) : null}
        <video
          ref={session.bindVideo}
          className="stage-media"
          data-active={session.inputKind === 'live' || session.inputKind === 'prerecorded'}
          playsInline
          muted
          controls={session.inputKind === 'prerecorded'}
        />
        <canvas
          ref={session.bindCanvas}
          className="stage-media"
          data-active={session.inputKind === 'synthetic'}
        />
        {session.inputKind === 'none' ? (
          <p className="stage-placeholder">Start the camera. The picture stays on this computer.</p>
        ) : null}
        <RegionLayer
          regions={session.regions}
          content={session.contentRect}
          stable={session.stableStates}
          measurements={session.measurements}
          selectedWell={highlightedWell}
          attention={issueActive}
          debug={session.debugOverlay}
          editable
          onKey={(wellId, dx, dy) => session.nudge('video', wellId, dx, dy)}
          onDragStart={(wellId, event) => session.beginDrag('video', wellId, event)}
          onDrag={(event) => session.moveDrag('video', event)}
          onDragEnd={session.endDrag}
        />
          </div>
          <p className="live-clock" role="status">
            {session.inputKind === 'none' ? '' : `${sourceLabel(session.inputKind)} · `}
            {session.observationStatus} · {formatSeconds(session.localElapsedMs)}
            {session.cameraPhase === 'live' || session.cameraPhase === 'starting' ? (
              <button type="button" onClick={session.stopCamera}>Stop camera</button>
            ) : null}
            {running ? (
              <button type="button" onClick={session.completeRun}>Stop monitoring</button>
            ) : null}
          </p>
          {session.seekMessage ? (
            <p className="attention-note" role="alert">
              {session.seekMessage}
            </p>
          ) : null}
          {cameraFailed(session) ? (
            <p className="attention-note" role="alert">
              {session.cameraMessage}
            </p>
          ) : null}
        </div>

        <aside className="live-decisions" aria-label="Protocol decisions">
          <ol className="well-progress" aria-label="Six-well progress">
            {PROTOCOL_ORDER.map((wellId) => (
              <li
                key={wellId}
                data-state={session.stableStates[wellId]}
                data-current={highlightedWell === wellId ? 'true' : 'false'}
                data-issue={issueActive && selected?.wellId === wellId ? 'true' : 'false'}
              >
                {wellId}
              </li>
            ))}
          </ol>
          <section className="guide" data-attention={issueActive ? 'true' : 'false'} aria-live="polite">
            <p className="save-status" data-save-status={session.saveStatus.phase}>
              {session.saveStatus.detail}
            </p>
            {session.inputKind === 'synthetic' ? (
              showSummary ? (
                <DemoSummary session={session} />
              ) : session.demoPaused ? (
                <>
                  <p className="demo-paused">Demo paused</p>
                  <h3>Issue</h3>
                  <p className="guide-line">{guide.issue}</p>
                  <h3>Next</h3>
                  <p className="guide-line">{guide.next ?? (selected ? `Check ${selected.wellId}.` : 'Check the highlighted well.')}</p>
                  <button type="button" className="demo-start" onClick={session.continueDemo}>
                    Continue demo
                  </button>
                </>
              ) : session.summaryHeld ? (
                <>
                  <h3>Observed correction</h3>
                  <p className="correction-line">{session.correctionNote}</p>
                </>
              ) : (
                <DecisionGuide guide={guide} issueActive={issueActive} correctionNote={correctionHidden ? null : session.correctionNote} />
              )
            ) : session.localPhase === 'idle' ? (
              <>
                <h3>Now</h3>
                <p className="guide-line">{setupPrompt(setupStep, pictureReady)}</p>
              </>
            ) : (
              <DecisionGuide guide={guide} issueActive={issueActive} correctionNote={correctionHidden ? null : session.correctionNote} />
            )}
            {selected && selected.status !== 'corrected' ? (
              <>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() =>
                      session.acknowledgeOmission(selected.id, humanNote || 'Acknowledged by a person.')
                    }
                    disabled={selected.status !== 'open'}
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      session.reportMissedObservation(
                        selected.id,
                        humanNote || 'Missed observation reported by a person.',
                        reportedState,
                      )
                    }
                  >
                    Report what you saw
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      session.continueAfterCorrection(selected.id, humanNote || 'Continue after a correction.')
                    }
                  >
                    Continue after a correction
                  </button>
                </div>
                <p className="monitor-note">Acknowledging records that you saw this. It does not correct it.</p>
                <label className="file-field">
                  Note
                  <input value={humanNote} onChange={(event) => setHumanNote(event.target.value)} />
                </label>
                <label className="file-field">
                  Reported state
                  <select
                    value={reportedState}
                    onChange={(event) => setReportedState(event.target.value as WellState)}
                  >
                    <option value="filled">Filled</option>
                    <option value="empty">Empty</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
              </>
            ) : null}
            {otherAlerts.length > 0 ? (
              <details className="other-alerts">
                <summary>
                  {otherAlerts.length} other alert{otherAlerts.length === 1 ? '' : 's'}
                </summary>
                <ul className="decision-list">
                  {otherAlerts.map((alert) => (
                    <li key={alert.id}>
                      <button type="button" onClick={() => setChosenId(alert.id)}>
                        {alert.wellId}
                        {alert.status === 'acknowledged' ? ' · acknowledged' : ' · appears empty'}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {chosenId && priority && chosenId !== priority.id ? (
              <button type="button" onClick={() => setChosenId(null)}>
                Show {priority.wellId}
              </button>
            ) : null}
            {selected ? (
              <details className="fold">
                <summary>Alert record</summary>
                <AlertRecord alert={selected} />
              </details>
            ) : null}
          </section>
        </aside>
      </div>

      <details
        className="fold"
        open={setupOpen}
        onToggle={(event) => setSetupOpen(event.currentTarget.open)}
      >
        <summary>Setup</summary>
        <CameraSetup
          session={session}
          wellSize={wellSize}
          setWellSize={setWellSize}
          step={setupStep}
          setStep={setSetupStep}
          pictureReady={pictureReady}
        />
        <details className="fold">
          <summary>Demo and imported video</summary>
        <p className="monitor-note">Optional. A synthetic sequence is not a camera recording. Pause on an issue applies only there.</p>
        <button type="button" onClick={startSkipDemo}>
          {session.inputKind === 'synthetic' && session.monitorGeneration > 0 ? 'Replay demo' : 'Play skip-then-fill demo'}
        </button>
        <label className="file-field">
          Synthetic speed
          <select
            value={session.syntheticPace}
            onChange={(event) => session.setSyntheticPace(Number(event.target.value) as 1 | 2 | 4)}
          >
            <option value={4}>Slow</option>
            <option value={2}>Medium</option>
            <option value={1}>Original</option>
          </select>
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={session.pauseOnIssue}
            onChange={(event) => session.setPauseOnIssue(event.target.checked)}
          />
          Pause demo when an issue appears
        </label>
        <div className="button-row" role="group" aria-label="Synthetic sequences">
          {SYNTHETIC_SEQUENCES.map((sequence) => (
            <button
              key={sequence.id}
              type="button"
              aria-pressed={session.syntheticId === sequence.id}
              onClick={() => session.useSynthetic(sequence.id)}
            >
              {sequence.title}
            </button>
          ))}
        </div>
        <label className="file-field">
          Imported video
          <input
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) session.useVideoFile(file)
              event.target.value = ''
            }}
          />
        </label>
        <button type="button" onClick={session.togglePlayback} disabled={session.inputKind !== 'prerecorded'}>
          Play or pause video
        </button>
        <p className="input-banner" data-kind={session.inputKind} role="status">
          {session.inputLabel}
        </p>
        <div className="button-row">
          <button
            type="button"
            aria-pressed={session.observationPaused}
            onClick={() => session.setObservationPaused(!session.observationPaused)}
          >
            {session.observationPaused ? 'Resume observations' : 'Pause observations'}
          </button>
          <button
            type="button"
            aria-pressed={session.debugOverlay}
            onClick={() => session.setDebugOverlay(!session.debugOverlay)}
          >
            {session.debugOverlay ? 'Hide debug measurements' : 'Show debug measurements'}
          </button>
        </div>
        </details>
      </details>

      <details className="fold">
        <summary>Measurements</summary>
        <dl className="monitor-status">
          <div>
            <dt>Observation</dt>
            <dd>{session.observationStatus}</dd>
          </div>
          <div>
            <dt>Vision clock</dt>
            <dd>{session.localElapsedMs} ms</dd>
          </div>
          <div>
            <dt>Last observation</dt>
            <dd>{lastTrace ? `${lastTrace.draft.elapsedMs} ms` : 'None yet'}</dd>
          </div>
          <div>
            <dt>Frame analysis</dt>
            <dd>
              {session.measurements.length === 0
                ? 'No frame timed yet'
                : `${session.lastProcessingMs.toFixed(1)} ms`}
            </dd>
          </div>
          <div>
            <dt>Sample interval</dt>
            <dd>about {session.sampleMs} ms</dd>
          </div>
          <div>
            <dt>Recording</dt>
            <dd>{session.recording.phase}</dd>
          </div>
        </dl>
        <p className="monitor-note">{session.cameraMessage}</p>
        {session.playbackNote ? <p className="monitor-note">{session.playbackNote}</p> : null}
        <p className="monitor-note">{session.recording.detail}</p>
        <p className="monitor-note">{session.evidenceNote}</p>
        <p className="monitor-note">
          Session {session.live.sessionId} · {session.live.sourceKind} · generation {session.monitorGeneration}
        </p>
        {session.localPhase === 'running' && protocol.phase === 'idle' ? (
          <p className="monitor-note">Review has not stored this run yet.</p>
        ) : null}
      </details>

      <details className="fold">
        <summary>Observation history ({session.traces.length + session.live.timeline.filter((entry) => entry.source === 'human').length})</summary>
        <p className="monitor-note">
          Camera rows are stable readings. Human rows are reports. Review has stored {storedObservations}.
        </p>
        <HistoryList session={session} />
      </details>

      <details className="fold">
        <summary>Decisions ({session.live.timeline.length})</summary>
        {session.live.timeline.length === 0 ? (
          <p className="monitor-note">None yet.</p>
        ) : (
          <ol className="decision-list">
            {session.live.timeline.map((entry) => (
              <DecisionRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </details>

      <StoredSession sessionId={session.live.sessionId} phase={session.saveStatus.phase} />

      <details className="fold debug-panel">
        <summary>Raw versus stabilized observations</summary>
        <p>
          Raw is the latest classifier output. Stabilized is the reading committed after repeated frames.
          A high mix score forces unknown. It does not detect a hand, pipette, or other obstruction.
        </p>
        {session.traces.length === 0 ? (
          <p>No stable observation yet.</p>
        ) : (
          <ul className="plain-list">
            {session.traces.map((trace) => (
              <li key={`${trace.generation}-${trace.draft.elapsedMs}`}>
                {trace.draft.elapsedMs} ms, analysis {trace.processingMs.toFixed(1)} ms —{' '}
                {trace.draft.wells
                  .map((well) => {
                    const raw = trace.rawWells.find((item) => item.wellId === well.wellId)?.state
                    return `${well.wellId} raw ${raw ?? 'unknown'} / stable ${well.state}`
                  })
                  .join('; ')}
              </li>
            ))}
          </ul>
        )}
        {session.debugOverlay ? (
          <ul className="plain-list">
            {session.measurements.length === 0 ? (
              <li>No frame measured yet.</li>
            ) : (
              session.measurements.map((item) => (
                <li key={item.wellId}>
                  Latest {item.wellId}: raw {item.state}, stable {session.stableStates[item.wellId]}, score{' '}
                  {item.fillScore.toFixed(2)}, empty distance{' '}
                  {item.emptyDistance == null ? 'none' : item.emptyDistance.toFixed(2)}, mix{' '}
                  {item.mixScore.toFixed(2)}, RGB {formatRgb(item.mean)}
                </li>
              ))
            )}
          </ul>
        ) : (
          <p className="monitor-note">Turn on debug measurements to see scores for the current frame.</p>
        )}
      </details>

      <details className="fold">
        <summary>Final image</summary>
        <fieldset>
        <legend>Final image</legend>
        <p className="monitor-note">
          A still has no internal clock. Its run time is the completion time. Agreement means the well looks
          filled, not an assay result.
        </p>
        <div className="button-row">
          <button type="button" onClick={session.captureFinalFromVideo} disabled={session.inputKind === 'none'}>
            Capture current frame
          </button>
          <label className="file-field">
            Upload final image
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) session.useFinalFile(file)
                event.target.value = ''
              }}
            />
          </label>
          <button type="button" aria-pressed={session.finalSeparate} onClick={() => session.setFinalSeparate(!session.finalSeparate)} disabled={!session.finalUrl}>
            {session.finalSeparate ? 'Using separate photo registration' : 'Use video registration'}
          </button>
          <button type="button" onClick={session.captureFinalReference} disabled={!session.finalUrl || !session.finalSeparate}>
            Capture empty reference on this photo
          </button>
          <button type="button" onClick={session.assessFinal} disabled={!session.finalUrl}>
            Assess final image
          </button>
        </div>
        <p className="monitor-note">{session.finalReferenceLabel}</p>
        <p className="monitor-note" role="status">
          {session.finalMessage}
        </p>
        {session.finalUrl ? (
          <div className="stage final-stage" ref={session.bindFinalStage}>
            <img src={session.finalUrl} alt="Final plate" className="stage-media" data-active="true" />
            <RegionLayer
              regions={session.finalSeparate ? session.finalRegions : session.regions}
              content={session.finalContentRect}
              stable={statesFromAssessment(session)}
              measurements={session.finalMeasurements}
              selectedWell={null}
              attention={false}
              debug={session.debugOverlay}
              editable={session.finalSeparate}
              onKey={(wellId, dx, dy) => session.nudge('final', wellId, dx, dy)}
              onDragStart={(wellId, event) => session.beginDrag('final', wellId, event)}
              onDrag={(event) => session.moveDrag('final', event)}
              onDragEnd={session.endDrag}
            />
          </div>
        ) : null}
        {session.assessment ? (
          <ul className="plain-list">
            {session.assessment.wells.map((well) => (
              <li key={well.wellId}>
                {well.wellId}: {STATE_LABEL[well.state]}.{' '}
                {well.matchesExpectedFilled ? 'Matches the filled plan.' : 'Does not match the filled plan.'}
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>
      </details>
    </section>
  )
}

function statesFromAssessment(session: VisionSession): Record<WellId, WellState> {
  if (!session.assessment) {
    return {
      A1: 'unknown',
      A2: 'unknown',
      A3: 'unknown',
      B1: 'unknown',
      B2: 'unknown',
      B3: 'unknown',
    }
  }
  const states = {} as Record<WellId, WellState>
  for (const well of session.assessment.wells) states[well.wellId] = well.state
  return states
}

function EvidenceFigure(props: { evidence: FrameEvidence }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const index =
    props.evidence.frameIndex == null ? '' : ` Frame index ${props.evidence.frameIndex}.`
  const caption = `${props.evidence.elapsedMs} ms · ${props.evidence.label}.${index}`
  return (
    <figure className="evidence-figure">
      {props.evidence.frameDataUrl ? (
        <>
          <button
            type="button"
            className="evidence-open"
            onClick={() => dialogRef.current?.showModal()}
          >
            <img src={props.evidence.frameDataUrl} alt="" />
            Open supporting frame
          </button>
          <dialog
            ref={dialogRef}
            className="evidence-dialog"
            aria-label={`Supporting frame at ${props.evidence.elapsedMs} ms`}
            onClick={(event) => {
              if (event.target === dialogRef.current) dialogRef.current?.close()
            }}
          >
            <img
              src={props.evidence.frameDataUrl}
              alt={`Supporting frame at ${props.evidence.elapsedMs} ms`}
            />
            <p>{caption}</p>
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Close
            </button>
          </dialog>
        </>
      ) : (
        <p>No still was stored for this decision.</p>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function AlertRecord(props: { alert: LiveAlert }) {
  const { alert } = props
  return (
    <dl className="decision-facts">
      <div>
        <dt>Observed</dt>
        <dd>{alert.observedState}</dd>
      </div>
      <div>
        <dt>Rule</dt>
        <dd>{alert.rule}</dd>
      </div>
      <div>
        <dt>Source time</dt>
        <dd>{formatSeconds(alert.raisedAtElapsedMs)}</dd>
      </div>
      {alert.rawState ? (
        <div>
          <dt>Raw reading</dt>
          <dd>{alert.rawState}</dd>
        </div>
      ) : null}
      <EvidenceFigure evidence={alert.evidence} />
      {alert.correction ? (
        <div>
          <dt>Later fill</dt>
          <dd>{formatSeconds(alert.correction.elapsedMs)}. The original alert remains.</dd>
          <EvidenceFigure evidence={alert.correction.evidence} />
        </div>
      ) : null}
    </dl>
  )
}

function DecisionRow(props: { entry: LiveDecisionEntry }) {
  const { entry } = props
  return (
    <li className="decision-entry" data-source={entry.source} data-kind={entry.kind}>
      <p>
        {formatSeconds(entry.sourceElapsedMs)} · {decisionLabel(entry)}
      </p>
      <details>
        <summary>Details</summary>
        <dl className="decision-facts">
          <div>
            <dt>Observed</dt>
            <dd>{entry.observedState}</dd>
          </div>
          <div>
            <dt>Rule</dt>
            <dd>{entry.rule}</dd>
          </div>
          {entry.note ? (
            <div>
              <dt>Note</dt>
              <dd>{entry.note}</dd>
            </div>
          ) : null}
          {entry.reportedState ? (
            <div>
              <dt>Reported</dt>
              <dd>{entry.reportedState}</dd>
            </div>
          ) : null}
        </dl>
        <EvidenceFigure evidence={entry.evidence} />
      </details>
    </li>
  )
}

function HistoryList(props: { session: VisionSession }) {
  const camera = props.session.traces.map((trace) => ({
    key: `camera-${trace.generation}-${trace.draft.elapsedMs}`,
    at: trace.draft.elapsedMs,
    source: 'Camera' as const,
    detail: trace.draft.wells.map((well) => `${well.wellId} ${well.state}`).join(', '),
  }))
  const human = props.session.live.timeline
    .filter((entry) => entry.source === 'human')
    .map((entry) => ({
      key: entry.id,
      at: entry.sourceElapsedMs,
      source: 'Human' as const,
      detail: `${entry.kind}${entry.note ? `: ${entry.note}` : ''}`,
    }))
  const rows = [...camera, ...human].sort((a, b) => a.at - b.at || a.source.localeCompare(b.source))
  if (rows.length === 0) return <p className="monitor-note">No observation in this monitoring session.</p>
  return (
    <ol className="history-list">
      {rows.map((row) => (
        <li key={row.key} data-source={row.source === 'Human' ? 'human' : 'camera'} data-unknown={row.detail.includes('unknown') ? 'true' : 'false'}>
          <span className="state-badge" data-tone={row.source === 'Human' ? 'human' : row.detail.includes('unknown') ? 'unknown' : 'camera'}>
            {row.source}
          </span>
          <span>
            {row.at} ms — {row.detail}
          </span>
        </li>
      ))}
    </ol>
  )
}

function RegionLayer(props: {
  regions: WellRegions
  content: PixelRect | null
  stable: Record<WellId, WellState>
  measurements: WellMeasurement[]
  selectedWell: WellId | null
  attention: boolean
  debug: boolean
  editable: boolean
  onKey: (wellId: WellId, dx: number, dy: number) => void
  onDragStart: (wellId: WellId, event: ReactPointerEvent<HTMLButtonElement>) => void
  onDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  if (!props.content) return null
  return (
    <div className="region-layer">
      {WELL_GRID.flat().map((wellId) => {
        const box = normalizedToContent(props.regions[wellId], props.content!)
        const measurement = props.measurements.find((item) => item.wellId === wellId)
        const stable = props.stable[wellId]
        const selected = props.selectedWell === wellId
        const attention = selected && props.attention
        const detail = measurement
          ? `${wellId}, stable ${stable}, raw ${measurement.state}, heuristic score ${measurement.fillScore.toFixed(2)}${attention ? ', needs attention' : ''}`
          : `${wellId}, stable ${stable}${attention ? ', needs attention' : ''}`
        return (
          <button
            key={wellId}
            type="button"
            className="region"
            data-state={stable}
            data-selected={selected ? 'true' : 'false'}
            data-attention={attention ? 'true' : 'false'}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            aria-label={`${detail}. ${props.editable ? 'Drag to move, or use arrow keys.' : 'Registration follows the video.'}`}
            onPointerDown={(event) => props.onDragStart(wellId, event)}
            onPointerMove={props.onDrag}
            onPointerUp={props.onDragEnd}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.02 : 0.01
              const move = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              }[event.key]
              if (!move) return
              event.preventDefault()
              props.onKey(wellId, move[0], move[1])
            }}
          >
            <span className="region-id">{wellId}</span>
            <span className="region-state">{STATE_LABEL[stable]}</span>
            {attention ? <span className="region-flag">Check</span> : null}
            {props.debug && measurement ? <span>{measurement.fillScore.toFixed(2)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

function cameraFailed(session: VisionSession): boolean {
  return session.cameraPhase === 'denied' || session.cameraPhase === 'missing' || session.cameraPhase === 'failed'
}

function DecisionGuide({
  guide,
  issueActive,
  correctionNote,
}: {
  guide: ReturnType<typeof guideCopy>
  issueActive: boolean
  correctionNote: string | null
}) {
  return (
    <>
      <h3>Now</h3>
      <p className="guide-line">{guide.action}</p>
      {correctionNote ? <p className="correction-line">{correctionNote}</p> : null}
      {issueActive ? (
        <>
          <h3>Issue</h3>
          <p className="guide-line">{guide.issue}</p>
        </>
      ) : null}
      {guide.next ? (
        <>
          <h3>Next</h3>
          <p className="guide-line">{guide.next}</p>
        </>
      ) : null}
    </>
  )
}

type SetupStep = 'camera' | 'position' | 'calibrate' | 'preview' | 'monitor'

const SETUP_STEPS: { id: SetupStep; label: string }[] = [
  { id: 'camera', label: 'Start camera' },
  { id: 'position', label: 'Position regions' },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'preview', label: 'Preview' },
  { id: 'monitor', label: 'Start monitoring' },
]

function setupPrompt(step: SetupStep, pictureReady: boolean): string {
  if (!pictureReady) return 'Start the camera.'
  if (step === 'position') return 'Position the six regions.'
  if (step === 'calibrate') return 'Calibrate the empty plate and dye color.'
  if (step === 'preview') return 'Check the preview.'
  if (step === 'monitor') return 'Start monitoring when the preview looks usable.'
  return 'Camera is on. Continue to the regions.'
}

function CameraSetup({
  session,
  wellSize,
  setWellSize,
  step,
  setStep,
  pictureReady,
}: {
  session: VisionSession
  wellSize: number
  setWellSize: (size: number) => void
  step: SetupStep
  setStep: (step: SetupStep) => void
  pictureReady: boolean
}) {
  const starting = session.cameraPhase === 'starting' || session.cameraPhase === 'live'
  const calibrationMissing = session.referenceLabel.startsWith('Not captured')
  const previewUnknown = session.measurements.length === 0 || session.measurements.every((item) => item.state === 'unknown')
  return (
    <div className="camera-setup">
      <div className="button-row" role="group" aria-label="Setup steps">
        {SETUP_STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={step === item.id}
            disabled={item.id !== 'camera' && !pictureReady}
            onClick={() => setStep(item.id)}
          >
            {index + 1}. {item.label}
          </button>
        ))}
      </div>
      {session.cameraPhase === 'live' ? (
        <button type="button" onClick={session.stopCamera}>Stop camera</button>
      ) : null}
      {step === 'camera' ? (
        <>
          <button type="button" className="primary-action" onClick={session.startCamera} disabled={starting}>
            Start camera
          </button>
          <p className="monitor-note" role={cameraFailed(session) ? 'alert' : 'status'}>
            {session.inputKind === 'prerecorded' ? session.inputLabel : session.cameraMessage}
            {session.cameraPhase === 'live' ? ' The camera is open. That is not a calibrated reading.' : ''}
          </p>
          {pictureReady ? (
            <button type="button" onClick={() => setStep('position')}>Position regions</button>
          ) : null}
        </>
      ) : null}
      {step === 'position' ? (
        <>
          <p className="monitor-note">Drag A1, A2, A3, B1, B2, and B3 onto the six containers. Arrow keys nudge the focused label. Shift moves farther.</p>
          <label className="file-field">
            Well size
            <input
              type="range"
              min={0.08}
              max={0.32}
              step={0.01}
              value={wellSize}
              onChange={(event) => {
                const size = Number(event.target.value)
                setWellSize(size)
                session.setWellSize(size)
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setWellSize(0.2)
              session.resetRegions()
            }}
          >
            Reset positions
          </button>
          <button type="button" onClick={() => setStep('calibrate')}>Calibrate</button>
        </>
      ) : null}
      {step === 'calibrate' ? (
        <>
          <div className="button-row">
            <button type="button" onClick={session.captureReference}>Capture empty reference</button>
            <button
              type="button"
              aria-pressed={session.samplingColor}
              onClick={() => session.setSamplingColor(!session.samplingColor)}
            >
              {session.samplingColor ? 'Click the picture to sample' : 'Sample dye color'}
            </button>
          </div>
          <p className="monitor-note">{session.referenceLabel}</p>
          {calibrationMissing ? (
            <p className="attention-note" role="status">Calibration is missing. Capture an empty reference or sample the dye color. An open camera is not a ready reading.</p>
          ) : null}
          <div className="color-row">
            <span className="swatch" style={{ background: rgbToCss(session.expectedColor) }} />
            <span>Dye: {session.expectedLabel} ({formatRgb(session.expectedColor)})</span>
          </div>
          <div className="button-row" role="group" aria-label="Expected dye color">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={session.expectedLabel === preset.label}
                onClick={() => session.selectPreset(preset.id as ColorPresetId)}
              >
                <span className="swatch" style={{ background: rgbToCss(preset.rgb) }} />
                {preset.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setStep('preview')}>Preview</button>
        </>
      ) : null}
      {step === 'preview' ? (
        <>
          {session.measurements.length === 0 ? (
            <p className="monitor-note">The latest frame has not been read yet.</p>
          ) : (
            <ul className="preview-readings" aria-label="Preview readings">
              {PROTOCOL_ORDER.map((wellId) => {
                const state = session.measurements.find((item) => item.wellId === wellId)?.state ?? 'unknown'
                return (
                  <li key={wellId} data-state={state}>{wellId} {STATE_LABEL[state]}</li>
                )
              })}
            </ul>
          )}
          {previewUnknown ? (
            <p className="attention-note" role="status">The preview is still unknown. Recheck the regions, the empty reference, and the dye color. Unknown is not a filled or empty reading.</p>
          ) : (
            <p className="monitor-note">This preview is the latest frame. Monitoring uses the stable reading.</p>
          )}
          <button type="button" onClick={() => setStep('monitor')}>Start monitoring</button>
        </>
      ) : null}
      {step === 'monitor' ? (
        <>
          {calibrationMissing || previewUnknown ? (
            <p className="attention-note" role="status">
              {calibrationMissing
                ? 'Calibration is missing, so a started run can stay unknown.'
                : 'The preview is still unknown, so a started run can stay unknown.'}
            </p>
          ) : null}
          <button type="button" className="primary-action" onClick={session.startRun} disabled={!session.canStartRun}>
            Start monitoring
          </button>
        </>
      ) : null}
    </div>
  )
}

function formatSeconds(elapsedMs: number): string {
  const seconds = elapsedMs / 1000
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
}

function laterFilled(wellId: WellId, states: Record<WellId, WellState>): WellId | null {
  const index = PROTOCOL_ORDER.indexOf(wellId)
  return PROTOCOL_ORDER.slice(index + 1).find((id) => states[id] === 'filled') ?? null
}

function guideCopy(session: VisionSession, expected: WellId | null, selected: LiveAlert | null) {
  const action = session.live.blockedReason
    ? 'Start a new run.'
    : session.localPhase !== 'running'
      ? 'Start the run.'
      : expected
        ? `Fill ${expected}.`
        : 'All six locations appear filled.'
  const openIssue = selected != null && selected.status !== 'corrected'
  const issue =
    selected?.status === 'acknowledged'
      ? `${selected.wellId} appears empty. Acknowledged, not corrected.`
      : openIssue && selected
        ? `${selected.wellId} appears empty.`
        : ''
  const later = selected ? laterFilled(selected.wellId, session.stableStates) : null
  const explanation = !openIssue ? '' : later ? `${later} appears filled.` : 'A later location appears filled.'
  const next =
    selected?.status === 'open'
      ? `Check ${selected.wellId}.`
      : selected?.status === 'acknowledged'
        ? `Fill ${selected.wellId}.`
        : null
  return { action, issue, explanation, next: next === action ? null : next }
}

function decisionLabel(entry: LiveDecisionEntry): string {
  if (entry.kind === 'omission_acknowledged') return `${entry.wellId} acknowledged`
  if (entry.kind === 'correction_note') return `${entry.wellId} reported by a person`
  if (entry.kind === 'omission_resolved') return `${entry.wellId} continued`
  if (entry.kind === 'correction') return `${entry.wellId} appears filled`
  return `${entry.wellId} appears empty`
}

function DemoSummary({ session }: { session: VisionSession }) {
  const detected = session.live.alerts.length
  const corrected = session.live.alerts.filter((alert) => alert.correction).length
  const unresolved = session.live.alerts.filter((alert) => alert.status !== 'corrected').length
  const humanReports = session.live.timeline.filter((entry) => entry.source === 'human').length
  return (
    <div className="demo-summary">
      <h3>Summary</h3>
      <p>Issues detected: {detected}.</p>
      <p>Corrected by a later observation: {corrected}.</p>
      <p>Unresolved: {unresolved}.</p>
      <p>Human reports: {humanReports}. A report is not an observed correction.</p>
    </div>
  )
}

function StoredSession({ sessionId, phase }: { sessionId: string; phase: string }) {
  const [text, setText] = useState('No saved session has been retrieved.')
  const [copyNote, setCopyNote] = useState('')
  useEffect(() => {
    const id = sessionStorage.getItem('reprolab-monitor-session-id')
    if (!id) return
    let cancel = false
    void readMonitorSession(id).then((session) => {
      if (cancel) return
      setText(session ? describeRetrieved(session) : 'This session was not retrieved. It is not shown as stored.')
    })
    return () => {
      cancel = true
    }
  }, [sessionId, phase])
  async function copySessionId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(sessionId)
      setCopyNote('Session ID copied.')
    } catch {
      setCopyNote('Copy failed. Select the ID and copy it manually.')
    }
  }
  return (
    <details className="fold">
      <summary>Storage</summary>
      <p className="monitor-note">Session ID</p>
      <p className="session-id">{sessionId}</p>
      <button type="button" onClick={() => void copySessionId()}>
        Copy session ID
      </button>
      {copyNote ? <p className="monitor-note">{copyNote}</p> : null}
      <p className="monitor-note" data-retrieved-session>
        {text}
      </p>
    </details>
  )
}
