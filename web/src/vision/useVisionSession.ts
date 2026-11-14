import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createId, initialWellStates } from '../shared/protocol.ts'
import {
  type FinalPlateDraft,
  type MonitorProps,
  type ObservationDraft,
  type WellId,
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
import { ObservationEmitter, ReadingStabilizer } from './stabilize.ts'
import { SYNTHETIC_SEQUENCES, type SyntheticFrame } from './synthetic.ts'

const SAMPLE_MS = 140
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
  startCamera: () => void
  stopCamera: () => void
  useVideoFile: (file: File) => void
  useSynthetic: (id: string) => void
  togglePlayback: () => void
  startRun: () => void
  completeRun: () => void
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
}

type Callbacks = Pick<
  MonitorProps,
  'onRunStart' | 'onElapsedMs' | 'onObservation' | 'onMediaAvailable' | 'onRunComplete'
>

export function useVisionSession(callbacks: Callbacks): VisionSession {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const finalStageRef = useRef<HTMLDivElement | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraToken = useRef(0)
  const callbacksRef = useRef(callbacks)
  const mounted = useRef(true)
  const frameRef = useRef<SyntheticFrame | null>(null)
  const emptyFrameRef = useRef<SyntheticFrame | null>(null)
  const previousRaw = useRef(initialWellStates())
  const stabilizer = useRef(new ReadingStabilizer(STABLE_FRAMES))
  const emitter = useRef(new ObservationEmitter())
  const originRef = useRef(0)
  const lastElapsedRef = useRef(0)
  const runOffsetRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recorderMime = useRef<string | undefined>(undefined)
  const recordingMediaId = useRef<string | null>(null)
  const recordingSettled = useRef(false)
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
  const [debugOverlay, setDebugOverlay] = useState(true)
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
  const [evidenceNote, setEvidenceNote] = useState('No evidence has been registered in this visit.')
  const [emitted, setEmitted] = useState<ObservationDraft[]>([])
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
    ? 'Blocked after seek'
    : observationPaused
      ? 'Observations paused'
      : localPhase === 'running'
        ? 'Observing'
        : localPhase === 'completed'
          ? 'Run completed'
          : 'Idle'

  const canStartRun =
    localPhase !== 'running' &&
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

  function publish(elapsed: number): void {
    if (!runningRef.current || seekBlockedRef.current) return
    const next = monotonicElapsed(elapsed, lastElapsedRef.current)
    if (next !== lastElapsedRef.current) {
      lastElapsedRef.current = next
      if (mounted.current) setLocalElapsedMs(next)
      callbacksRef.current.onElapsedMs(next)
    }
    if (pausedRef.current || holdRef.current) return
    const draft = emitter.current.consider(next, stabilizer.current.snapshot())
    if (!draft) return
    callbacksRef.current.onObservation(draft)
    if (mounted.current) setEmitted((items) => [...items.slice(-7), draft])
  }

  function ingest(data: Uint8ClampedArray, width: number, height: number, label: string): void {
    frameRef.current = { data, width, height, label }
    const measured = analyzeFrame(
      data,
      width,
      height,
      regionsRef.current,
      { expectedColor: expectedRef.current, emptyReference: referenceRef.current },
      previousRaw.current,
    )
    previousRaw.current = measurementStates(measured)
    if (!mounted.current) return
    setMeasurements(measured)
    if (!runningRef.current) return
    const stable = stabilizer.current.push(previousRaw.current)
    setStableStates(stable.states)
  }

  function previewMeasurements(data: Uint8ClampedArray, width: number, height: number, label: string): void {
    frameRef.current = { data, width, height, label }
    const measured = analyzeFrame(
      data,
      width,
      height,
      regionsRef.current,
      { expectedColor: expectedRef.current, emptyReference: referenceRef.current },
      initialWellStates(),
    )
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
  }

  function registerEvidence(note: string): void {
    if (mounted.current) setEvidenceNote(note)
  }

  function failRecording(mediaId: string, detail: string): void {
    if (recordingSettled.current) return
    recordingSettled.current = true
    callbacksRef.current.onMediaAvailable(
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
    const durationMs = await measureVideoDuration(blob)
    rememberVisionBlob(mediaId, blob)
    callbacksRef.current.onMediaAvailable(
      cameraRecordingDraft({
        mediaId,
        ok: true,
        mimeType: blob.type || mime,
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

  function startRecording(): void {
    const stream = streamRef.current
    const mediaId = createId('media')
    recordingMediaId.current = mediaId
    recordingSettled.current = false
    if (!stream || typeof MediaRecorder === 'undefined') {
      failRecording(mediaId, 'This browser cannot record the camera. Video evidence is not available.')
      return
    }
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
        failRecording(mediaId, 'MediaRecorder reported an error. Video evidence is not available.')
      }
      const mediaStart = performance.now()
      recorder.start(1000)
      runOffsetRef.current = runStartOffsetFromClocks(originRef.current, mediaStart)
      recorderRef.current = recorder
      if (mounted.current) {
        setRecording({
          phase: 'recording',
          detail: `Recording locally${mime ? ` (${mime})` : ''}. Chunk arrival is not the run clock.`,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recording failed to start.'
      failRecording(mediaId, `${message} Video evidence is not available.`)
    }
  }

  function playSynthetic(): void {
    stopSyntheticClock()
    syntheticIndex.current = 0
    holdRef.current = false
    syntheticTimer.current = window.setInterval(() => {
      if (!runningRef.current) return
      const frames = syntheticFrames.current
      const index = syntheticIndex.current
      const frame = frames[index]
      if (!frame) {
        stopSyntheticClock()
        holdRef.current = true
        if (mounted.current) {
          setPlaybackNote('Synthetic sequence ended. Observations stopped on the last drawn frame. This was not a camera.')
        }
        return
      }
      if (pausedRef.current) return
      syntheticIndex.current = index + 1
      const canvas = canvasRef.current
      if (canvas) drawSyntheticFrame(canvas, frame)
      mediaSizeRef.current = { w: frame.width, h: frame.height }
      ingest(frame.data, frame.width, frame.height, frame.label)
      publishRef.current((index + 1) * SYNTHETIC_FRAME_MS)
    }, SYNTHETIC_FRAME_MS)
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
    if (mounted.current) {
      setStableStates(initialWellStates())
      setSeekMessage('')
      setEmitted([])
      setLocalElapsedMs(0)
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
    void stopRecording()
    releaseCamera(true)
    stopSyntheticClock()
    const video = videoRef.current
    if (!video) return
    const url = URL.createObjectURL(file)
    replaceUrl('video', url)
    fileBlobRef.current = file
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
    if (runningRef.current) return
    const kind = inputKindRef.current
    if (kind === 'none') return
    if (kind === 'live' && !streamRef.current) return
    if (kind === 'prerecorded' && !fileBlobRef.current) return
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
    callbacksRef.current.onRunStart({
      source,
      title,
      startedAtIso: new Date().toISOString(),
      notes,
    })
    callbacksRef.current.onElapsedMs(0)

    if (source === 'prerecorded') {
      const video = videoRef.current
      const file = fileBlobRef.current
      const offset = Math.round((video?.currentTime ?? 0) * 1000)
      runOffsetRef.current = offset
      lastMediaTime.current = video?.currentTime ?? 0
      if (file && video) {
        const mediaId = createId('media')
        rememberVisionBlob(mediaId, file)
        const durationMs = durationMsFromSeconds(video.duration)
        callbacksRef.current.onMediaAvailable(
          prerecordedDraft({
            mediaId,
            mimeType: file.type || undefined,
            runStartOffsetMs: offset,
            durationMs,
            label: `Prerecorded file: ${fileName || 'video'}`,
          }),
        )
        registerEvidence('Prerecorded file registered. Bytes stay in this browser session.')
        void video.play().catch(() => {
          setPlaybackNote('Press play on the video if the browser blocked autoplay.')
        })
      }
    }

    if (source === 'live') {
      runOffsetRef.current = 0
      startRecording()
    }

    if (source === 'synthetic') {
      runOffsetRef.current = 0
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

  function completeRun(): void {
    if (!runningRef.current) return
    runningRef.current = false
    stopSyntheticClock()
    holdRef.current = true
    const elapsed = lastElapsedRef.current
    void (async () => {
      if (inputKindRef.current === 'live') await stopRecording()
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
      callbacksRef.current.onMediaAvailable(
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
      callbacksRef.current.onMediaAvailable(
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
    evidenceNote,
    emitted,
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
  }
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
