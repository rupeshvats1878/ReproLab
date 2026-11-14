import {
  IDLE_PROTOCOL,
  createId,
  expectedWellId,
  foldWellStates,
  initialWellStates,
  listPossibleOmissions,
  protocolStateFromRecord,
} from '../shared/protocol.ts'
import type {
  ElapsedMs,
  EvidenceRef,
  HumanEvent,
  HumanEventDraft,
  MediaDraft,
  Observation,
  ObservationDraft,
  ProtocolState,
  RunCompletion,
  RunRecord,
  RunStartDraft,
  WellId,
} from '../shared/types.ts'
import { PROTOCOL_ORDER } from '../shared/types.ts'

export const SKIPPED_NOTE = 'Yes, I skipped it.'
export const CAMERA_MISSED_NOTE = 'I completed it; the camera missed it.'
export const LEAVE_UNRESOLVED_NOTE = 'Leave unresolved and continue.'
export const CORRECTION_TEXT = 'Fill the omitted well, then verify.'

export interface ReviewState {
  protocol: ProtocolState
}

export type ReviewAction =
  | { type: 'startRun'; draft: RunStartDraft }
  | { type: 'updateElapsedMs'; elapsedMs: ElapsedMs }
  | { type: 'recordObservation'; draft: ObservationDraft }
  | { type: 'registerMedia'; media: MediaDraft }
  | { type: 'completeRun'; completion: RunCompletion }
  | { type: 'acknowledgeOmission'; alertId: string }
  | { type: 'resolveOmission'; alertId: string; note?: string }
  | { type: 'addHumanEvent'; draft: HumanEventDraft }
  | { type: 'loadRun'; record: RunRecord }

export function createReviewState(): ReviewState {
  return { protocol: IDLE_PROTOCOL }
}

export function reduceReview(state: ReviewState, action: ReviewAction): ReviewState {
  return { protocol: apply(state.protocol, action) }
}

export function runRecordFromState(state: ReviewState): RunRecord | null {
  const { protocol } = state
  if (!protocol.metadata) return null
  return {
    metadata: protocol.metadata,
    observations: protocol.observations,
    humanEvents: protocol.humanEvents,
    alerts: protocol.alerts,
    media: protocol.media,
    finalAssessment: protocol.finalAssessment,
  }
}

function apply(protocol: ProtocolState, action: ReviewAction): ProtocolState {
  switch (action.type) {
    case 'startRun':
      return startRun(action.draft)
    case 'updateElapsedMs':
      return updateElapsed(protocol, action.elapsedMs)
    case 'recordObservation':
      return recordObservation(protocol, action.draft)
    case 'registerMedia':
      return registerMedia(protocol, action.media)
    case 'completeRun':
      return completeRun(protocol, action.completion)
    case 'acknowledgeOmission':
      return acknowledge(protocol, action.alertId)
    case 'resolveOmission':
      return resolve(protocol, action.alertId, action.note)
    case 'addHumanEvent':
      return addHuman(protocol, action.draft)
    case 'loadRun':
      return protocolStateFromRecord(action.record, 'completed')
    default:
      return protocol
  }
}

function startRun(draft: RunStartDraft): ProtocolState {
  const order = draft.protocolOrder ?? PROTOCOL_ORDER
  const wellStates = initialWellStates()
  return {
    phase: 'running',
    metadata: {
      id: createId('run'),
      source: draft.source,
      title: draft.title,
      startedAtIso: draft.startedAtIso,
      protocolOrder: order,
      syntheticFixture: draft.source === 'synthetic',
      notes: draft.notes,
    },
    elapsedMs: 0,
    expectedWellId: expectedWellId(order, wellStates),
    wellStates,
    observations: [],
    humanEvents: [],
    alerts: [],
    media: [],
  }
}

function updateElapsed(protocol: ProtocolState, elapsedMs: ElapsedMs): ProtocolState {
  if (protocol.phase !== 'running') return protocol
  if (!Number.isInteger(elapsedMs) || elapsedMs < protocol.elapsedMs) return protocol
  return { ...protocol, elapsedMs }
}

function recordObservation(protocol: ProtocolState, draft: ObservationDraft): ProtocolState {
  if (protocol.phase !== 'running' || !protocol.metadata) return protocol
  if (!Number.isInteger(draft.elapsedMs) || draft.elapsedMs < 0) return protocol
  const last = protocol.observations.at(-1)
  if (last && draft.elapsedMs <= last.elapsedMs) return protocol
  if (!completeReadings(draft)) return protocol

  const observation: Observation = {
    id: createId('observation'),
    runId: protocol.metadata.id,
    elapsedMs: draft.elapsedMs,
    wells: draft.wells.map((reading) => ({ wellId: reading.wellId, state: reading.state })),
  }
  const observations = [...protocol.observations, observation]
  const wellStates = foldWellStates(observations)
  const order = protocol.metadata.protocolOrder
  const already = new Set(protocol.alerts.map((alert) => alert.wellId))
  const alerts = [...protocol.alerts]
  for (const wellId of listPossibleOmissions(order, observation.wells)) {
    if (already.has(wellId)) continue
    const protocolIndex = order.indexOf(wellId)
    if (protocolIndex < 0) continue
    alerts.push({
      id: createId('alert'),
      runId: protocol.metadata.id,
      wellId,
      protocolIndex,
      raisedAtElapsedMs: observation.elapsedMs,
      status: 'open',
      sourceObservationId: observation.id,
    })
  }

  return {
    ...protocol,
    observations,
    wellStates,
    expectedWellId: expectedWellId(order, wellStates),
    alerts,
  }
}

