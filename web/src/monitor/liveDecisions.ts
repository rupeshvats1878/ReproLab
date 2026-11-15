import { createId, listPossibleOmissions } from '../shared/protocol.ts'
import {
  PROTOCOL_ORDER,
  type HumanEventKind,
  type ObservationDraft,
  type WellId,
  type WellReading,
  type WellState,
} from '../shared/types.ts'
import { signatureOf } from '../vision/stabilize.ts'

/**
 * Live alerts use the shared omission list, then keep only wells that are
 * stably empty. Unknown stays unknown. mixScore is not obstruction detection.
 */
export const LIVE_OMISSION_RULE =
  'A later location in A1, A2, A3, B1, B2, B3 is filled while this earlier location is stably empty. Unknown is not treated as empty.'

export const LIVE_CORRECTION_RULE =
  'A later stable observation shows the alerted location filled. The original alert is kept.'

export const HUMAN_ACK_RULE = 'Human acknowledgement. This is not a camera observation.'

export const HUMAN_REPORT_RULE =
  'Human report of a missed observation. This is not a camera observation.'

export const HUMAN_CONTINUE_RULE =
  'Human chose to continue after a correction. This is not a camera observation.'

export type LiveSourceKind = 'live' | 'prerecorded' | 'synthetic' | 'unspecified'

export interface FrameEvidence {
  elapsedMs: number
  frameIndex: number | null
  frameDataUrl: string | null
  label: string
}

export type LiveDecisionKind =
  | 'omission_alert'
  | 'correction'
  | 'omission_acknowledged'
  | 'omission_resolved'
  | 'correction_note'

export interface LiveDecisionEntry {
  id: string
  kind: LiveDecisionKind
  source: 'camera' | 'human'
  alertId: string
  wellId: WellId
  expectedAction: string
  observedState: string
  rule: string
  sourceElapsedMs: number
  evidence: FrameEvidence
  note?: string
  reportedState?: WellState
  rawState?: WellState
}

export interface LiveCorrection {
  elapsedMs: number
  evidence: FrameEvidence
  observedState: 'filled'
}

export interface LiveAlert {
  id: string
  wellId: WellId
  protocolIndex: number
  status: 'open' | 'acknowledged' | 'corrected'
  raisedAtElapsedMs: number
  expectedAction: string
  observedState: string
  rule: string
  evidence: FrameEvidence
  rawState?: WellState
  correction?: LiveCorrection
  humanResolved: boolean
}

export interface LiveMonitorState {
  sessionId: string
  generation: number
  sourceKind: LiveSourceKind
  protocolOrder: readonly WellId[]
  blockedReason: string | null
  lastElapsedMs: number
  lastSignature: string
  alerts: LiveAlert[]
  timeline: LiveDecisionEntry[]
}

export function createLiveMonitor(sourceKind: LiveSourceKind, generation = 0): LiveMonitorState {
  return {
    sessionId: `session_${crypto.randomUUID()}`,
    generation,
    sourceKind,
    protocolOrder: PROTOCOL_ORDER,
    blockedReason: null,
    lastElapsedMs: -1,
    lastSignature: '',
    alerts: [],
    timeline: [],
  }
}

/** Shared skip list, restricted to wells whose stable reading is empty. */
export function selectLiveOmissions(
  order: readonly WellId[],
  wells: readonly WellReading[],
): WellId[] {
  const byWell = new Map(wells.map((reading) => [reading.wellId, reading.state]))
  return listPossibleOmissions(order, wells).filter((wellId) => byWell.get(wellId) === 'empty')
}

export function blockLiveMonitor(state: LiveMonitorState, reason: string): LiveMonitorState {
  if (!reason || state.blockedReason) return state
  return { ...state, blockedReason: reason }
}

/**
 * Apply one stable six-well snapshot.
 * A repeated signature does not open another alert.
 * A blocked session, including a backward clock, does not append events.
 */
