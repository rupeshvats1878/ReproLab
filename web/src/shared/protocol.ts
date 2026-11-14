import {
  HUMAN_EVENT_KINDS,
  ID_PREFIX,
  MEDIA_KINDS,
  OMISSION_STATUSES,
  PROTOCOL_ORDER,
  RUN_SOURCES,
  WELL_IDS,
  WELL_STATES,
  type ElapsedMs,
  type EvidenceRef,
  type HumanEvent,
  type IdKind,
  type MediaAvailability,
  type Observation,
  type OmissionAlert,
  type ProtocolState,
  type RunPhase,
  type RunRecord,
  type WellId,
  type WellReading,
  type WellState,
} from './types.ts'

export function initialWellStates(): Record<WellId, WellState> {
  return {
    A1: 'unknown',
    A2: 'unknown',
    A3: 'unknown',
    B1: 'unknown',
    B2: 'unknown',
    B3: 'unknown',
  }
}

export const IDLE_PROTOCOL: ProtocolState = {
  phase: 'idle',
  metadata: null,
  elapsedMs: 0,
  expectedWellId: null,
  wellStates: initialWellStates(),
  observations: [],
  humanEvents: [],
  alerts: [],
  media: [],
}

export function createId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}${globalThis.crypto.randomUUID()}`
}

/**
 * File position of a run-clock instant.
 * Does not assume MediaRecorder timeslice boundaries.
 */
export function evidenceOffsetMs(runStartOffsetMs: number, elapsedMs: ElapsedMs): number {
  return runStartOffsetMs + elapsedMs
}

/**
 * Whether a run-clock instant can be shown from this media.
 * Still images have no timeline: any elapsed time matches the whole image
 * when the bytes are available.
 * A missing duration does not reject the timestamp.
 */
export function evidenceIsCovered(
  media: Pick<MediaAvailability, 'available' | 'kind' | 'runStartOffsetMs' | 'durationMs'>,
  elapsedMs: ElapsedMs,
): boolean {
  if (!media.available) return false
  if (media.kind === 'final_plate_image') return true
  const offset = evidenceOffsetMs(media.runStartOffsetMs, elapsedMs)
  if (offset < 0) return false
  if (media.durationMs == null) return true
  return offset <= media.durationMs
}

/** Latest camera reading per well. Human events do not change this map. */
export function foldWellStates(
  observations: readonly Observation[],
): Record<WellId, WellState> {
  const states = initialWellStates()
  for (const observation of observations) {
    for (const reading of observation.wells) {
      states[reading.wellId] = reading.state
    }
  }
  return states
}

/** First well in order that the camera has not confirmed filled. */
export function expectedWellId(
  order: readonly WellId[],
  states: Readonly<Record<WellId, WellState>>,
): WellId | null {
  return order.find((wellId) => states[wellId] !== 'filled') ?? null
}

/**
 * Possible skips at one snapshot.
 * A later protocol well is filled while an earlier well is still empty or unknown.
 * This does not create, acknowledge, or resolve alerts.
 */
export function listPossibleOmissions(
  order: readonly WellId[],
  wells: readonly WellReading[],
): WellId[] {
  const byWell = new Map(wells.map((reading) => [reading.wellId, reading.state]))
  let furthestFilled = -1
  order.forEach((wellId, index) => {
    if (byWell.get(wellId) === 'filled') furthestFilled = index
  })
  if (furthestFilled < 0) return []

  const omitted: WellId[] = []
  for (let index = 0; index < furthestFilled; index += 1) {
    const wellId = order[index]
    if (wellId && byWell.get(wellId) !== 'filled') omitted.push(wellId)
  }
  return omitted
}

/** Protocol view for a saved record. Live runs keep the controller clock instead. */
export function protocolStateFromRecord(
  record: RunRecord,
  phase: RunPhase = 'completed',
): ProtocolState {
  const wellStates = foldWellStates(record.observations)
  return {
    phase,
    metadata: record.metadata,
    elapsedMs: latestElapsed(record),
    expectedWellId:
      phase === 'idle' ? null : expectedWellId(record.metadata.protocolOrder, wellStates),
    wellStates,
    observations: record.observations,
    humanEvents: record.humanEvents,
    alerts: record.alerts,
    media: record.media,
    finalAssessment: record.finalAssessment,
  }
}

export function validateRunRecord(record: RunRecord): string[] {
  const errors: string[] = []
  const seen = new Set<string>()

  checkId(errors, seen, record.metadata.id, 'metadata', 'run')
  if (!RUN_SOURCES.includes(record.metadata.source)) {
    errors.push('metadata.source is not a known run source')
  }
  if (record.metadata.source === 'synthetic') {
    if (!record.metadata.syntheticFixture) {
      errors.push('synthetic runs must set syntheticFixture')
    }
    if (!record.metadata.notes?.startsWith('Synthetic')) {
      errors.push('synthetic runs must label notes with Synthetic')
    }
  } else if (record.metadata.syntheticFixture) {
    errors.push('live and prerecorded runs must not set syntheticFixture')
  }
  if (!sameProtocol(record.metadata.protocolOrder)) {
    errors.push('metadata.protocolOrder must be A1, A2, A3, B1, B2, B3')
  }

  record.observations.forEach((observation, index) => {
    checkObservation(errors, seen, record, observation, index)
  })
  checkMonotonic(
    errors,
    'observations',
    record.observations.map((observation) => observation.elapsedMs),
  )

  record.humanEvents.forEach((event, index) => {
    checkHumanEvent(errors, seen, record, event, index)
  })
  checkMonotonic(
    errors,
    'humanEvents',
    record.humanEvents.map((event) => event.elapsedMs),
  )

  const mediaIds = new Set(record.media.map((media) => media.mediaId))
  record.media.forEach((media, index) => {
    checkMedia(errors, seen, record.metadata.id, media, index)
  })

  const alertsById = new Map<string, OmissionAlert>()
  const alertWells = new Set<WellId>()
  record.alerts.forEach((alert, index) => {
    checkAlert(errors, seen, record, alert, index, alertsById, alertWells)
  })

  record.humanEvents.forEach((event, index) => {
    if (!event.evidence) return
    checkEvidence(errors, event.evidence, mediaIds, `humanEvents[${index}]`)
    if (event.alertId && !alertsById.has(event.alertId)) {
      errors.push(`humanEvents[${index}] references an unknown alert`)
    }
  })

  if (record.finalAssessment) {
    checkFinal(errors, seen, record, mediaIds)
  }

  return errors
}

function latestElapsed(record: RunRecord): ElapsedMs {
  const times = [
    record.finalAssessment?.elapsedMs,
    ...record.observations.map((observation) => observation.elapsedMs),
    ...record.humanEvents.map((event) => event.elapsedMs),
  ].filter((value): value is number => value != null)
  return times.length === 0 ? 0 : Math.max(...times)
}

function sameProtocol(order: readonly WellId[]): boolean {
  return (
    order.length === PROTOCOL_ORDER.length &&
    order.every((wellId, index) => wellId === PROTOCOL_ORDER[index])
  )
}

function checkId(
  errors: string[],
  seen: Set<string>,
  id: string,
  label: string,
  kind: IdKind,
): void {
  if (!id.startsWith(ID_PREFIX[kind])) {
    errors.push(`${label} id must start with ${ID_PREFIX[kind]}`)
  }
  if (seen.has(id)) errors.push(`${label} id is duplicated: ${id}`)
  seen.add(id)
}

function checkElapsed(errors: string[], label: string, elapsedMs: number): void {
  if (!Number.isInteger(elapsedMs) || elapsedMs < 0) {
    errors.push(`${label} elapsedMs must be a non-negative integer`)
  }
}

function checkMonotonic(errors: string[], label: string, values: readonly number[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]
    const current = values[index]
    if (previous != null && current != null && current <= previous) {
      errors.push(`${label} elapsedMs must increase strictly`)
      return
    }
  }
}

function checkWells(
  errors: string[],
  label: string,
  wells: readonly { wellId: WellId; state: WellState }[],
): void {
  const ids = wells.map((well) => well.wellId)
  const unique = new Set(ids)
  const complete = WELL_IDS.every((wellId) => unique.has(wellId))
  if (ids.length !== WELL_IDS.length || unique.size !== WELL_IDS.length || !complete) {
    errors.push(`${label} must include each well exactly once`)
  }
  for (const well of wells) {
    if (!WELL_STATES.includes(well.state)) {
      errors.push(`${label} has a well state that is not empty, filled, or unknown`)
    }
  }
}

function checkObservation(
  errors: string[],
  seen: Set<string>,
  record: RunRecord,
  observation: Observation,
  index: number,
): void {
  const label = `observations[${index}]`
  checkId(errors, seen, observation.id, label, 'observation')
  if (observation.runId !== record.metadata.id) errors.push(`${label} runId does not match`)
  checkElapsed(errors, label, observation.elapsedMs)
  checkWells(errors, label, observation.wells)
}

function checkHumanEvent(
  errors: string[],
  seen: Set<string>,
  record: RunRecord,
  event: HumanEvent,
  index: number,
): void {
  const label = `humanEvents[${index}]`
  checkId(errors, seen, event.id, label, 'humanEvent')
  if (event.runId !== record.metadata.id) errors.push(`${label} runId does not match`)
  checkElapsed(errors, label, event.elapsedMs)
  if (!HUMAN_EVENT_KINDS.includes(event.kind)) errors.push(`${label} kind is unknown`)
  if (event.kind === 'omission_acknowledged' || event.kind === 'omission_resolved') {
    if (!event.alertId) errors.push(`${label} requires alertId`)
    if (!event.wellId) errors.push(`${label} requires wellId`)
  }
  if (event.reportedState && !WELL_STATES.includes(event.reportedState)) {
    errors.push(`${label} reportedState is unknown`)
  }
  if (event.evidence) checkElapsed(errors, `${label} evidence`, event.evidence.elapsedMs)
}

function checkMedia(
  errors: string[],
  seen: Set<string>,
  runId: string,
  media: MediaAvailability,
  index: number,
): void {
  const label = `media[${index}]`
  checkId(errors, seen, media.mediaId, label, 'media')
  if (media.runId !== runId) errors.push(`${label} runId does not match`)
  if (!MEDIA_KINDS.includes(media.kind)) errors.push(`${label} kind is unknown`)
  if (!Number.isInteger(media.runStartOffsetMs)) {
    errors.push(`${label} runStartOffsetMs must be an integer`)
  }
  if (media.durationMs != null && (!Number.isInteger(media.durationMs) || media.durationMs < 0)) {
    errors.push(`${label} durationMs must be a non-negative integer`)
  }
  if (media.kind === 'final_plate_image') {
    if (media.runStartOffsetMs !== 0) {
      errors.push(`${label} still image must use runStartOffsetMs 0`)
    }
    if (media.durationMs != null) {
      errors.push(`${label} still image must omit durationMs`)
    }
  }
  if (!media.label.trim()) errors.push(`${label} label is required`)
}

function checkEvidence(
  errors: string[],
  evidence: EvidenceRef,
  mediaIds: Set<string>,
  label: string,
): void {
  if (!mediaIds.has(evidence.mediaId)) errors.push(`${label} evidence mediaId is unknown`)
  if (evidence.windowMs != null && (!Number.isInteger(evidence.windowMs) || evidence.windowMs <= 0)) {
    errors.push(`${label} evidence windowMs must be a positive integer`)
  }
}

function checkAlert(
  errors: string[],
  seen: Set<string>,
  record: RunRecord,
  alert: OmissionAlert,
  index: number,
  alertsById: Map<string, OmissionAlert>,
  alertWells: Set<WellId>,
): void {
  const label = `alerts[${index}]`
  checkId(errors, seen, alert.id, label, 'alert')
  alertsById.set(alert.id, alert)
  if (alert.runId !== record.metadata.id) errors.push(`${label} runId does not match`)
  if (!WELL_IDS.includes(alert.wellId)) errors.push(`${label} wellId is unknown`)
  if (alertWells.has(alert.wellId)) errors.push(`${label} duplicates a well that already has an alert`)
  alertWells.add(alert.wellId)
  if (record.metadata.protocolOrder[alert.protocolIndex] !== alert.wellId) {
    errors.push(`${label} protocolIndex does not match wellId`)
  }
  checkElapsed(errors, label, alert.raisedAtElapsedMs)
  if (!OMISSION_STATUSES.includes(alert.status)) errors.push(`${label} status is unknown`)

  const source = record.observations.find((observation) => observation.id === alert.sourceObservationId)
  if (!source) {
    errors.push(`${label} source observation is missing`)
  } else if (source.elapsedMs !== alert.raisedAtElapsedMs) {
    errors.push(`${label} raisedAtElapsedMs must match the source observation`)
  } else if (!listPossibleOmissions(record.metadata.protocolOrder, source.wells).includes(alert.wellId)) {
    errors.push(`${label} source observation does not show that well as a possible omission`)
  }

  const acknowledged = findEvent(record, alert.acknowledgedEventId)
  const resolved = findEvent(record, alert.resolvedEventId)
  if (alert.status === 'open') {
    if (alert.acknowledgedEventId || alert.resolvedEventId) {
      errors.push(`${label} open alerts cannot reference human events`)
    }
  }
  if (alert.status === 'acknowledged') {
    if (!acknowledged || acknowledged.kind !== 'omission_acknowledged') {
      errors.push(`${label} acknowledged status requires an acknowledgement event`)
    }
    if (alert.resolvedEventId) errors.push(`${label} acknowledged alerts are not resolved`)
  }
  if (alert.status === 'resolved') {
    if (!resolved || resolved.kind !== 'omission_resolved') {
      errors.push(`${label} resolved status requires a resolution event`)
    }
  }
  if (acknowledged && acknowledged.elapsedMs < alert.raisedAtElapsedMs) {
    errors.push(`${label} acknowledgement is earlier than the alert`)
  }
  if (resolved && acknowledged && resolved.elapsedMs < acknowledged.elapsedMs) {
    errors.push(`${label} resolution is earlier than the acknowledgement`)
  }
  if (resolved && resolved.elapsedMs < alert.raisedAtElapsedMs) {
    errors.push(`${label} resolution is earlier than the alert`)
  }
}

function findEvent(record: RunRecord, eventId: string | undefined): HumanEvent | undefined {
  if (!eventId) return undefined
  return record.humanEvents.find((event) => event.id === eventId)
}

function checkFinal(
  errors: string[],
  seen: Set<string>,
  record: RunRecord,
  mediaIds: Set<string>,
): void {
  const finalAssessment = record.finalAssessment
  if (!finalAssessment) return
  checkId(errors, seen, finalAssessment.id, 'finalAssessment', 'finalAssessment')
  if (finalAssessment.runId !== record.metadata.id) {
    errors.push('finalAssessment runId does not match')
  }
  checkElapsed(errors, 'finalAssessment', finalAssessment.elapsedMs)
  checkWells(errors, 'finalAssessment', finalAssessment.wells)
  for (const well of finalAssessment.wells) {
    const matches = well.state === 'filled'
    if (well.matchesExpectedFilled !== matches) {
      errors.push(`finalAssessment ${well.wellId} mismatches matchesExpectedFilled`)
    }
  }
  if (!finalAssessment.mediaId) return
  if (!mediaIds.has(finalAssessment.mediaId)) {
    errors.push('finalAssessment mediaId is unknown')
  }
  const media = record.media.find((item) => item.mediaId === finalAssessment.mediaId)
  if (media && media.kind !== 'final_plate_image') {
    errors.push('finalAssessment mediaId must reference a final plate image')
  }
}
