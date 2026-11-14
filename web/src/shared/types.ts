/** Shared serializable contracts. Source of truth for both developers. */

export const WELL_IDS = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'] as const
export type WellId = (typeof WELL_IDS)[number]

/** Predefined filling order: left to right, then the second row. */
export const PROTOCOL_ORDER: readonly WellId[] = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3']

/** Visual 2×3 layout. Row A, then row B. Columns 1, 2, 3. */
export const WELL_GRID: readonly (readonly WellId[])[] = [
  ['A1', 'A2', 'A3'],
  ['B1', 'B2', 'B3'],
]

export const WELL_STATES = ['empty', 'filled', 'unknown'] as const
export type WellState = (typeof WELL_STATES)[number]

export const RUN_SOURCES = ['live', 'prerecorded', 'synthetic'] as const
export type RunSource = (typeof RUN_SOURCES)[number]

export const RUN_PHASES = ['idle', 'running', 'completed'] as const
export type RunPhase = (typeof RUN_PHASES)[number]

export const HUMAN_EVENT_KINDS = [
  'omission_acknowledged',
  'omission_resolved',
  'correction_note',
] as const
export type HumanEventKind = (typeof HUMAN_EVENT_KINDS)[number]

export const OMISSION_STATUSES = ['open', 'acknowledged', 'resolved'] as const
export type OmissionStatus = (typeof OMISSION_STATUSES)[number]

export const MEDIA_KINDS = [
  'camera_recording',
  'prerecorded_source',
  'final_plate_image',
] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const ID_PREFIX = {
  run: 'run_',
  observation: 'obs_',
  humanEvent: 'evt_',
  alert: 'alert_',
  media: 'media_',
  finalAssessment: 'final_',
} as const

export type IdKind = keyof typeof ID_PREFIX

export type RunId = string
export type ObservationId = string
export type EventId = string
export type AlertId = string
export type MediaId = string
export type FinalAssessmentId = string

/**
 * Integer milliseconds since run start (t = 0).
 * This is not a wall-clock timestamp and not a MediaRecorder chunk index.
 */
export type ElapsedMs = number

export interface WellReading {
  wellId: WellId
  state: WellState
}

/** Stable camera snapshot. Vision emits these; review stores them unchanged. */
export interface Observation {
  id: ObservationId
  runId: RunId
  elapsedMs: ElapsedMs
  wells: readonly WellReading[]
}

/** Payload from Monitor before review assigns id and runId. */
export interface ObservationDraft {
  elapsedMs: ElapsedMs
  wells: readonly WellReading[]
}

/**
 * Pointer into a media file. The file bytes live outside JSON.
 * File position in ms is runStartOffsetMs + elapsedMs.
 */
export interface EvidenceRef {
  mediaId: MediaId
  elapsedMs: ElapsedMs
  windowMs?: number
  label?: string
}

/** Something a person reported. Distinct from camera observations. */
export interface HumanEvent {
  id: EventId
  runId: RunId
  elapsedMs: ElapsedMs
  kind: HumanEventKind
  wellId?: WellId
  alertId?: AlertId
  note?: string
  /** Human claim only. Does not overwrite camera well states. */
  reportedState?: WellState
  evidence?: EvidenceRef
}

export interface HumanEventDraft {
  kind: HumanEventKind
  elapsedMs?: ElapsedMs
  wellId?: WellId
  alertId?: AlertId
  note?: string
  reportedState?: WellState
  evidence?: EvidenceRef
}

/** Possible skipped well. Status changes are append-only updates, not deletions. */
export interface OmissionAlert {
  id: AlertId
  runId: RunId
  wellId: WellId
  protocolIndex: number
  raisedAtElapsedMs: ElapsedMs
  status: OmissionStatus
  sourceObservationId: ObservationId
  acknowledgedEventId?: EventId
  resolvedEventId?: EventId
}

/**
 * JSON description of a media object. Never include a Blob, File, or data URL.
 * `runStartOffsetMs` is the media time of run t = 0.
 * Positive: the run starts that far into the file.
 * Zero: media time 0 is run start.
 * Negative: the run clock started before the media did.
 */