export function applyStableObservation(
  state: LiveMonitorState,
  draft: ObservationDraft,
  evidence: FrameEvidence,
  rawWells?: readonly WellReading[],
): LiveMonitorState {
  if (state.blockedReason) return state
  if (!Number.isInteger(draft.elapsedMs) || draft.elapsedMs < 0) return state
  if (draft.elapsedMs <= state.lastElapsedMs) return state
  if (!coversOrder(state.protocolOrder, draft.wells)) return state

  const signature = signatureOf(readingsRecord(draft.wells))
  if (signature === state.lastSignature) {
    return { ...state, lastElapsedMs: draft.elapsedMs }
  }

  const frozen = freezeEvidence(evidence, draft.elapsedMs)
  const summary = readingSummary(draft.wells)
  let alerts = state.alerts.map((alert) => ({ ...alert }))
  const timeline = [...state.timeline]

  for (const alert of alerts) {
    if (alert.correction) continue
    if (readingState(draft.wells, alert.wellId) !== 'filled') continue
    const correction: LiveCorrection = {
      elapsedMs: draft.elapsedMs,
      evidence: frozen,
      observedState: 'filled',
    }
    alert.status = 'corrected'
    alert.correction = correction
    timeline.push({
      id: decisionId(),
      kind: 'correction',
      source: 'camera',
      alertId: alert.id,
      wellId: alert.wellId,
      expectedAction: `Update ${alert.wellId} after a later fill. Keep the original alert.`,
      observedState: summary,
      rule: LIVE_CORRECTION_RULE,
      sourceElapsedMs: draft.elapsedMs,
      evidence: frozen,
      rawState: rawStateOf(rawWells, alert.wellId),
    })
  }

  const already = new Set(alerts.map((alert) => alert.wellId))
  for (const wellId of selectLiveOmissions(state.protocolOrder, draft.wells)) {
    if (already.has(wellId)) continue
    const protocolIndex = state.protocolOrder.indexOf(wellId)
    if (protocolIndex < 0) continue
    const id = createId('alert')
    const expectedAction = `Fill ${wellId} before the later filled locations.`
    const observedState = `${wellId} empty. ${summary}`
    const rawState = rawStateOf(rawWells, wellId)
    alerts.push({
      id,
      wellId,
      protocolIndex,
      status: 'open',
      raisedAtElapsedMs: draft.elapsedMs,
      expectedAction,
      observedState,
      rule: LIVE_OMISSION_RULE,
      evidence: frozen,
      rawState,
      humanResolved: false,
    })
    timeline.push({
      id: decisionId(),
      kind: 'omission_alert',
      source: 'camera',
      alertId: id,
      wellId,
      expectedAction,
      observedState,
      rule: LIVE_OMISSION_RULE,
      sourceElapsedMs: draft.elapsedMs,
      evidence: frozen,
      rawState,
    })
    already.add(wellId)
  }

  return {
    ...state,
    lastElapsedMs: draft.elapsedMs,
    lastSignature: signature,
    alerts,
    timeline,
  }
}

export function acknowledgeAlert(
  state: LiveMonitorState,
  alertId: string,
  elapsedMs: number,
  evidence: FrameEvidence,
  note = 'Acknowledged by a person.',
): LiveMonitorState {
  return addHuman(state, alertId, elapsedMs, evidence, {
    kind: 'omission_acknowledged',
    rule: HUMAN_ACK_RULE,
    note,
    expectedAction: (wellId) => `Acknowledge the possible omission at ${wellId}.`,
    patch: (alert) => ({
      ...alert,
      status: alert.status === 'open' ? 'acknowledged' : alert.status,
    }),
  })
}

