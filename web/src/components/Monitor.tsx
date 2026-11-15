import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { expectedWellId } from '../shared/protocol.ts'
import { PROTOCOL_ORDER, WELL_GRID, type WellId, type WellState } from '../shared/types.ts'
import type { MonitorProps } from '../shared/types.ts'
import { type FrameEvidence, type LiveAlert, type LiveDecisionEntry } from '../monitor/liveDecisions.ts'
import { describeRetrieved, readMonitorSession } from '../monitor/saveSession.ts'
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

export function Monitor(props: MonitorProps) {
  const { protocol } = props
  const session = useVisionSession(props)
  const [wellSize, setWellSize] = useState(0.2)
  const [humanNote, setHumanNote] = useState('')
  const [reportedState, setReportedState] = useState<WellState>('filled')
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

  function startSkipDemo(): void {
    session.useSynthetic('skip-a2-then-fill')
    session.startRun()
  }

  return (
    <section className="monitor" aria-labelledby="monitor-title" data-debug={session.debugOverlay ? 'true' : 'false'}>
      <div className="monitor-heading">
        <h2 id="monitor-title">Monitor</h2>
        <p>Fixed order A1, A2, A3, B1, B2, B3. A prepared protocol does not run here.</p>
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
          <p className="stage-placeholder">No picture yet.</p>
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
            {session.observationStatus} · {formatSeconds(session.localElapsedMs)}
          </p>
          {session.seekMessage ? (
            <p className="attention-note" role="alert">
              {session.seekMessage}
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
            {demoEnded ? (
              <DemoSummary session={session} />
            ) : (
              <>
                <h3>Now</h3>
                <p className="guide-line">{guide.action}</p>
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
            )}
            <button type="button" className="demo-start" onClick={startSkipDemo}>
              {session.monitorGeneration > 0 ? 'Replay demo' : 'Start demo'}
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

      <details className="fold">
        <summary>Setup</summary>
        <p className="input-banner" data-kind={session.inputKind} role="status">
          {session.inputLabel}
        </p>
        <div className="button-row">
          <button type="button" onClick={session.startCamera} disabled={session.cameraPhase === 'starting' || session.cameraPhase === 'live'}>
            Start Camera
          </button>
          <button type="button" onClick={session.stopCamera} disabled={session.cameraPhase !== 'live' && session.cameraPhase !== 'starting'}>
            Stop Camera
          </button>
          <button type="button" onClick={session.togglePlayback} disabled={session.inputKind !== 'prerecorded'}>
            Play or pause video
          </button>
          <button type="button" onClick={session.startRun} disabled={!session.canStartRun}>
            Start run
          </button>
          <button type="button" onClick={session.completeRun} disabled={session.localPhase !== 'running'}>
            Complete run
          </button>
        </div>
        <label className="file-field">
          Prerecorded video file
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
        <div className="button-row" role="group" aria-label="Synthetic sequences">
          {SYNTHETIC_SEQUENCES.map((sequence) => (
            <button
              key={sequence.id}
              type="button"
              aria-pressed={session.syntheticId === sequence.id}
              onClick={() => session.useSynthetic(sequence.id)}
            >
              Synthetic: {sequence.title}
            </button>
          ))}
        </div>
        <p className="monitor-note">{session.cameraMessage}</p>
        <div className="monitor-controls">
          <fieldset>
            <legend>Registration and detector</legend>
            <p className="monitor-note">
              Drag a well, or focus it and use the arrow keys. Shift moves farther. Positions are fractions of
              the picture, so they stay aligned when the video display changes size.
            </p>
            <div className="button-row">
              <button type="button" onClick={session.captureReference} disabled={session.inputKind === 'none'}>
                Capture empty plate
              </button>
              <button
                type="button"
                onClick={() => {
                  setWellSize(0.2)
                  session.resetRegions()
                }}
              >
                Reset well positions
              </button>
              <button
                type="button"
                aria-pressed={session.samplingColor}
                onClick={() => session.setSamplingColor(!session.samplingColor)}
                disabled={session.inputKind === 'none'}
              >
                {session.samplingColor ? 'Click the picture to sample' : 'Sample expected color'}
              </button>
            </div>
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
            <p className="monitor-note">{session.referenceLabel}</p>
            <div className="color-row">
              <span className="swatch" style={{ background: rgbToCss(session.expectedColor) }} />
              <span>
                Expected color: {session.expectedLabel} ({formatRgb(session.expectedColor)})
              </span>
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
            <p className="monitor-note">
              {session.inputKind === 'synthetic'
                ? 'On a synthetic sequence, pause holds the next drawn frame and the run clock.'
                : 'Pause stops new observations. A live run clock still advances. A prerecorded clock follows the file.'}{' '}
              Scores are heuristic, not calibrated probabilities. A hand or pipette crossing a well is not treated as a dispense. Mixed regions stay unknown; that is not automatic occlusion detection.
            </p>
          </fieldset>
        </div>
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