export interface MediaAvailability {
  mediaId: MediaId
  runId: RunId
  kind: MediaKind
  available: boolean
  mimeType?: string
  runStartOffsetMs: number
  /** Measured media length when known. Omit for still images. */
  durationMs?: number
  label: string
}

/** Monitor already chose mediaId so it can key a local blob map. */
export interface MediaDraft {
  mediaId: MediaId
  kind: MediaKind
  available: boolean
  mimeType?: string
  runStartOffsetMs: number
  durationMs?: number
  label: string
}

export interface FinalWellAssessment {
  wellId: WellId
  state: WellState
  /** The protocol expects every well to be filled by the end of the run. */
  matchesExpectedFilled: boolean
}

export interface FinalPlateAssessment {
  id: FinalAssessmentId
  runId: RunId
  elapsedMs: ElapsedMs
  mediaId?: MediaId
  wells: readonly FinalWellAssessment[]
}

export interface FinalPlateDraft {
  elapsedMs: ElapsedMs
  mediaId?: MediaId
  wells: readonly FinalWellAssessment[]
}

export interface RunMetadata {
  id: RunId
  source: RunSource
  title: string
  /** Display only. Ordering and evidence use elapsedMs. */
  startedAtIso?: string
  protocolOrder: readonly WellId[]
  /**
   * True only for authored fixtures.
   * Live and prerecorded runs must set this to false.
   */
  syntheticFixture: boolean
  notes?: string
}

export interface RunStartDraft {
  source: RunSource
  title: string
  startedAtIso?: string
  protocolOrder?: readonly WellId[]
  notes?: string
}

export interface RunCompletion {
  elapsedMs: ElapsedMs
  finalAssessment?: FinalPlateDraft
}

/** Persisted JSON for one run. Blobs are stored separately, keyed by mediaId. */
export interface RunRecord {
  metadata: RunMetadata
  observations: readonly Observation[]
  humanEvents: readonly HumanEvent[]
  alerts: readonly OmissionAlert[]
  media: readonly MediaAvailability[]
  finalAssessment?: FinalPlateAssessment
}

/** What both panels render. Review owns updates; Monitor and Review only read it. */
export interface ProtocolState {
  phase: RunPhase
  metadata: RunMetadata | null
  elapsedMs: ElapsedMs
  /**
   * First protocol well that is not confirmed filled.
   * Null when no run is active, or when every well is filled.
   * Use `phase` to tell those cases apart.
   */
  expectedWellId: WellId | null
  wellStates: Readonly<Record<WellId, WellState>>
  observations: readonly Observation[]
  humanEvents: readonly HumanEvent[]
  alerts: readonly OmissionAlert[]
  media: readonly MediaAvailability[]
  finalAssessment?: FinalPlateAssessment
}

export interface MonitorProps {
  protocol: ProtocolState
  onRunStart: (draft: RunStartDraft) => void
  onElapsedMs: (elapsedMs: ElapsedMs) => void
  onObservation: (draft: ObservationDraft) => void
  onMediaAvailable: (media: MediaDraft) => void
  onRunComplete: (completion: RunCompletion) => void
}

export interface ReviewProps {
  protocol: ProtocolState
  onAcknowledgeOmission: (alertId: AlertId) => void
  onResolveOmission: (alertId: AlertId, note?: string) => void
  onAddHumanEvent: (draft: HumanEventDraft) => void
  onLoadRun: (record: RunRecord) => void
}

/**
 * Return type of useReviewController.
 * The review developer implements the behavior; App only calls these methods.
 */
export interface ReviewController {
  protocol: ProtocolState
  startRun: (draft: RunStartDraft) => void
  updateElapsedMs: (elapsedMs: ElapsedMs) => void
  recordObservation: (draft: ObservationDraft) => void
  registerMedia: (media: MediaDraft) => void
  completeRun: (completion: RunCompletion) => void
  acknowledgeOmission: (alertId: AlertId) => void
  resolveOmission: (alertId: AlertId, note?: string) => void
  addHumanEvent: (draft: HumanEventDraft) => void
  loadRun: (record: RunRecord) => void
}