export function reportMissedObservation(
  state: LiveMonitorState,
  alertId: string,
  elapsedMs: number,
  evidence: FrameEvidence,
  note: string,
  reportedState: WellState,
): LiveMonitorState {
  const text = note.trim() || 'Missed observation reported by a person.'
  return addHuman(state, alertId, elapsedMs, evidence, {
    kind: 'correction_note',
    rule: HUMAN_REPORT_RULE,
    note: text,
    reportedState,
    expectedAction: (wellId) => `Record a human report for ${wellId}. Do not treat it as the camera.`,
    patch: (alert) => alert,
  })
}

export function continueAfterCorrection(
  state: LiveMonitorState,
  alertId: string,
  elapsedMs: number,
  evidence: FrameEvidence,
  note = 'Continue after a correction.',
): LiveMonitorState {
  return addHuman(state, alertId, elapsedMs, evidence, {
    kind: 'omission_resolved',
    rule: HUMAN_CONTINUE_RULE,
    note,
    expectedAction: (wellId) => `Continue after a correction at ${wellId}.`,
    patch: (alert) => ({ ...alert, humanResolved: true }),
  })
}

export function highlightedOmissionWells(state: LiveMonitorState): WellId[] {
  return state.alerts.filter((alert) => !alert.correction).map((alert) => alert.wellId)
}

function addHuman(
  state: LiveMonitorState,
  alertId: string,
  elapsedMs: number,
  evidence: FrameEvidence,
  spec: {
    kind: HumanEventKind
    rule: string
    note: string
    reportedState?: WellState
    expectedAction: (wellId: WellId) => string
    patch: (alert: LiveAlert) => LiveAlert
  },
): LiveMonitorState {
  const alert = state.alerts.find((item) => item.id === alertId)
  if (!alert) return state
  const at = Number.isInteger(elapsedMs) && elapsedMs >= 0 ? elapsedMs : Math.max(0, state.lastElapsedMs)
  const frozen = freezeEvidence(evidence, at)
  const reported = spec.reportedState ? ` Reported state: ${spec.reportedState}.` : ''
  const entry: LiveDecisionEntry = {
    id: createId('humanEvent'),
    kind: spec.kind,
    source: 'human',
    alertId: alert.id,
    wellId: alert.wellId,
    expectedAction: spec.expectedAction(alert.wellId),
    observedState: `Human report for ${alert.wellId}. Camera record stays: ${alert.observedState}.${reported}`,
    rule: spec.rule,
    sourceElapsedMs: at,
    evidence: frozen,
    note: spec.note,
    reportedState: spec.reportedState,
    rawState: alert.rawState,
  }
  return {
    ...state,
    alerts: state.alerts.map((item) => (item.id === alert.id ? spec.patch(item) : item)),
    timeline: [...state.timeline, entry],
  }
}

function coversOrder(order: readonly WellId[], wells: readonly WellReading[]): boolean {
  if (wells.length !== order.length) return false
  const ids = new Set(wells.map((reading) => reading.wellId))
  return order.every((wellId) => ids.has(wellId))
}

function readingsRecord(wells: readonly WellReading[]): Record<WellId, WellState> {
  const record = {} as Record<WellId, WellState>
  for (const reading of wells) record[reading.wellId] = reading.state
  return record
}

function readingState(wells: readonly WellReading[], wellId: WellId): WellState | undefined {
  return wells.find((reading) => reading.wellId === wellId)?.state
}

function rawStateOf(wells: readonly WellReading[] | undefined, wellId: WellId): WellState | undefined {
  return wells?.find((reading) => reading.wellId === wellId)?.state
}

function readingSummary(wells: readonly WellReading[]): string {
  return wells.map((reading) => `${reading.wellId} ${reading.state}`).join(', ')
}

function freezeEvidence(evidence: FrameEvidence, elapsedMs: number): FrameEvidence {
  return {
    elapsedMs,
    frameIndex: evidence.frameIndex,
    frameDataUrl: evidence.frameDataUrl,
    label: evidence.label,
  }
}

function decisionId(): string {
  return `decision_${crypto.randomUUID()}`
}