function completeReadings(draft: ObservationDraft): boolean {
  if (draft.wells.length !== PROTOCOL_ORDER.length) return false
  const ids = new Set(draft.wells.map((reading) => reading.wellId))
  return PROTOCOL_ORDER.every((wellId) => ids.has(wellId))
}

function registerMedia(protocol: ProtocolState, media: MediaDraft): ProtocolState {
  if (!protocol.metadata) return protocol
  if (protocol.media.some((item) => item.mediaId === media.mediaId)) return protocol
  return {
    ...protocol,
    media: [...protocol.media, { ...media, runId: protocol.metadata.id }],
  }
}

function completeRun(protocol: ProtocolState, completion: RunCompletion): ProtocolState {
  if (protocol.phase !== 'running' || !protocol.metadata) return protocol
  const elapsedMs =
    Number.isInteger(completion.elapsedMs) && completion.elapsedMs >= protocol.elapsedMs
      ? completion.elapsedMs
      : protocol.elapsedMs
  const draft = completion.finalAssessment
  return {
    ...protocol,
    phase: 'completed',
    elapsedMs,
    expectedWellId: expectedWellId(protocol.metadata.protocolOrder, protocol.wellStates),
    finalAssessment: draft
      ? {
          id: createId('finalAssessment'),
          runId: protocol.metadata.id,
          elapsedMs: draft.elapsedMs,
          mediaId: draft.mediaId,
          wells: draft.wells.map((well) => ({ ...well })),
        }
      : protocol.finalAssessment,
  }
}

function acknowledge(protocol: ProtocolState, alertId: string): ProtocolState {
  if (!protocol.metadata || protocol.phase === 'idle') return protocol
  const alert = protocol.alerts.find((item) => item.id === alertId)
  if (!alert || alert.status !== 'open') return protocol
  const event = humanEvent(protocol, {
    kind: 'omission_acknowledged',
    wellId: alert.wellId,
    alertId: alert.id,
    note: SKIPPED_NOTE,
    elapsedMs: Math.max(protocol.elapsedMs, alert.raisedAtElapsedMs),
  })
  return {
    ...protocol,
    humanEvents: [...protocol.humanEvents, event],
    alerts: protocol.alerts.map((item) =>
      item.id === alert.id ? { ...item, status: 'acknowledged', acknowledgedEventId: event.id } : item,
    ),
  }
}

function resolve(protocol: ProtocolState, alertId: string, note?: string): ProtocolState {
  if (!protocol.metadata || protocol.phase === 'idle') return protocol
  const alert = protocol.alerts.find((item) => item.id === alertId)
  if (!alert || (alert.status !== 'open' && alert.status !== 'acknowledged')) return protocol
  const event = humanEvent(protocol, {
    kind: 'omission_resolved',
    wellId: alert.wellId,
    alertId: alert.id,
    note,
    reportedState: note === CAMERA_MISSED_NOTE ? 'filled' : undefined,
    elapsedMs: Math.max(protocol.elapsedMs, alert.raisedAtElapsedMs),
  })
  return {
    ...protocol,
    humanEvents: [...protocol.humanEvents, event],
    alerts: protocol.alerts.map((item) =>
      item.id === alert.id ? { ...item, status: 'resolved', resolvedEventId: event.id } : item,
    ),
  }
}

function addHuman(protocol: ProtocolState, draft: HumanEventDraft): ProtocolState {
  if (!protocol.metadata || protocol.phase === 'idle') return protocol
  const event = humanEvent(protocol, draft)
  return { ...protocol, humanEvents: [...protocol.humanEvents, event] }
}

function humanEvent(protocol: ProtocolState, draft: HumanEventDraft): HumanEvent {
  const elapsedMs = nextElapsed(protocol, draft.elapsedMs)
  return {
    id: createId('humanEvent'),
    runId: protocol.metadata?.id ?? '',
    elapsedMs,
    kind: draft.kind,
    wellId: draft.wellId,
    alertId: draft.alertId,
    note: draft.note,
    reportedState: draft.reportedState,
    evidence: draft.evidence ?? evidenceFor(protocol, elapsedMs, draft.kind),
  }
}

function nextElapsed(protocol: ProtocolState, requested: number | undefined): number {
  const last = protocol.humanEvents.at(-1)?.elapsedMs ?? -1
  const candidate = requested ?? protocol.elapsedMs
  const base = Number.isInteger(candidate) && candidate >= 0 ? candidate : protocol.elapsedMs
  return base > last ? base : last + 1
}

function evidenceFor(
  protocol: ProtocolState,
  elapsedMs: ElapsedMs,
  kind: HumanEvent['kind'],
): EvidenceRef | undefined {
  if (kind === 'correction_note') return undefined
  const camera = protocol.media.find((media) => media.kind === 'camera_recording')
  const prerecorded = protocol.media.find((media) => media.kind === 'prerecorded_source')
  const media = camera ?? prerecorded
  if (!media) return undefined
  return {
    mediaId: media.mediaId,
    elapsedMs,
    windowMs: 1500,
    label: kind === 'omission_acknowledged' ? 'Acknowledgement' : 'Resolution',
  }
}

export function sourceState(protocol: ProtocolState, wellId: WellId, observationId: string) {
  return protocol.observations
    .find((observation) => observation.id === observationId)
    ?.wells.find((reading) => reading.wellId === wellId)?.state
}
