import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PreparedMonitorProtocol } from '../prepare/sixWell.ts'
import { createId, initialWellStates } from '../shared/protocol.ts'
import {
  type FinalPlateDraft,
  type MediaDraft,
  type MonitorProps,
  type ObservationDraft,
  type WellId,
  type WellReading,
  type WellState,
} from '../shared/types.ts'
import {
  analyzeFrame,
  emptyReferenceFromBuffer,
  measurementStates,
  readPixel,
  type WellMeasurement,
} from './analyze.ts'
import {
  isBackwardJump,
  liveElapsedMs,
  monotonicElapsed,
  prerecordedElapsedMs,
  runStartOffsetFromClocks,
} from './clock.ts'
import { COLOR_PRESETS, presetById, type ColorPresetId, type Rgb } from './color.ts'
import {
  containContentRect,
  contentPointToNormalized,
  copyRegions,
  defaultWellRegions,
  moveRegionCenter,
  nudgeRegion,
  resizeAllRegions,
  type PixelRect,
  type WellRegions,
} from './geometry.ts'
import {
  cameraErrorCopy,
  cameraRecordingDraft,
  chooseRecorderMime,
  durationMsFromSeconds,
  finalAssessmentFromStates,
  finalImageDraft,
  measureVideoDuration,
  prerecordedDraft,
  releaseTracks,
  rememberVisionBlob,
  revokeObjectUrl,
} from './media.ts'
import {
  acknowledgeAlert,
  applyStableObservation,
  blockLiveMonitor,
  continueAfterCorrection,
  createLiveMonitor,
  reportMissedObservation,
  type FrameEvidence,
  type LiveMonitorState,
  type LiveSourceKind,
} from '../monitor/liveDecisions.ts'
import { observationEvent } from '../monitor/persistEvents.ts'
import { createMonitorSaver, type SaveStatus } from '../monitor/saveSession.ts'
import {
  afterSyntheticObservation,
  continueDemoPlayback,
  initialDemoPresentation,
  resetDemoPresentation,
  setPauseOnIssue as pausePreference,
} from '../monitor/demoPause.ts'
import { annotationDocument, DEFAULT_CAPTURE_PROTOCOL_ID, localReviewNotice, markerDefinition, recordingSeekSeconds, THREE_CUP_PROCEDURE_ID, type CaptureMarkerId, type CaptureMarkerRecord, type CaptureProtocolId } from '../capture/threeCup.ts'
import { keepLocalMedia } from '../review/store.ts'
import { durationNeedsRepair, patchWebmDuration } from './webmDuration.ts'
import { ObservationEmitter, ReadingStabilizer, readingsOf } from './stabilize.ts'
import { SYNTHETIC_SEQUENCES, type SyntheticFrame } from './synthetic.ts'

const SAMPLE_MS = 140
const SOURCE_CHANGE_MESSAGE =
  'The picture source changed during monitoring. Stale frames cannot become new events. Start a new run to open a monitoring session for this source.'
const SYNTHETIC_FRAME_MS = 220
const STABLE_FRAMES = 4
const SEEK_MESSAGE =
  'Playback was seeked or replayed. Observations are stopped so this run does not duplicate or reorder events. Start a new run to continue from the current frame.'

export interface RecordingView {
  phase: 'idle' | 'recording' | 'saving' | 'saved' | 'failed'
  detail: string
}

export interface VisionSession {
  bindVideo: (node: HTMLVideoElement | null) => void
  bindCanvas: (node: HTMLCanvasElement | null) => void
  bindStage: (node: HTMLDivElement | null) => void
  bindFinalStage: (node: HTMLDivElement | null) => void
  inputKind: 'none' | 'live' | 'prerecorded' | 'synthetic'
  inputLabel: string
  cameraPhase: 'idle' | 'starting' | 'live' | 'denied' | 'missing' | 'failed'
  cameraMessage: string
  fileName: string
  syntheticId: string | null
  syntheticTitle: string
  playbackNote: string
  seekMessage: string
  observationPaused: boolean
  debugOverlay: boolean
  samplingColor: boolean
  expectedColor: Rgb
  expectedLabel: string
  referenceLabel: string
  regions: WellRegions
  contentRect: PixelRect | null
  measurements: WellMeasurement[]
  stableStates: Record<WellId, WellState>
  localPhase: 'idle' | 'running' | 'completed'
  localElapsedMs: number
  recording: RecordingView
  evidenceNote: string
  emitted: ObservationDraft[]
  traces: ObservationTrace[]
  live: LiveMonitorState
  saveStatus: SaveStatus
  syntheticPace: 1 | 2 | 4
  setSyntheticPace: (pace: 1 | 2 | 4) => void
  pauseOnIssue: boolean
  setPauseOnIssue: (enabled: boolean) => void
  demoPaused: boolean
  continueDemo: () => void
  correctionNote: string | null
  summaryHeld: boolean
  sampleMs: number
  lastProcessingMs: number
  monitorGeneration: number
  observationStatus: string
  canStartRun: boolean
  finalUrl: string | null
  finalSeparate: boolean
  finalRegions: WellRegions
  finalContentRect: PixelRect | null
  finalMeasurements: WellMeasurement[]
  assessment: FinalPlateDraft | null
  finalMessage: string
  finalReferenceLabel: string
  setObservationPaused: (paused: boolean) => void
  setDebugOverlay: (enabled: boolean) => void
  setSamplingColor: (enabled: boolean) => void
  setFinalSeparate: (enabled: boolean) => void
  procedureMode: 'six-well' | 'three-cup'
  setProcedureMode: (mode: 'six-well' | 'three-cup') => void
  captureProtocolId: CaptureProtocolId
  protocolFrozen: boolean
  selectCaptureProtocol: (id: CaptureProtocolId) => void
  reviewFile: { name: string; bytes: number } | null
  mediaNotice: string
  playbackNotice: string
  openCaptureReview: (file: File) => void
  clearCaptureReview: () => void
  seekStage: (observationTimestamp: number) => void
  reportPlaybackError: (message: string) => void
  markers: CaptureMarkerRecord[]
  addMarker: (marker: CaptureMarkerId) => void
  localRecording: Blob | null
  runStartOffsetMs: number
  recordingDurationMs: number | null
  downloadRecording: () => void
  downloadAnnotations: () => void
  startClockCheck: () => void
  recordThisRun: boolean
  setRecordThisRun: (enabled: boolean) => void
  attachSourceFile: boolean
  setAttachSourceFile: (enabled: boolean) => void
  startCamera: () => void
  stopCamera: () => void
  useVideoFile: (file: File) => void
  useSynthetic: (id: string) => void
  togglePlayback: () => void
  startRun: () => void
  completeRun: () => void
  finishSession: () => void
  captureReference: () => void
  selectPreset: (id: ColorPresetId) => void
  setWellSize: (size: number) => void
  resetRegions: () => void
  captureFinalFromVideo: () => void
  useFinalFile: (file: File) => void
  captureFinalReference: () => void
  assessFinal: () => void
  onStagePointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  beginDrag: (target: 'video' | 'final', wellId: WellId, event: ReactPointerEvent<HTMLElement>) => void
  moveDrag: (target: 'video' | 'final', event: ReactPointerEvent<HTMLElement>) => void
  endDrag: (event: ReactPointerEvent<HTMLElement>) => void
  nudge: (target: 'video' | 'final', wellId: WellId, dx: number, dy: number) => void
  acknowledgeOmission: (alertId: string, note: string) => void
  reportMissedObservation: (alertId: string, note: string, reportedState: WellState) => void
  continueAfterCorrection: (alertId: string, note: string) => void
}

export interface ObservationTrace {
  generation: number
  draft: ObservationDraft
  rawWells: WellReading[]
  evidence: FrameEvidence
  processingMs: number
}

type Callbacks = Pick<
  MonitorProps,
  'onRunStart' | 'onElapsedMs' | 'onObservation' | 'onMediaAvailable' | 'onRunComplete'
>

