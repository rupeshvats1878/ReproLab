import { useEffect, useRef, useState } from 'react'
import {
  appendReplicationEvent,
  beginReplication,
  finishReplication,
  LibraryClientError,
  openReplication,
  type ReplicationEvent,
  type ReplicationRecord,
} from '../library/client.ts'
import { capturePausedFrame, type FrozenCapture } from '../reference/captureFrame.ts'
import { REFERENCE_CLIPS, REFERENCE_SOURCE } from '../reference/clips.ts'
import { DEFAULT_REGION, validRegion, type Region } from '../reference/measure.ts'
import { buildCorrection, buildHumanCompletion, buildImageObservation, idForUnchangedAttempt } from './events.ts'
import './run.css'

interface PendingCapture {
  capture: FrozenCapture
  capturedAt: string
  source: { clipId: string; title: string; locator: string }
  provenance: '' | 'own_recording' | 'imported_reference'
}

export function Run(props: { replicationId: string | null }) {
  const [record, setRecord] = useState<ReplicationRecord | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [note, setNote] = useState('')
  const [correctionNote, setCorrectionNote] = useState('')
  const [correctsEventId, setCorrectsEventId] = useState('')
  const [clipId, setClipId] = useState('nonrotating')
  const [local, setLocal] = useState<{ id: string; src: string; name: string } | null>(null)
  const [region, setRegion] = useState<Region>(DEFAULT_REGION)
  const [pending, setPending] = useState<PendingCapture | null>(null)
  const [notice, setNotice] = useState('Open a planned replication from Library, then start the session before recording events.')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const inFlight = useRef(false)
  const attempts = useRef<Record<string, { signature: string; id: string } | null>>({})

  useEffect(() => () => { if (local) URL.revokeObjectURL(local.src) }, [local])

  useEffect(() => {
    if (!props.replicationId) return
    let cancelled = false
    void openReplication(props.replicationId)
      .then((next) => {
        if (cancelled) return
        setRecord(next)
        setNotice(next.status === 'planned'
          ? 'This replication is planned. Start it before recording a step or attaching evidence.'
          : 'Restored the saved replication, including its events and evidence.')
        setError('')
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(message(reason))
      })
    return () => { cancelled = true }
  }, [props.replicationId])

  const steps = Array.isArray(record?.protocolSnapshot.steps) ? record.protocolSnapshot.steps : []
  const active = Math.min(stepIndex, Math.max(steps.length - 1, 0))
  const clip = REFERENCE_CLIPS.find((item) => item.id === clipId)
  const src = clip?.src ?? local?.src ?? ''
  const running = record?.status === 'in_progress'
  const completions = (record?.events ?? []).filter((event) => event.type === 'human_completion' && event.stepIndex === active)

  async function start() {
    if (!record || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const next = await beginReplication(record.id)
      setRecord(next)
      setNotice('The session has started. Completing a step and attaching an image are separate actions.')
    } catch (reason) {
      setError(message(reason))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function postEvent(kind: string, payload: Record<string, unknown>, success: string): Promise<boolean> {
    if (!record || inFlight.current) return false
    const signature = JSON.stringify(payload)
    const attempt = idForUnchangedAttempt(attempts.current[kind] ?? null, signature)
    attempts.current[kind] = attempt
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await appendReplicationEvent(record.id, { ...payload, id: attempt.id })
      if (!next.events.some((event) => event.id === attempt.id)) {
        throw new Error('The library did not confirm this event. It was not marked saved.')
      }
      attempts.current[kind] = null
      setRecord(next)
      setNotice(success)
      if (kind === 'evidence') setPending(null)
      return true
    } catch (reason) {
      setError(message(reason))
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function capture() {
    const player = video.current
    if (!player) {
      setError('Pause the video, wait for seeking to finish, and choose a crop inside the image.')
      return
    }
    const title = clip?.name ?? local?.name
    if (!title) {
      setError('Choose a recording before capturing a frame.')
      return
    }
    try {
      const frozen = capturePausedFrame(player, region)
      setPending({
        capture: frozen,
        capturedAt: new Date().toISOString(),
        source: {
          clipId: clip?.id ?? local!.id,
          title,
          locator: clip ? REFERENCE_SOURCE : `local-file:${local!.name}`,
        },
        provenance: clip ? 'imported_reference' : '',
      })
      setError('')
      setNotice('Frame captured. Review the preview, then attach it to the selected step. Attaching does not complete the step.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to read the frame.')
    }
  }

  function attach() {
    if (!pending) return
    if (!pending.provenance) {
      setError('Identify whether this upload is your own recording or imported reference footage.')
      return
    }
    let body: ReturnType<typeof buildImageObservation>
    try {
      body = buildImageObservation({
        id: '00000000-0000-4000-8000-000000000000',
        stepIndex: active,
        capturedAt: pending.capturedAt,
        provenance: pending.provenance,
        source: pending.source,
        capture: pending.capture,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The captured image cannot be attached.')
      return
    }
    const { id, ...payload } = body
    void id
    void postEvent('evidence', payload, 'The library saved this evidence. The image does not complete the step.')
  }

  async function finish() {
    if (!record || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const next = await finishReplication(record.id)
      setRecord(next)
      const unfinished = next.execution.unfinishedStepIndexes.map((index) => stepLabel(next, index)).join('; ')
      setNotice(`${next.completionNote ?? 'Session ended.'} Unfinished steps remain: ${unfinished || 'none'}`)
    } catch (reason) {
      setError(message(reason))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section className="run-lab">
      <p className="app-kicker">ReproLab • Replication run</p>
      <h2>Record the session. Keep the evidence.</h2>
      {!props.replicationId || !record || record.id !== props.replicationId ? <p>Open a replication from Library. Starting a plan does not begin the recording session.</p> : (
        <>
          <p>Replication {record.id} · {record.status}</p>
          <p>{record.note}</p>
          {record.status === 'planned' ? <button type="button" onClick={() => void start()} disabled={busy}>Start session</button> : null}
          <div className="run-layout">
            <div>
              <label>Recording <select value={clipId} onChange={(event) => { setClipId(event.target.value); setPending(null) }}>
                {REFERENCE_CLIPS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                {local ? <option value={local.id}>{local.name}</option> : null}
              </select></label>
              <label>Or import your own video <input type="file" accept="video/*" onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (file.type && !file.type.startsWith('video/')) { setError('Choose a video file.'); return }
                const id = `local-${crypto.randomUUID()}`
                setLocal({ id, src: URL.createObjectURL(file), name: file.name })
                setClipId(id)
                setPending(null)
              }} /></label>
              <div className="run-player">
                <video key={src} ref={video} src={src} controls preload="metadata" onError={() => setError('Video unavailable or unsupported. Use a bundled clip or import a supported local MP4.')} />
              </div>
              <div className="run-crop">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key} (%)
                <input type="number" min={key === 'width' || key === 'height' ? 5 : 0} max={100} value={region[key]}
                  onChange={(event) => setRegion((current) => ({ ...current, [key]: Number(event.target.value) }))} />
              </label>)}</div>
              <button type="button" onClick={capture} disabled={!running || !validRegion(region)}>Capture paused frame</button>
              {pending ? <Preview pending={pending} onProvenance={(provenance) => setPending({ ...pending, provenance })} /> : null}
              <button type="button" onClick={attach} disabled={!running || !pending || busy}>Attach evidence</button>
            </div>
            <aside>
              <h3>Active step</h3>
              <p>{steps[active]?.instruction ?? 'No protocol steps were frozen with this replication.'}</p>
              <ol className="run-steps">
                {steps.map((step, index) => {
                  const view = record.execution.steps.find((item) => item.stepIndex === index)
                  return (
                    <li key={index}>
                      <button type="button" aria-pressed={index === active} onClick={() => setStepIndex(index)}>
                        {index + 1}. {step.instruction ?? 'Step'}
                      </button>
                      <p>{view?.humanCompleted ? 'Human completion saved' : 'Not human-completed'} · own images {view?.ownObservationCount ?? 0} · reference images {view?.referenceObservationCount ?? 0}</p>
                    </li>
                  )
                })}
              </ol>
              <label>Completion note <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>
              <button type="button" disabled={!running || busy} onClick={() => {
                const { id, ...payload } = buildHumanCompletion('00000000-0000-4000-8000-000000000000', active, note)
                void id
                void postEvent('completion', payload, 'The library saved the human completion. An image is still separate evidence.')
                  .then((saved) => { if (saved) setNote('') })
              }}>Confirm step</button>
              <label>Correct a saved completion <select value={correctsEventId} onChange={(event) => setCorrectsEventId(event.target.value)}>
                <option value="">Choose a completion</option>
                {completions.map((event) => <option key={event.id} value={event.id}>{event.recordedAt ?? event.id}</option>)}
              </select></label>
              <label>Correction note <textarea value={correctionNote} maxLength={500} onChange={(event) => setCorrectionNote(event.target.value)} /></label>
              <button type="button" disabled={!running || busy || !correctsEventId || !correctionNote.trim()} onClick={() => {
                const { id, ...payload } = buildCorrection('00000000-0000-4000-8000-000000000000', active, correctsEventId, correctionNote)
                void id
                void postEvent('correction', payload, 'The library saved the correction. The earlier completion is no longer active, and any image remains.')
                  .then((saved) => { if (saved) setCorrectionNote('') })
              }}>Save correction</button>
            </aside>
          </div>
          <div className="run-finish">
            <h3>End the session</h3>
            <p>Ending the session does not mean the experiment succeeded or was reproduced. Unfinished steps stay listed.</p>
            <p>Unfinished steps: {record.execution.unfinishedStepIndexes.length
              ? record.execution.unfinishedStepIndexes.map((index) => stepLabel(record, index)).join('; ')
              : 'none'}</p>
            {record.completionNote ? <p>{record.completionNote}</p> : null}
            <button type="button" onClick={() => void finish()} disabled={!running || busy}>End session</button>
          </div>
          <h3>Saved events</h3>
          <div className="run-events">
            {record.events.length === 0 ? <p>No events have been saved.</p> : record.events.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        </>
      )}
      <p role="status">{notice}</p>
      {error ? <p role="alert" className="run-warning">{error}</p> : null}
    </section>
  )
}

function Preview(props: { pending: PendingCapture; onProvenance: (value: PendingCapture['provenance']) => void }) {
  const { capture, source, provenance } = props.pending
  const bundled = REFERENCE_CLIPS.some((item) => item.id === source.clipId)
  return (
    <article className="run-preview">
      <img src={capture.imageDataUrl} alt={`Captured crop from ${source.title} at ${capture.videoTimeSec.toFixed(2)} seconds`} />
      <p>{source.title} · video {capture.videoTimeSec.toFixed(2)}s · wall clock {props.pending.capturedAt}</p>
      <p>Crop x {capture.crop.x}, y {capture.crop.y}, width {capture.crop.width}, height {capture.crop.height}</p>
      <p>{capture.measurement.quality} · {capture.measurement.value?.toFixed(4) ?? 'Not assessed'} · {capture.measurement.analysisVersion}</p>
      <p>{capture.measurement.reason ?? capture.localResult.reason}</p>
      <p>Provenance: {bundled ? 'imported_reference' : provenance || 'not identified'}</p>
      {bundled ? null : <label>Provenance <select value={provenance} onChange={(event) => props.onProvenance(event.target.value as PendingCapture['provenance'])}>
        <option value="">Choose provenance</option>
        <option value="own_recording">own_recording</option>
        <option value="imported_reference">imported_reference</option>
      </select></label>}
    </article>
  )
}

function EventCard(props: { event: ReplicationEvent }) {
  const event = props.event
  const image = event.image?.data ? `data:${event.image.mediaType};base64,${event.image.data}` : ''
  const version = event.measurement?.analysisVersion
  return (
    <article>
      <p>{event.type} · step {event.stepIndex + 1} · {event.recordedAt}</p>
      {event.note ? <p>{event.note}</p> : null}
      {event.provenance ? <p>Provenance: {event.provenance}</p> : null}
      {event.source ? <p>{event.source.title} · {event.source.locator}</p> : null}
      {event.videoTimeSec != null ? <p>Video time {event.videoTimeSec.toFixed(2)}s · captured {event.capturedAt}</p> : null}
      {event.crop ? <p>Crop x {event.crop.x}, y {event.crop.y}, width {event.crop.width}, height {event.crop.height}</p> : null}
      {event.measurement ? <p>Measurement {event.measurement.quality ?? 'stored'} · {event.measurement.value ?? event.measurement.dispersion ?? 'Not assessed'} · {version ?? 'method version not recorded'}</p> : null}
      {event.measurement?.reason ? <p>{event.measurement.reason}</p> : null}
      {image ? <img src={image} alt="Saved evidence frame" /> : null}
    </article>
  )
}

function stepLabel(record: ReplicationRecord, index: number): string {
  const step = record.protocolSnapshot.steps?.[index]
  return `${index + 1}. ${step?.instruction ?? 'Step'}`
}

function message(reason: unknown): string {
  return reason instanceof LibraryClientError || reason instanceof Error
    ? reason.message
    : 'The replication request failed. Nothing new was saved.'
}
