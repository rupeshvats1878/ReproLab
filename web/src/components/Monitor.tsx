import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { expectedWellId } from '../shared/protocol.ts'
import { PROTOCOL_ORDER, WELL_GRID, type WellId, type WellState } from '../shared/types.ts'
import type { MonitorProps } from '../shared/types.ts'
import { highlightedOmissionWells, type FrameEvidence } from '../monitor/liveDecisions.ts'
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
  const highlighted = highlightedOmissionWells(session.live)
  const reviewOpen = protocol.alerts.filter((alert) => alert.status !== 'resolved')
  const lastTrace = session.traces.at(-1)
  const expected = expectedWellId(PROTOCOL_ORDER, session.stableStates)

  return (
    <section className="monitor" aria-labelledby="monitor-title">
      <div className="monitor-heading">
        <h2 id="monitor-title">Monitor</h2>
        <p>
          Colored-water check for six locations, played continuously. A reading is empty, filled, or
          unknown. Unknown means the picture is not clear enough. This does not measure volume,
          concentration, or identity, and it does not run protocols drafted in Prepare.
        </p>
      </div>

      <div className="live-split">
        <div className="live-stage">
          {session.inputKind === 'synthetic' ? (
            <p className="synthetic-flag" role="status">
              Synthetic demonstration
            </p>
          ) : null}
          <p className="input-banner" data-kind={session.inputKind} role="status">
            {session.inputLabel}
          </p>
          <div className="stage" ref={session.bindStage} onPointerDown={session.onStagePointerDown}>
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
          alerts={highlighted}
          debug={session.debugOverlay}
          editable
          onKey={(wellId, dx, dy) => session.nudge('video', wellId, dx, dy)}
          onDragStart={(wellId, event) => session.beginDrag('video', wellId, event)}
          onDrag={(event) => session.moveDrag('video', event)}
          onDragEnd={session.endDrag}
        />
          </div>
          <p className="monitor-note">
            Solid border is filled, dashed is empty, dotted is unknown. A red outline is a possible
            omission: a later location is filled and this one is stably empty.
          </p>
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
          {session.cameraMessage ? (
            <p className="monitor-note" role="status">
              {session.cameraMessage}
            </p>
          ) : null}
          {session.playbackNote ? <p className="monitor-note">{session.playbackNote}</p> : null}
          {session.seekMessage ? (
            <p className="monitor-note" role="alert">
              {session.seekMessage} Start a new run to open another monitoring session.
            </p>
          ) : null}
          {session.localPhase === 'running' && protocol.phase === 'idle' ? (
            <p className="monitor-note">
              Vision is in a run. The review controller has not stored it yet, so protocol wells stay at
              their previous values.
            </p>
          ) : null}
        </div>

        <aside className="live-decisions" aria-label="Protocol decisions">
          <h3>Active step</h3>
          <p>
            This screen watches only {PROTOCOL_ORDER.join(', ')}. A protocol generated in Prepare, including
            Gemini output, is not executed here.
          </p>
          <p className="step-line">
            {session.live.blockedReason
              ? 'Monitoring is blocked. New frames will not become events until you start a new run.'
              : session.localPhase !== 'running'
                ? 'Start a run to follow the six locations in order.'
                : expected
                  ? `Step ${PROTOCOL_ORDER.indexOf(expected) + 1} of 6: fill ${expected}. Stable reading is ${session.stableStates[expected]}.`
                  : 'Every location in the order is stably filled.'}
          </p>
          <p className="monitor-note">
            Session {session.live.sessionId} · {session.live.sourceKind} · generation {session.monitorGeneration}
          </p>
          <div className="monitor-alerts">
            <h3>Possible omissions</h3>
            <p>
              An alert appears only when the earlier location is stably empty. Unknown stays unknown.
              The analyzer&apos;s mix score marks a mixed region unknown. That is not hand, pipette, or
              obstruction detection.
            </p>
            <p className="monitor-note">
              Saved review still uses the shared omission list, which can include unknown. Review has{' '}
              {reviewOpen.length} unresolved alert{reviewOpen.length === 1 ? '' : 's'}.
            </p>
            <label className="file-field">
              Note for a human report
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
            {session.live.alerts.length === 0 ? (
              <p>No live omission alert in this monitoring session.</p>
            ) : (
              <ul className="decision-list">
                {session.live.alerts.map((alert) => (
                  <li key={alert.id} className="decision-card" data-status={alert.status}>
                    <strong>
                      {alert.wellId} · {alert.status}
                    </strong>
                    <p>{alert.expectedAction}</p>
                    <p>Observed: {alert.observedState}</p>
                    <p>Rule: {alert.rule}</p>
                    <p>Source time: {alert.raisedAtElapsedMs} ms</p>
                    {alert.rawState ? <p>Raw state at the alert: {alert.rawState}</p> : null}
                    <EvidenceFigure evidence={alert.evidence} />
                    {alert.correction ? (
                      <div>
                        <p>
                          Later camera update at {alert.correction.elapsedMs} ms: the well was observed
                          filled. The original alert is unchanged.
                        </p>
                        <EvidenceFigure evidence={alert.correction.evidence} />
                      </div>
                    ) : null}
                    <div className="button-row">
                      <button
                        type="button"
                        onClick={() =>
                          session.acknowledgeOmission(alert.id, humanNote || 'Acknowledged by a person.')
                        }
                        disabled={alert.status !== 'open'}
                      >
                        Acknowledge
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          session.reportMissedObservation(
                            alert.id,
                            humanNote || 'Missed observation reported by a person.',
                            reportedState,
                          )
                        }
                      >
                        Report missed observation
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          session.continueAfterCorrection(
                            alert.id,
                            humanNote || 'Continue after a correction.',
                          )
                        }
                      >
                        Continue after correction
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="monitor-alerts">
            <h3>Decision timeline</h3>
            {session.live.timeline.length === 0 ? (
              <p>No decision yet. A skip is raised from the stable reading, not from a fixed timestamp.</p>
            ) : (
              <ol className="decision-list">
                {session.live.timeline.map((entry) => (
                  <li key={entry.id}>
                    <p>
                      <strong>{entry.source === 'human' ? 'Human' : 'Camera'}</strong> · {entry.kind}
                    </p>
                    <p>Expected: {entry.expectedAction}</p>
                    <p>Observed: {entry.observedState}</p>
                    <p>Rule: {entry.rule}</p>
                    <p>Source time: {entry.sourceElapsedMs} ms</p>
                    {entry.note ? <p>Note: {entry.note}</p> : null}
                    {entry.reportedState ? <p>Human reported state: {entry.reportedState}</p> : null}
                    <EvidenceFigure evidence={entry.evidence} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      <div className="monitor-columns">
        <div className="monitor-controls">
          <fieldset>
            <legend>Input</legend>
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
          </fieldset>

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
                : 'Pause stops new observations. A live run clock still advances. A prerecorded clock follows the file.'}
              {' '}Scores are heuristic, not calibrated probabilities. A hand or pipette crossing a well is not treated as a dispense. Mixed regions stay unknown; that is not automatic occlusion detection.
            </p>
          </fieldset>

          <fieldset>
            <legend>Run and recording</legend>
            <div className="button-row">
              <button type="button" onClick={session.startRun} disabled={!session.canStartRun}>
                Start run
              </button>
              <button type="button" onClick={session.completeRun} disabled={session.localPhase !== 'running'}>
                Complete run
              </button>
            </div>
            <p className="monitor-note" role="status">
              Recording: {session.recording.detail}
            </p>
            <p className="monitor-note">{session.evidenceNote}</p>
          </fieldset>
        </div>

      </div>

      <section className="observation-history" aria-label="Observation history">
        <h3>Observation history</h3>
        <p className="monitor-note">
          Camera rows come from stable vision readings. Human rows are reports and do not change those
          readings. Review has stored {storedObservations} observation{storedObservations === 1 ? '' : 's'}.
        </p>
        <HistoryList session={session} />
      </section>

      <details className="debug-panel">
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
              alerts={[]}
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
  const index =
    props.evidence.frameIndex == null ? '' : ` Frame index ${props.evidence.frameIndex}.`
  return (
    <figure className="evidence-figure">
      {props.evidence.frameDataUrl ? (
        <img src={props.evidence.frameDataUrl} alt={`Supporting frame at ${props.evidence.elapsedMs} ms`} />
      ) : null}
      <figcaption>
        {props.evidence.elapsedMs} ms · {props.evidence.label}.{index}
        {props.evidence.frameDataUrl ? '' : ' No still was stored for this decision.'}
      </figcaption>
    </figure>
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
    <ol className="plain-list">
      {rows.map((row) => (
        <li key={row.key}>
          {row.at} ms — {row.source}: {row.detail}
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
  alerts: readonly WellId[]
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
        const omission = props.alerts.includes(wellId)
        const detail = measurement
          ? `${wellId}, stable ${stable}, raw ${measurement.state}, heuristic score ${measurement.fillScore.toFixed(2)}${omission ? ', possible omission' : ''}`
          : `${wellId}, stable ${stable}${omission ? ', possible omission' : ''}`
        return (
          <button
            key={wellId}
            type="button"
            className="region"
            data-state={stable}
            data-omission={omission ? 'true' : 'false'}
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
            <span>{wellId}</span>
            <span>{STATE_LABEL[stable]}</span>
            {props.debug && measurement ? <span>{measurement.fillScore.toFixed(2)}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