export function useVisionSession(callbacks: Callbacks, preparedProtocol: PreparedMonitorProtocol | null = null): VisionSession {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const finalStageRef = useRef<HTMLDivElement | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraToken = useRef(0)
  const callbacksRef = useRef(callbacks)
  const preparedRef = useRef(preparedProtocol)
  preparedRef.current = preparedProtocol
  const mounted = useRef(true)
  const frameRef = useRef<SyntheticFrame | null>(null)
  const emptyFrameRef = useRef<SyntheticFrame | null>(null)
  const previousRaw = useRef(initialWellStates())
  const stabilizer = useRef(new ReadingStabilizer(STABLE_FRAMES))
  const emitter = useRef(new ObservationEmitter())
  const processingMsRef = useRef(0)
  const monitorGenerationRef = useRef(0)
  const originRef = useRef(0)
  const lastElapsedRef = useRef(0)
  const runOffsetRef = useRef(0)
  const [runStartOffsetMs, setRunStartOffsetMs] = useState(0)
  const [recordingDurationMs, setRecordingDurationMs] = useState<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recorderMime = useRef<string | undefined>(undefined)
  const recordingMediaId = useRef<string | null>(null)
  const recordingSettled = useRef(false)
  const recordThisRunRef = useRef(false)
  const procedureRef = useRef<'six-well' | 'three-cup'>('six-well')
  const recordingStartedAt = useRef(0)
  const recordingDurationRef = useRef<number | null>(null)
  const clockFrameRef = useRef<number | null>(null)
  const attachSourceRef = useRef(false)
  const recordingTracks = useRef<MediaStreamTrack[]>([])
  const fileBlobRef = useRef<Blob | null>(null)
  const previewUrls = useRef<{ video: string | null; final: string | null }>({ video: null, final: null })
  const bindVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node
  }, [])
  const bindCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node
  }, [])
  const bindStage = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node
  }, [])
  const bindFinalStage = useCallback((node: HTMLDivElement | null) => {
    finalStageRef.current = node
  }, [])
  const syntheticTimer = useRef<number | null>(null)
  const syntheticPaceRef = useRef<1 | 2 | 4>(4)
  const [syntheticPace, setSyntheticPaceState] = useState<1 | 2 | 4>(4)
  const presentationRef = useRef(initialDemoPresentation())
  const summaryTimer = useRef<number | null>(null)
  const [pauseOnIssue, setPauseOnIssueState] = useState(true)
  const [demoPaused, setDemoPaused] = useState(false)
  const [correctionNote, setCorrectionNote] = useState<string | null>(null)
  const [summaryHeld, setSummaryHeld] = useState(false)
  const syntheticFrames = useRef<SyntheticFrame[]>([])
  const syntheticIndex = useRef(0)
  const inputKindRef = useRef<VisionSession['inputKind']>('none')
  const pausedRef = useRef(false)
  const lastAnalyzedTime = useRef(-1)
  const runningRef = useRef(false)
  const holdRef = useRef(false)
  const seekBlockedRef = useRef(false)
  const pendingSeek = useRef(false)
  const lastMediaTime = useRef(0)
  const regionsRef = useRef(defaultWellRegions())
  const finalRegionsRef = useRef(defaultWellRegions())
  const expectedRef = useRef<Rgb>(COLOR_PRESETS[0].rgb)
  const referenceRef = useRef<Partial<Record<WellId, Rgb>> | null>(null)
  const finalReferenceRef = useRef<Partial<Record<WellId, Rgb>> | null>(null)
  const finalSeparateRef = useRef(false)
  const finalImageRef = useRef<HTMLImageElement | null>(null)
  const finalAvailableRef = useRef(false)
  const finalMediaIdRef = useRef<string | null>(null)
  const assessmentRef = useRef<FinalPlateDraft | null>(null)
  const samplingRef = useRef(false)
  const contentRectRef = useRef<PixelRect | null>(null)
  const finalContentRef = useRef<PixelRect | null>(null)
  const mediaSizeRef = useRef({ w: 0, h: 0 })
  const finalMediaSizeRef = useRef({ w: 0, h: 0 })
  const dragRef = useRef<{ wellId: WellId; pointerId: number; target: 'video' | 'final' } | null>(null)
  const loopRef = useRef<() => void>(() => {})
  const publishRef = useRef<(elapsed: number) => void>(() => {})

  const [inputKind, setInputKind] = useState<VisionSession['inputKind']>('none')
  const [cameraPhase, setCameraPhase] = useState<VisionSession['cameraPhase']>('idle')
  const [cameraMessage, setCameraMessage] = useState('Camera is off.')
  const [fileName, setFileName] = useState('')
  const [syntheticId, setSyntheticId] = useState<string | null>(null)
  const [syntheticTitle, setSyntheticTitle] = useState('')
  const [playbackNote, setPlaybackNote] = useState('')
  const [seekMessage, setSeekMessage] = useState('')
  const [observationPaused, setPausedState] = useState(false)
  const [debugOverlay, setDebugOverlay] = useState(false)
  const [samplingColor, setSamplingState] = useState(false)
  const [expectedColor, setExpectedColor] = useState<Rgb>(COLOR_PRESETS[0].rgb)
  const [expectedLabel, setExpectedLabel] = useState<string>(COLOR_PRESETS[0].label)
  const [referenceLabel, setReferenceLabel] = useState('Not captured. Empty stays unknown until a reference or a clear dye color is seen.')
  const [regions, setRegions] = useState<WellRegions>(defaultWellRegions)
  const [contentRect, setContentRect] = useState<PixelRect | null>(null)
  const [measurements, setMeasurements] = useState<WellMeasurement[]>([])
  const [stableStates, setStableStates] = useState<Record<WellId, WellState>>(initialWellStates)
  const [localPhase, setLocalPhase] = useState<VisionSession['localPhase']>('idle')
  const [localElapsedMs, setLocalElapsedMs] = useState(0)
  const [recording, setRecording] = useState<RecordingView>({
    phase: 'idle',
    detail: 'Not recording.',
  })
  const [recordThisRun, setRecordThisRunState] = useState(false)
  const [procedureMode, setProcedureModeState] = useState<'six-well' | 'three-cup'>('six-well')
  const [captureProtocolId, setCaptureProtocolId] = useState<CaptureProtocolId>(DEFAULT_CAPTURE_PROTOCOL_ID)
  const captureProtocolRef = useRef<CaptureProtocolId>(DEFAULT_CAPTURE_PROTOCOL_ID)
  const [protocolFrozen, setProtocolFrozen] = useState(false)
  const protocolFrozenRef = useRef(false)
  const [reviewFile, setReviewFile] = useState<{ name: string; bytes: number } | null>(null)
  const reviewOpenRef = useRef(false)
  const [mediaNotice, setMediaNotice] = useState('')
  const [playbackNotice, setPlaybackNotice] = useState('')
  const ignoreVideoErrorRef = useRef(false)
  const [markers, setMarkers] = useState<CaptureMarkerRecord[]>([])
  const [localRecording, setLocalRecording] = useState<Blob | null>(null)
  const [attachSourceFile, setAttachSourceState] = useState(false)
  const [evidenceNote, setEvidenceNote] = useState('No evidence has been registered in this visit.')
  const [emitted, setEmitted] = useState<ObservationDraft[]>([])
  const [traces, setTraces] = useState<ObservationTrace[]>([])
  const [live, setLive] = useState<LiveMonitorState>(() => createLiveMonitor('unspecified', 0))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ phase: 'idle', detail: 'Not saved.' })
  const liveRef = useRef(live)
  const saverRef = useRef<ReturnType<typeof createMonitorSaver> | null>(null)
  const [lastProcessingMs, setLastProcessingMs] = useState(0)
  const [monitorGeneration, setMonitorGeneration] = useState(0)
  const [finalUrl, setFinalUrl] = useState<string | null>(null)
  const [finalSeparate, setFinalSeparateState] = useState(false)
  const [finalRegions, setFinalRegions] = useState<WellRegions>(defaultWellRegions)
  const [finalContentRect, setFinalContentRect] = useState<PixelRect | null>(null)
  const [finalMeasurements, setFinalMeasurements] = useState<WellMeasurement[]>([])
  const [assessment, setAssessment] = useState<FinalPlateDraft | null>(null)
  const [finalMessage, setFinalMessage] = useState('No final image yet.')
  const [finalReferenceLabel, setFinalReferenceLabel] = useState('Using the video empty-plate reference when framing matches.')

  const inputLabel =
    inputKind === 'live'
      ? 'Input: live camera. Frames stay on this computer.'
      : inputKind === 'prerecorded'
        ? `Input: prerecorded file${fileName ? ` (${fileName})` : ''}. Observations use the video clock.`
        : inputKind === 'synthetic'
          ? `Input: synthetic sequence — ${syntheticTitle}. This is not a camera recording.`
          : 'Input: none. Start a camera, choose a video file, or play a synthetic sequence.'

  const observationStatus = seekMessage
    ? 'Monitoring session blocked'
    : demoPaused
      ? 'Demo paused'
      : observationPaused
        ? 'Observations paused'
        : localPhase === 'running'
          ? 'Observing'
          : localPhase === 'completed'
            ? 'Run completed'
            : 'Idle'

  const canStartRun =
    (localPhase !== 'running' || seekMessage !== '') &&
    inputKind !== 'none' &&
    (inputKind !== 'live' || cameraPhase === 'live')

  function scratchCanvas(): HTMLCanvasElement {
    if (!scratchRef.current) scratchRef.current = document.createElement('canvas')
    return scratchRef.current
  }

  function replaceUrl(slot: 'video' | 'final', next: string | null): void {
    const urls = previewUrls.current
    const current = urls[slot]
    if (current && current !== next) revokeObjectUrl((url) => URL.revokeObjectURL(url), current)
    urls[slot] = next
  }

  function stopSyntheticClock(): void {
    if (syntheticTimer.current != null) {
      window.clearInterval(syntheticTimer.current)
      syntheticTimer.current = null
    }
  }

  function monitorSaver() {
    if (!saverRef.current) {
      saverRef.current = createMonitorSaver((status) => {
        if (mounted.current) setSaveStatus(status)
      })
    }
    return saverRef.current
  }

  function syncPresentation(next: ReturnType<typeof initialDemoPresentation>): void {
    presentationRef.current = next
    if (!mounted.current) return
    setPauseOnIssueState(next.pauseOnIssue)
    setDemoPaused(next.paused)
    setCorrectionNote(next.correctionNote)
  }

  function clearSummaryHold(): void {
    if (summaryTimer.current != null) {
      window.clearTimeout(summaryTimer.current)
      summaryTimer.current = null
    }
    if (mounted.current) setSummaryHeld(false)
  }

  function armSummaryHold(): void {
    clearSummaryHold()
    if (!presentationRef.current.correctionNote || !mounted.current) return
    setSummaryHeld(true)
    summaryTimer.current = window.setTimeout(() => {
      summaryTimer.current = null
      if (mounted.current) setSummaryHeld(false)
    }, 3200)
  }

  function releasePresentation(): void {
    clearSummaryHold()
    syncPresentation(resetDemoPresentation(presentationRef.current.pauseOnIssue))
  }

  function rememberLive(next: LiveMonitorState, observation?: ReturnType<typeof observationEvent>) {
    const previous = liveRef.current
    if (next === previous) return
    liveRef.current = next
    if (mounted.current) setLive(next)
    monitorSaver().saveStep({ previous, next, observation })
    const source = inputKindRef.current === 'none' ? 'unspecified' : inputKindRef.current
    syncPresentation(afterSyntheticObservation(presentationRef.current, source, previous, next))
  }

  function publishMedia(draft: MediaDraft): void {
    callbacksRef.current.onMediaAvailable(draft)
    monitorSaver().saveEvidence(draft, Math.max(0, lastElapsedRef.current))
  }

  function publish(elapsed: number): void {
    if (!runningRef.current || seekBlockedRef.current) return
    const next = monotonicElapsed(elapsed, lastElapsedRef.current)
    if (next !== lastElapsedRef.current) {
      lastElapsedRef.current = next
      if (mounted.current) setLocalElapsedMs(next)
      callbacksRef.current.onElapsedMs(next)
    }
    if (procedureRef.current === 'three-cup' || pausedRef.current || holdRef.current) return
    const draft = emitter.current.consider(next, stabilizer.current.snapshot())
    if (!draft) {
      const reason = emitter.current.blocked
      if (reason) {
        if (mounted.current) setSeekMessage(reason)
        rememberLive(blockLiveMonitor(liveRef.current, reason))
      }
      return
    }
    const evidence = snapshotEvidence(draft.elapsedMs)
    const rawWells = readingsOf(previousRaw.current)
    callbacksRef.current.onObservation(draft)
    if (mounted.current) {
      setEmitted((items) => [...items.slice(-7), draft])
      setTraces((items) => [
        ...items,
        {
          generation: monitorGenerationRef.current,
          draft,
          rawWells,
          evidence,
          processingMs: processingMsRef.current,
        },
      ])
    }
    rememberLive(
      applyStableObservation(liveRef.current, draft, evidence, rawWells),
      observationEvent(createId('observation'), draft.elapsedMs, rawWells, draft.wells),
    )
  }

  function snapshotEvidence(elapsedMs: number): FrameEvidence {
    const synthetic = inputKindRef.current === 'synthetic'
    const canvas = synthetic ? canvasRef.current : scratchRef.current
    let frameDataUrl: string | null = null
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try {
        frameDataUrl = canvas.toDataURL('image/jpeg', 0.72)
      } catch {
        frameDataUrl = null
      }
    }
    return {
      elapsedMs,
      frameIndex: synthetic ? Math.max(0, syntheticIndex.current - 1) : null,
      frameDataUrl,
      label: frameRef.current?.label ?? (synthetic ? 'Synthetic frame' : 'Video frame'),
    }
  }

  function timeAnalyze(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    label: string,
    previous: Readonly<Record<WellId, WellState>>,
  ) {
    frameRef.current = { data, width, height, label }
    const started = performance.now()
    const measured = analyzeFrame(
      data,
      width,
      height,
      regionsRef.current,
      { expectedColor: expectedRef.current, emptyReference: referenceRef.current },
      previous,
    )
    processingMsRef.current = performance.now() - started
    if (mounted.current) setLastProcessingMs(processingMsRef.current)
    return measured
  }

  function ingest(data: Uint8ClampedArray, width: number, height: number, label: string): void {
    const measured = timeAnalyze(data, width, height, label, previousRaw.current)
    previousRaw.current = measurementStates(measured)
    if (!mounted.current) return
    setMeasurements(measured)
    if (!runningRef.current) return
    const stable = stabilizer.current.push(previousRaw.current)
    setStableStates(stable.states)
  }

  function previewMeasurements(data: Uint8ClampedArray, width: number, height: number, label: string): void {
    const measured = timeAnalyze(data, width, height, label, initialWellStates())
    if (mounted.current) setMeasurements(measured)
  }

  useEffect(() => {
    callbacksRef.current = callbacks
    inputKindRef.current = inputKind
    regionsRef.current = regions
    finalRegionsRef.current = finalRegions
    expectedRef.current = expectedColor
    contentRectRef.current = contentRect
    finalContentRef.current = finalContentRect
    publishRef.current = publish
    loopRef.current = () => {
      if (procedureRef.current === 'three-cup') return
      if (inputKindRef.current === 'synthetic' || inputKindRef.current === 'none') return
      const video = videoRef.current
      if (!video || video.readyState < 2 || video.seeking || video.paused || video.ended || pausedRef.current) return
      if (video.currentTime === lastAnalyzedTime.current) return
      lastAnalyzedTime.current = video.currentTime
      const data = grabVideoFrame(video, scratchCanvas())
      if (!data) return
      ingest(data, video.videoWidth, video.videoHeight, 'video')
    }
  })

  function blockSeek(): void {
    if (seekBlockedRef.current || !runningRef.current) return
    seekBlockedRef.current = true
    holdRef.current = true
    emitter.current.block(SEEK_MESSAGE)
    if (mounted.current) setSeekMessage(SEEK_MESSAGE)
    rememberLive(blockLiveMonitor(liveRef.current, SEEK_MESSAGE))
  }

  function endMonitoringSession(reason: string): void {
    const active = runningRef.current || seekBlockedRef.current
    stopSyntheticClock()
    if (!active) return
    runningRef.current = false
    seekBlockedRef.current = true
    holdRef.current = true
    emitter.current.block(reason)
    stabilizer.current.reset()
    previousRaw.current = initialWellStates()
    if (mounted.current) {
      setSeekMessage(reason)
      setLocalPhase('idle')
      setStableStates(initialWellStates())
    }
    rememberLive(blockLiveMonitor(liveRef.current, reason))
  }

  function registerEvidence(note: string): void {
    if (mounted.current) setEvidenceNote(note)
  }

  function failRecording(mediaId: string, detail: string): void {
    if (recordingSettled.current) return
    recordingSettled.current = true
    publishMedia(
      cameraRecordingDraft({
        mediaId,
        ok: false,
        mimeType: recorderMime.current,
        runStartOffsetMs: runOffsetRef.current,
        label: 'Live camera',
      }),
    )
    registerEvidence(detail)
    if (mounted.current) setRecording({ phase: 'failed', detail })
  }

  async function finishRecording(): Promise<void> {
    if (recordingSettled.current) return
    recordingSettled.current = true
    const mediaId = recordingMediaId.current
    const chunks = chunksRef.current
    const mime = recorderMime.current || chunks[0]?.type || 'video/webm'
    const blob = new Blob(chunks, { type: mime })
    if (!mediaId || blob.size === 0) {
      failRecording(mediaId ?? createId('media'), 'Recording produced no bytes. Video evidence is not available.')
      return
    }
    const wallClockMs = Math.round(performance.now() - recordingStartedAt.current)
    let file = blob
    let durationMs = await measureVideoDuration(blob)
    if ((blob.type.includes('webm') || mime.includes('webm')) && durationNeedsRepair(durationMs, wallClockMs)) {
      const patched = patchWebmDuration(new Uint8Array(await blob.arrayBuffer()), wallClockMs)
      if (patched) {
        file = new Blob([patched.buffer.slice(patched.byteOffset, patched.byteOffset + patched.byteLength) as ArrayBuffer], { type: blob.type || mime })
        durationMs = await measureVideoDuration(file)
      }
    }
    if (durationNeedsRepair(durationMs, wallClockMs)) durationMs = wallClockMs
    recordingDurationRef.current = durationMs ?? null
    if (mounted.current) setRecordingDurationMs(durationMs ?? null)
    rememberVisionBlob(mediaId, file)
    setLocalRecording(file)
    void keepLocalMedia(mediaId, file).catch(() => {
      registerEvidence('The recording is held for this page. This browser did not keep a copy for later.')
    })
    publishMedia(
      cameraRecordingDraft({
        mediaId,
        ok: true,
        mimeType: file.type || mime,
        runStartOffsetMs: runOffsetRef.current,
        durationMs,
        label: 'Live camera recording',
      }),
    )
    const detail = `Recording saved in this browser session${durationMs == null ? '' : ` (${durationMs} ms)`}. It was not uploaded. The run clock is separate from chunk arrival.`
    registerEvidence(detail)
    if (mounted.current) setRecording({ phase: 'saved', detail })
  }

  function stopRecording(): Promise<void> {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return Promise.resolve()
    if (mounted.current) {
      setRecording({ phase: 'saving', detail: 'Saving the recording and reading its duration.' })
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        void finishRecording().finally(resolve)
      }
      try {
        recorder.stop()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Recording failed while stopping.'
        failRecording(recordingMediaId.current ?? createId('media'), `${detail} Video evidence is not available.`)
        resolve()
      }
    })
  }

  function detachRecordingTracks(): void {
    for (const track of recordingTracks.current) track.removeEventListener('ended', onRecordingTrackEnded)
    recordingTracks.current = []
  }

  function onRecordingTrackEnded(): void {
    if (recordingSettled.current) return
    registerEvidence('The camera disconnected. Recording stopped. Monitoring was not stopped.')
    void stopRecording()
  }

  function assignRunOffset(ms: number): void {
    runOffsetRef.current = ms
    if (mounted.current) setRunStartOffsetMs(ms)
  }

  function startRecording(): void {
    const stream = streamRef.current
    const mediaId = createId('media')
    recordingMediaId.current = mediaId
    recordingSettled.current = false
    detachRecordingTracks()
    if (!stream || typeof MediaRecorder === 'undefined') {
      failRecording(mediaId, 'This browser cannot record the camera. Video evidence is not available.')
      return
    }
    for (const track of stream.getAudioTracks()) track.enabled = false
    const mime = chooseRecorderMime((type) => MediaRecorder.isTypeSupported(type))
    recorderMime.current = mime
    try {
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      const chunks: Blob[] = []
      chunksRef.current = chunks
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        failRecording(mediaId, 'MediaRecorder reported an error. Video evidence is not available. Monitoring was not stopped.')
        try {
          if (recorder.state !== 'inactive') recorder.stop()
        } catch {
          // The recorder can already be stopped.
        }
      }
      const mediaStart = performance.now()
      recordingStartedAt.current = mediaStart
      recorder.start(1000)
      assignRunOffset(runStartOffsetFromClocks(originRef.current, mediaStart))
      recorderRef.current = recorder
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', onRecordingTrackEnded)
        recordingTracks.current.push(track)
      }
      if (mounted.current) {
        setRecording({
          phase: 'recording',
          detail: `Recording without audio${mime ? ` (${mime})` : ''}. The run clock is separate from the recording clock.`,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording failed to start.'
      failRecording(mediaId, `${message} Video evidence is not available. Monitoring was not stopped.`)
    }
  }

  function setRecordThisRun(enabled: boolean): void {
    if (runningRef.current) return
    recordThisRunRef.current = enabled
    setRecordThisRunState(enabled)
  }

  function setAttachSourceFile(enabled: boolean): void {
    if (runningRef.current) return
    attachSourceRef.current = enabled
    setAttachSourceState(enabled)
  }

  function setProcedureMode(mode: 'six-well' | 'three-cup'): void {
    if (runningRef.current || mode === procedureRef.current) return
    if (mode !== 'three-cup' && reviewOpenRef.current) clearCaptureReview()
    procedureRef.current = mode
    setProcedureModeState(mode)
    setMarkers([])
    resetDetector()
    if (mode === 'three-cup') setRecordThisRun(true)
  }

  function selectCaptureProtocol(id: CaptureProtocolId): void {
    if (runningRef.current || protocolFrozenRef.current) return
    if (id !== 'red-blue-then-green-red' && id !== 'blue-red-then-green-blue') return
    captureProtocolRef.current = id
    setCaptureProtocolId(id)
  }

  function freezeCaptureProtocol(): void {
    protocolFrozenRef.current = true
    setProtocolFrozen(true)
  }

  function openCaptureReview(file: File): void {
    if (procedureRef.current !== 'three-cup' || runningRef.current || !videoRef.current) return
    ignoreVideoErrorRef.current = false
    useVideoFile(file)
    reviewOpenRef.current = true
    setReviewFile({ name: file.name, bytes: file.size })
    freezeCaptureProtocol()
    assignRunOffset(0)
    setMediaNotice(localReviewNotice(file.name, file.size))
    setPlaybackNotice('')
  }

  function clearCaptureReview(): void {
    if (runningRef.current) return
    reviewOpenRef.current = false
    setReviewFile(null)
    protocolFrozenRef.current = false
    setProtocolFrozen(false)
    setMediaNotice('')
    setPlaybackNotice('')
    inputKindRef.current = 'none'
    setInputKind('none')
    const video = videoRef.current
    if (video) {
      ignoreVideoErrorRef.current = true
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    replaceUrl('video', null)
    fileBlobRef.current = null
    setFileName('')
    setCameraPhase('idle')
    setCameraMessage('Camera is off.')
    setPlaybackNote('')
    setRecording({ phase: 'idle', detail: 'Not recording.' })
  }

  function reportPlaybackError(message: string): void {
    if (ignoreVideoErrorRef.current) return
    setPlaybackNotice(message)
  }

  function seekStage(observationTimestamp: number): void {
    const video = videoRef.current
    if (!video || video.error) {
      setPlaybackNotice('Playback is unavailable.')
      return
    }
    if (video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) {
      setPlaybackNotice('The video time is not loaded yet.')
      return
    }
    const seconds = recordingSeekSeconds(observationTimestamp, 0, Math.round(video.duration * 1000))
    if (seconds == null) {
      setPlaybackNotice('That time is outside the recording.')
      return
    }
    try {
      video.currentTime = seconds
      setPlaybackNotice('')
      void video.play().catch(() => setPlaybackNotice('Press play if the browser blocked playback.'))
    } catch {
      setPlaybackNotice('Playback did not move to that time.')
    }
  }

  function addMarker(marker: CaptureMarkerId): void {
    const reviewing = reviewOpenRef.current && inputKindRef.current === 'prerecorded'
    if (procedureRef.current !== 'three-cup' || (!runningRef.current && !reviewing)) return
    const defined = markerDefinition(marker)
    if (!defined) return
    let observationTimestamp = Math.max(0, lastElapsedRef.current)
    if (reviewing) {
      const video = videoRef.current
      if (!video || video.readyState < 1 || !Number.isFinite(video.duration)) {
        setPlaybackNotice('The video time is not loaded yet. The report was not saved.')
        return
      }
      observationTimestamp = Math.round(video.currentTime * 1000)
    }
    const record: CaptureMarkerRecord = {
      id: `marker_${crypto.randomUUID()}`,
      marker,
      observationTimestamp,
      cups: [...defined.cups],
      label: defined.label,
    }
    setMarkers((items) => [...items, record])
    monitorSaver().saveMarker(record)
  }

  function downloadRecording(): void {
    if (!localRecording) return
    downloadBlob(localRecording, 'three-cup-recording.webm')
  }

  function downloadAnnotations(): void {
    const document = annotationDocument({
      sessionId: liveRef.current.sessionId,
      markers,
      runStartOffsetMs: runOffsetRef.current,
      durationMs: recordingDurationRef.current,
      mediaId: recordingMediaId.current,
      captureProtocolId: captureProtocolRef.current,
    })
    downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }), 'three-cup-annotations.json')
  }

  function startClockCheck(): void {
    if (runningRef.current) return
    setProcedureMode('three-cup')
    setRecordThisRun(true)
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const context = canvas.getContext('2d')
    if (!context) return
    releaseCamera(true)
    const stream = canvas.captureStream(15)
    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      void video.play().catch(() => undefined)
    }
    inputKindRef.current = 'live'
    setInputKind('live')
    setFileName('')
    setCameraPhase('live')
    setCameraMessage('Timestamp check. The changing numbers are drawn into the recording. This is not a cup or well reading.')
    const started = performance.now()
    const draw = () => {
      const seconds = (performance.now() - started) / 1000
      context.fillStyle = '#0f172a'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#f8fafc'
      context.font = '28px sans-serif'
      context.fillText('Timestamp check', 36, 70)
      context.font = '72px sans-serif'
      context.fillText(`${seconds.toFixed(2)} s`, 36, 190)
      clockFrameRef.current = window.requestAnimationFrame(draw)
    }
    clockFrameRef.current = window.requestAnimationFrame(draw)
    startRun()
    window.setTimeout(() => {
      if (clockFrameRef.current != null) window.cancelAnimationFrame(clockFrameRef.current)
      clockFrameRef.current = null
      completeRun()
    }, 12000)
  }

  function tickSynthetic(): void {
    if (!runningRef.current) return
    const frames = syntheticFrames.current
    const index = syntheticIndex.current
    const frame = frames[index]
    if (!frame) {
      stopSyntheticClock()
      holdRef.current = true
      if (mounted.current) {
        setPlaybackNote('Synthetic sequence ended. Observations stopped on the last drawn frame. This was not a camera.')
        armSummaryHold()
      }
      return
    }
    if (pausedRef.current || presentationRef.current.paused) return
    syntheticIndex.current = index + 1
    const canvas = canvasRef.current
    if (canvas) drawSyntheticFrame(canvas, frame)
    mediaSizeRef.current = { w: frame.width, h: frame.height }
    ingest(frame.data, frame.width, frame.height, frame.label)
    publishRef.current((index + 1) * SYNTHETIC_FRAME_MS)
  }

  function scheduleSynthetic(): void {
    stopSyntheticClock()
    syntheticTimer.current = window.setInterval(tickSynthetic, SYNTHETIC_FRAME_MS * syntheticPaceRef.current)
  }

  function playSynthetic(): void {
    syntheticIndex.current = 0
    holdRef.current = false
    scheduleSynthetic()
  }

  function setSyntheticPace(pace: 1 | 2 | 4): void {
    syntheticPaceRef.current = pace
    if (mounted.current) setSyntheticPaceState(pace)
    if (syntheticTimer.current != null) scheduleSynthetic()
  }

  function resumeSynthetic(): void {
    if (syntheticTimer.current == null) return
    scheduleSynthetic()
    tickSynthetic()
  }

  function continueDemo(): void {
    if (!presentationRef.current.paused) return
    syncPresentation(continueDemoPlayback(presentationRef.current))
    resumeSynthetic()
  }

  function setPauseOnIssue(enabled: boolean): void {
    const wasPaused = presentationRef.current.paused
    syncPresentation(pausePreference(presentationRef.current, enabled))
    if (wasPaused && !presentationRef.current.paused) resumeSynthetic()
  }

  function resetDetector(): void {
    stabilizer.current.reset()
    emitter.current.reset()
    emitter.current.arm(initialWellStates())
    previousRaw.current = initialWellStates()
    seekBlockedRef.current = false
    pendingSeek.current = false
    holdRef.current = false
    lastElapsedRef.current = 0
    releasePresentation()
    monitorGenerationRef.current += 1
    const generation = monitorGenerationRef.current
    if (mounted.current) {
      setStableStates(initialWellStates())
      setSeekMessage('')
      setEmitted([])
      setTraces([])
      setLocalElapsedMs(0)
      setMonitorGeneration(generation)
      const next = createLiveMonitor(sourceKindFrom(inputKindRef.current), generation)
      liveRef.current = next
      setLive(next)
    }
  }

  function releaseCamera(nextToken: boolean): void {
    if (nextToken) cameraToken.current += 1
    releaseTracks(streamRef.current)
    streamRef.current = null
    const video = videoRef.current
    if (video?.srcObject) video.srcObject = null
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (summaryTimer.current != null) window.clearTimeout(summaryTimer.current)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let raf = 0
    let last = 0
    const loop = (time: number) => {
      if (stopped) return
      raf = requestAnimationFrame(loop)
      if (time - last < SAMPLE_MS) return
      last = time
      loopRef.current()
    }
    raf = requestAnimationFrame(loop)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => {
      const size = mediaSizeRef.current
      const bounds = stage.getBoundingClientRect()
      const rect = containContentRect(bounds.width, bounds.height, size.w, size.h)
      contentRectRef.current = rect
      setContentRect(rect)
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [inputKind])

  useEffect(() => {
    const stage = finalStageRef.current
    if (!stage || !finalUrl) return
    const update = () => {
      const size = finalMediaSizeRef.current
      const bounds = stage.getBoundingClientRect()
      const rect = containContentRect(bounds.width, bounds.height, size.w, size.h)
      finalContentRef.current = rect
      setFinalContentRect(rect)
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    update()
    return () => observer.disconnect()
  }, [finalUrl])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onMeta = () => {
      if (inputKindRef.current === 'synthetic') return
      if (video.videoWidth > 0) {
        mediaSizeRef.current = { w: video.videoWidth, h: video.videoHeight }
        const stage = stageRef.current
        if (stage) {
          const bounds = stage.getBoundingClientRect()
          const rect = containContentRect(bounds.width, bounds.height, video.videoWidth, video.videoHeight)
          contentRectRef.current = rect
          setContentRect(rect)
        }
      }
    }
    const onSeeking = () => {
      if (runningRef.current && inputKindRef.current === 'prerecorded') pendingSeek.current = true
    }
    const onSeeked = () => {
      if (pendingSeek.current) {
        pendingSeek.current = false
        blockSeek()
      }
      lastMediaTime.current = video.currentTime
    }
    const onTime = () => {
      if (inputKindRef.current !== 'prerecorded') return
      if (isBackwardJump(lastMediaTime.current, video.currentTime)) {
        blockSeek()
        return
      }
      lastMediaTime.current = video.currentTime
      if (!runningRef.current || seekBlockedRef.current) return
      const elapsed = prerecordedElapsedMs(video.currentTime, runOffsetRef.current)
      if (elapsed == null) return
      publishRef.current(elapsed)
    }
    const onEnded = () => {
      holdRef.current = true
      if (mounted.current) {
        setPlaybackNote('Video ended. Observations stopped. Playing it again seeks to the start, so start a new run before observing the replay.')
      }
    }
    const onPause = () => {
      if (inputKindRef.current === 'prerecorded' && mounted.current && !video.ended) {
        setPlaybackNote('Video paused. The run clock follows the file, so it holds here.')
      }
    }
    const onPlay = () => {
      if (inputKindRef.current === 'prerecorded' && mounted.current && !seekBlockedRef.current) {
        setPlaybackNote('')
      }
    }
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('resize', onMeta)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('ended', onEnded)
    video.addEventListener('pause', onPause)
    video.addEventListener('play', onPlay)
    return () => {
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('resize', onMeta)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('play', onPlay)
    }
  }, [])

  useEffect(() => {
    if (localPhase !== 'running' || inputKind !== 'live') return
    const id = window.setInterval(() => {
      publishRef.current(liveElapsedMs(performance.now(), originRef.current))
    }, 100)
    return () => window.clearInterval(id)
  }, [localPhase, inputKind])

  useEffect(() => {
    const urls = previewUrls.current
    const streamBox = streamRef
    const recorderBox = recorderRef
    return () => {
      mounted.current = false
      cameraToken.current += 1
      stopSyntheticClock()
      releaseTracks(streamBox.current)
      streamBox.current = null
      const recorder = recorderBox.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          void finishRecording()
        }
        try {
          recorder.stop()
        } catch {
          // The recorder can already be stopping during unmount.
        }
      }
      revokeObjectUrl((url) => URL.revokeObjectURL(url), urls.video)
      revokeObjectUrl((url) => URL.revokeObjectURL(url), urls.final)
    }
  }, [])

  function setObservationPaused(paused: boolean): void {
    pausedRef.current = paused
    setPausedState(paused)
  }

  function setSamplingColor(enabled: boolean): void {
    samplingRef.current = enabled
    setSamplingState(enabled)
  }

  function applyRegions(next: WellRegions): void {
    regionsRef.current = next
    setRegions(next)
  }

  function applyFinalRegions(next: WellRegions): void {
    finalRegionsRef.current = next
    setFinalRegions(next)
    assessmentRef.current = null
    setAssessment(null)
  }

  function beginDrag(target: 'video' | 'final', wellId: WellId, event: ReactPointerEvent<HTMLElement>): void {
    if (target === 'video' && samplingRef.current) return
    if (target === 'final' && !finalSeparateRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { wellId, pointerId: event.pointerId, target }
  }

  function moveDrag(target: 'video' | 'final', event: ReactPointerEvent<HTMLElement>): void {
    const drag = dragRef.current
    if (!drag || drag.target !== target || drag.pointerId !== event.pointerId) return
    const stage = target === 'video' ? stageRef.current : finalStageRef.current
    const content = target === 'video' ? contentRectRef.current : finalContentRef.current
    if (!stage || !content) return
    const bounds = stage.getBoundingClientRect()
    const point = contentPointToNormalized(event.clientX - bounds.left, event.clientY - bounds.top, content)
    if (!point) return
    if (target === 'video') applyRegions(moveRegionCenter(regionsRef.current, drag.wellId, point.x, point.y))
    else applyFinalRegions(moveRegionCenter(finalRegionsRef.current, drag.wellId, point.x, point.y))
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  function acknowledgeOmission(alertId: string, note: string): void {
    const at = Math.max(0, lastElapsedRef.current)
    rememberLive(acknowledgeAlert(liveRef.current, alertId, at, snapshotEvidence(at), note))
  }

  function reportMissed(alertId: string, note: string, reportedState: WellState): void {
    const at = Math.max(0, lastElapsedRef.current)
    rememberLive(
      reportMissedObservation(liveRef.current, alertId, at, snapshotEvidence(at), note, reportedState),
    )
  }

  function continueAfter(alertId: string, note: string): void {
    const at = Math.max(0, lastElapsedRef.current)
    rememberLive(continueAfterCorrection(liveRef.current, alertId, at, snapshotEvidence(at), note))
  }

  function nudge(target: 'video' | 'final', wellId: WellId, dx: number, dy: number): void {
    if (target === 'final' && !finalSeparateRef.current) return
    if (target === 'video') applyRegions(nudgeRegion(regionsRef.current, wellId, dx, dy))
    else applyFinalRegions(nudgeRegion(finalRegionsRef.current, wellId, dx, dy))
  }

  function onStagePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (!samplingRef.current) return
    const stage = stageRef.current
    const content = contentRectRef.current
    const frame = frameRef.current
    if (!stage || !content || !frame) return
    const bounds = stage.getBoundingClientRect()
    const point = contentPointToNormalized(event.clientX - bounds.left, event.clientY - bounds.top, content)
    if (!point) return
    const rgb = readPixel(frame.data, frame.width, frame.height, point.x, point.y)
    if (!rgb) return
    expectedRef.current = rgb
    setExpectedColor(rgb)
    setExpectedLabel('Sampled from the picture')
    setSamplingColor(false)
  }

  function stopCamera(): void {
    if (inputKindRef.current === 'live') endMonitoringSession(SOURCE_CHANGE_MESSAGE)
    releaseCamera(true)
    stopSyntheticClock()
    void stopRecording()
    if (inputKindRef.current === 'live') {
      inputKindRef.current = 'none'
      setInputKind('none')
      mediaSizeRef.current = { w: 0, h: 0 }
      setContentRect(null)
    }
    setCameraPhase('idle')
    setCameraMessage('Camera is off. Tracks were released.')
  }

  function startCamera(): void {
    endMonitoringSession(SOURCE_CHANGE_MESSAGE)
    releasePresentation()
    const token = cameraToken.current + 1
    cameraToken.current = token
    stopSyntheticClock()
    setCameraPhase('starting')
    setCameraMessage('Starting camera…')
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser does not expose a camera API.')
        }
        const stream = await openCamera()
        if (token !== cameraToken.current) {
          releaseTracks(stream)
          return
        }
        const video = videoRef.current
        if (!video) {
          releaseTracks(stream)
          setCameraPhase('failed')
          setCameraMessage('The video element was not available.')
          return
        }
        releaseTracks(streamRef.current)
        streamRef.current = stream
        replaceUrl('video', null)
        fileBlobRef.current = null
        video.pause()
        video.removeAttribute('src')
        video.srcObject = stream
        await video.play()
        if (token !== cameraToken.current) {
          releaseTracks(stream)
          return
        }
        inputKindRef.current = 'live'
        setInputKind('live')
        setFileName('')
        setSyntheticId(null)
        setSyntheticTitle('')
        setCameraPhase('live')
        setCameraMessage('Live camera is on. Processing stays in this browser.')
        setPlaybackNote('')
        mediaSizeRef.current = { w: video.videoWidth, h: video.videoHeight }
      } catch (error) {
        if (token !== cameraToken.current) return
        const copy = cameraErrorCopy(error)
        setCameraPhase(copy.phase)
        setCameraMessage(copy.message)
      }
    })()
  }

  function useVideoFile(file: File): void {
    endMonitoringSession(SOURCE_CHANGE_MESSAGE)
    releasePresentation()
    void stopRecording()
    releaseCamera(true)
    stopSyntheticClock()
    const video = videoRef.current
    if (!video) return
    const url = URL.createObjectURL(file)
    replaceUrl('video', url)
    fileBlobRef.current = file
    setAttachSourceFile(false)
    video.srcObject = null
    video.src = url
    void video.play().catch(() => {
      setPlaybackNote('Press play on the video if the browser blocked autoplay.')
    })
    inputKindRef.current = 'prerecorded'
    setInputKind('prerecorded')
    setFileName(file.name)
    setSyntheticId(null)
    setSyntheticTitle('')
    setCameraPhase('idle')
    setCameraMessage('Camera is off. A prerecorded file is loaded.')
    setPlaybackNote('')
    setRecording({
      phase: 'idle',
      detail: 'The chosen file is the source. This page does not make a second recording.',
    })
  }

  function useSynthetic(id: string): void {
    endMonitoringSession(SOURCE_CHANGE_MESSAGE)
    const sequence = SYNTHETIC_SEQUENCES.find((item) => item.id === id)
    if (!sequence) return
    void stopRecording()
    releaseCamera(true)
    stopSyntheticClock()
    const frames = sequence.build()
    syntheticFrames.current = frames
    syntheticIndex.current = 0
    const first = frames[0]
    const canvas = canvasRef.current
    const nextRegions = defaultWellRegions()
    applyRegions(nextRegions)
    if (first && canvas) {
      drawSyntheticFrame(canvas, first)
      emptyFrameRef.current = first
      mediaSizeRef.current = { w: first.width, h: first.height }
      const reference = emptyReferenceFromBuffer(first.data, first.width, first.height, nextRegions)
      referenceRef.current = reference
      setReferenceLabel('Taken from the first synthetic frame. Not a camera capture.')
      previewMeasurements(first.data, first.width, first.height, first.label)
      const stage = stageRef.current
      if (stage) {
        const bounds = stage.getBoundingClientRect()
        const rect = containContentRect(bounds.width, bounds.height, first.width, first.height)
        contentRectRef.current = rect
        setContentRect(rect)
      }
    }
    inputKindRef.current = 'synthetic'
    setInputKind('synthetic')
    setSyntheticId(id)
    setSyntheticTitle(sequence.title)
    setFileName('')
    setCameraPhase('idle')
    setCameraMessage('Camera is off.')
    setPlaybackNote(sequence.detail)
    setRecording({
      phase: 'idle',
      detail: 'Synthetic sequence. No recording is created, and no video evidence is marked available.',
    })
  }

  function togglePlayback(): void {
    const video = videoRef.current
    if (!video || inputKindRef.current !== 'prerecorded') return
    if (video.paused) void video.play()
    else video.pause()
  }

  function captureReference(): void {
    const source =
      inputKindRef.current === 'synthetic' && emptyFrameRef.current
        ? emptyFrameRef.current
        : frameRef.current
    if (!source) {
      setReferenceLabel('No frame is available to capture.')
      return
    }
    referenceRef.current = emptyReferenceFromBuffer(source.data, source.width, source.height, regionsRef.current)
    setReferenceLabel(
      inputKindRef.current === 'synthetic'
        ? 'Empty-plate reference taken from the first synthetic frame.'
        : 'Empty-plate reference captured from the current frame. Use this only while the wells are empty.',
    )
  }

  function selectPreset(id: ColorPresetId): void {
    const preset = presetById(id)
    expectedRef.current = preset.rgb
    setExpectedColor(preset.rgb)
    setExpectedLabel(preset.label)
    setSamplingColor(false)
  }

  function setWellSize(size: number): void {
    applyRegions(resizeAllRegions(regionsRef.current, size))
  }

  function resetRegions(): void {
    applyRegions(defaultWellRegions())
  }

  function startRun(): void {
    const kind = inputKindRef.current
    if (kind === 'none') return
    if (kind === 'live' && !streamRef.current) return
    if (kind === 'prerecorded' && !fileBlobRef.current) return
    if (runningRef.current) {
      if (!seekBlockedRef.current) return
      runningRef.current = false
      stopSyntheticClock()
    }
    resetDetector()
    clearAssessment()
    lastAnalyzedTime.current = -1
    runningRef.current = true
    originRef.current = performance.now()
    setLocalPhase('running')
    setPlaybackNote('')
    const synthetic = SYNTHETIC_SEQUENCES.find((item) => item.id === syntheticId)
    const source = kind === 'live' ? 'live' : kind === 'prerecorded' ? 'prerecorded' : 'synthetic'
    const title =
      source === 'synthetic'
        ? `Synthetic: ${synthetic?.title ?? 'sequence'}`
        : source === 'live'
          ? 'Live colored-water run'
          : `Prerecorded: ${fileName || 'video'}`
    const notes =
      source === 'synthetic'
        ? `Synthetic sequence "${synthetic?.title ?? 'sequence'}" played through the vision analyzer. Not a camera recording.`
        : source === 'live'
          ? 'Live camera. Readings are heuristic and stay unknown when the picture is unclear.'
          : 'Prerecorded video. Observations use the video clock.'
    const startedAtIso = new Date().toISOString()
    const monitor = liveRef.current
    if (monitor.sourceKind === 'live' || monitor.sourceKind === 'prerecorded' || monitor.sourceKind === 'synthetic') {
      const capture = procedureRef.current === 'three-cup'
      if (capture) freezeCaptureProtocol()
      monitorSaver().open({
        sessionId: monitor.sessionId,
        sourceKind: monitor.sourceKind,
        startedAtIso,
        ...(capture
          ? { procedureId: THREE_CUP_PROCEDURE_ID, captureProtocolId: captureProtocolRef.current }
          : { preparedProtocol: preparedRef.current }),
      })
    }
    callbacksRef.current.onRunStart({
      source,
      title,
      startedAtIso,
      notes,
    })
    callbacksRef.current.onElapsedMs(0)

    if (source === 'prerecorded') {
      const video = videoRef.current
      const file = fileBlobRef.current
      const offset = Math.round((video?.currentTime ?? 0) * 1000)
      assignRunOffset(offset)
      lastMediaTime.current = video?.currentTime ?? 0
      if (file && video) {
        if (attachSourceRef.current) {
          const mediaId = createId('media')
          rememberVisionBlob(mediaId, file)
          void keepLocalMedia(mediaId, file).catch(() => {
            registerEvidence('The imported file is held for this page. This browser did not keep a copy for later.')
          })
          const durationMs = durationMsFromSeconds(video.duration)
          publishMedia(
            prerecordedDraft({
              mediaId,
              mimeType: file.type || undefined,
              runStartOffsetMs: offset,
              durationMs,
              label: `Imported file: ${fileName || 'video'}`,
            }),
          )
          registerEvidence('Imported file attached for this run. It stays in this browser until publication.')
        } else {
          registerEvidence('Imported video is the analysis source. It is not attached for publication.')
        }
        void video.play().catch(() => {
          setPlaybackNote('Press play on the video if the browser blocked autoplay.')
        })
      }
    }

    if (source === 'live') {
      assignRunOffset(0)
      if (recordThisRunRef.current) startRecording()
      else if (mounted.current) {
        setRecording({ phase: 'idle', detail: 'This run is not being recorded.' })
      }
    }

    if (source === 'synthetic') {
      assignRunOffset(0)
      const first = syntheticFrames.current[0]
      if (first) {
        referenceRef.current = emptyReferenceFromBuffer(
          first.data,
          first.width,
          first.height,
          regionsRef.current,
        )
        setReferenceLabel('Empty-plate reference taken from the first synthetic frame at the current regions.')
      }
      setRecording({
        phase: 'idle',
        detail: 'Synthetic sequence. No recording is created, and no video evidence is marked available.',
      })
      playSynthetic()
    }
  }

  function finishSession(): void {
    if (localPhase !== 'completed') return
    monitorSaver().finish()
  }

  function completeRun(): void {
    if (!runningRef.current) return
    runningRef.current = false
    stopSyntheticClock()
    holdRef.current = true
    const elapsed = lastElapsedRef.current
    void (async () => {
      if (inputKindRef.current === 'live') {
        detachRecordingTracks()
        await stopRecording()
      }
      const current = assessmentRef.current
      callbacksRef.current.onRunComplete(
        current
          ? { elapsedMs: elapsed, finalAssessment: { ...current, elapsedMs: elapsed } }
          : { elapsedMs: elapsed },
      )
      if (mounted.current) setLocalPhase('completed')
    })()
  }

  function clearAssessment(): void {
    assessmentRef.current = null
    setAssessment(null)
    setFinalMeasurements([])
  }

  async function rememberFinal(blob: Blob, label: string): Promise<void> {
    const url = URL.createObjectURL(blob)
    replaceUrl('final', url)
    setFinalUrl(url)
    const mediaId = createId('media')
    finalMediaIdRef.current = mediaId
    finalAvailableRef.current = false
    clearAssessment()
    try {
      const image = await loadImage(url)
      finalImageRef.current = image
      finalMediaSizeRef.current = { w: image.naturalWidth, h: image.naturalHeight }
      const stage = finalStageRef.current
      if (stage) {
        const bounds = stage.getBoundingClientRect()
        const rect = containContentRect(bounds.width, bounds.height, image.naturalWidth, image.naturalHeight)
        finalContentRef.current = rect
        setFinalContentRect(rect)
      }
      rememberVisionBlob(mediaId, blob)
      finalAvailableRef.current = true
      publishMedia(
        finalImageDraft({
          mediaId,
          ok: true,
          mimeType: blob.type || 'image/png',
          label,
        }),
      )
      registerEvidence(`${label} Registered as a still image with no duration.`)
      setFinalMessage(`${label} Ready to assess.`)
    } catch {
      finalAvailableRef.current = false
      publishMedia(
        finalImageDraft({
          mediaId,
          ok: false,
          label,
        }),
      )
      registerEvidence('Final image failed to decode. It is not available as evidence.')
      setFinalMessage('The image could not be read. It is not available as evidence.')
    }
  }

  function captureFinalFromVideo(): void {
    if (inputKindRef.current === 'synthetic') {
      const canvas = canvasRef.current
      if (!canvas) {
        setFinalMessage('No synthetic frame is available to capture.')
        return
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          setFinalMessage('The browser could not encode the synthetic frame. Evidence is not available.')
          return
        }
        void rememberFinal(blob, 'Synthetic final frame. Not a camera photo.')
      }, 'image/png')
      return
    }
    const video = videoRef.current
    if (!video || video.videoWidth === 0) {
      setFinalMessage('There is no video frame to capture.')
      return
    }
    const canvas = scratchCanvas()
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setFinalMessage('The browser could not read the video frame.')
      return
    }
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) {
        setFinalMessage('The browser could not encode a still image. Evidence is not available.')
        return
      }
      void rememberFinal(blob, 'Still frame from the current video.')
    }, 'image/png')
  }

  function useFinalFile(file: File): void {
    void rememberFinal(file, `Uploaded final image: ${file.name}`)
  }

  function setFinalSeparate(enabled: boolean): void {
    finalSeparateRef.current = enabled
    setFinalSeparateState(enabled)
    if (enabled) {
      applyFinalRegions(copyRegions(regionsRef.current))
      setFinalReferenceLabel('Framing is separate. Capture an empty reference for this photo or leave empty wells unknown.')
    } else {
      finalReferenceRef.current = null
      setFinalReferenceLabel('Using the video regions and the video empty-plate reference.')
    }
    clearAssessment()
  }

  function captureFinalReference(): void {
    const image = finalImageRef.current
    if (!finalAvailableRef.current || !image) {
      setFinalReferenceLabel('No readable final image is available.')
      return
    }
    const canvas = scratchCanvas()
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    finalReferenceRef.current = emptyReferenceFromBuffer(
      data,
      canvas.width,
      canvas.height,
      finalRegionsRef.current,
    )
    setFinalReferenceLabel('Empty-plate reference captured from this photo. Use it only when the wells in the photo are empty.')
    clearAssessment()
  }

  function assessFinal(): void {
    const image = finalImageRef.current
    if (!finalAvailableRef.current || !image) {
      setFinalMessage('No readable final image is available, so there is no assessment.')
      return
    }
    const canvas = scratchCanvas()
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      setFinalMessage('The browser could not read the image pixels.')
      return
    }
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    const separate = finalSeparateRef.current
    const usedRegions = separate ? finalRegionsRef.current : regionsRef.current
    const reference = separate ? finalReferenceRef.current : referenceRef.current
    const measured = analyzeFrame(
      data,
      canvas.width,
      canvas.height,
      usedRegions,
      { expectedColor: expectedRef.current, emptyReference: reference },
      initialWellStates(),
    )
    const draft = finalAssessmentFromStates(
      lastElapsedRef.current,
      finalMediaIdRef.current ?? undefined,
      measurementStates(measured),
    )
    assessmentRef.current = draft
    setFinalMeasurements(measured)
    setAssessment(draft)
    if (localPhase === 'completed') {
      callbacksRef.current.onRunComplete({ elapsedMs: lastElapsedRef.current, finalAssessment: draft })
    }
    const unknown = draft.wells.filter((well) => well.state === 'unknown').map((well) => well.wellId)
    setFinalMessage(
      unknown.length > 0
        ? `Assessment ready. Unknown stays unknown: ${unknown.join(', ')}.`
        : 'Assessment ready. It is sent when the run completes.',
    )
  }

  return {
    bindVideo,
    bindCanvas,
    bindStage,
    bindFinalStage,
    inputKind,
    inputLabel,
    cameraPhase,
    cameraMessage,
    fileName,
    syntheticId,
    syntheticTitle,
    playbackNote,
    seekMessage,
    observationPaused,
    debugOverlay,
    samplingColor,
    expectedColor,
    expectedLabel,
    referenceLabel,
    regions,
    contentRect,
    measurements,
    stableStates,
    localPhase,
    localElapsedMs,
    recording,
    procedureMode,
    setProcedureMode,
    captureProtocolId,
    protocolFrozen,
    selectCaptureProtocol,
    reviewFile,
    mediaNotice,
    playbackNotice,
    openCaptureReview,
    clearCaptureReview,
    seekStage,
    reportPlaybackError,
    markers,
    addMarker,
    localRecording,
    runStartOffsetMs,
    recordingDurationMs,
    downloadRecording,
    downloadAnnotations,
    startClockCheck,
    recordThisRun,
    setRecordThisRun,
    attachSourceFile,
    setAttachSourceFile,
    evidenceNote,
    emitted,
    traces,
    live,
    saveStatus,
    syntheticPace,
    setSyntheticPace,
    pauseOnIssue,
    setPauseOnIssue,
    demoPaused,
    continueDemo,
    correctionNote,
    summaryHeld,
    sampleMs: SAMPLE_MS,
    lastProcessingMs,
    monitorGeneration,
    observationStatus,
    canStartRun,
    finalUrl,
    finalSeparate,
    finalRegions,
    finalContentRect,
    finalMeasurements,
    assessment,
    finalMessage,
    finalReferenceLabel,
    setObservationPaused,
    setDebugOverlay,
    setSamplingColor,
    setFinalSeparate,
    startCamera,
    stopCamera,
    useVideoFile,
    useSynthetic,
    togglePlayback,
    startRun,
    completeRun,
    finishSession,
    captureReference,
    selectPreset,
    setWellSize,
    resetRegions,
    captureFinalFromVideo,
    useFinalFile,
    captureFinalReference,
    assessFinal,
    onStagePointerDown,
    beginDrag,
    moveDrag,
    endDrag,
    nudge,
    acknowledgeOmission,
    reportMissedObservation: reportMissed,
    continueAfterCorrection: continueAfter,
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function sourceKindFrom(kind: VisionSession['inputKind']): LiveSourceKind {
  if (kind === 'live' || kind === 'prerecorded' || kind === 'synthetic') return kind
  return 'unspecified'
}

async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  } catch (error) {
    const name = typeof error === 'object' && error && 'name' in error ? String(error.name) : ''
    if (name !== 'OverconstrainedError') throw error
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true })
  }
}

function grabVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

function drawSyntheticFrame(canvas: HTMLCanvasElement, frame: SyntheticFrame): void {
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(frame.width, frame.height)
  image.data.set(frame.data)
  context.putImageData(image, 0, 0)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded.'))
    image.src = url
  })
}
