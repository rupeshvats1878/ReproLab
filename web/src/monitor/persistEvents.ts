import type { LiveDecisionEntry, LiveMonitorState } from './liveDecisions.ts'
import { PROTOCOL_ORDER, type MediaDraft, type WellId, type WellReading, type WellState } from '../shared/types.ts'

export interface StoredObservation {
  id: string
  type: 'observation'
  observationTimestamp: number
  rawState: Record<WellId, WellState>
  stableState: Record<WellId, WellState>
}

export function observationEvent(
  id: string,
  observationTimestamp: number,
  raw: readonly WellReading[],
  stable: readonly WellReading[],
): StoredObservation | null {
  const rawState = wellMap(raw)
  const stableState = wellMap(stable)
  if (!rawState || !stableState) return null
  return { id, type: 'observation', observationTimestamp, rawState, stableState }
}

export function eventsFromDecision(previous: LiveMonitorState, next: LiveMonitorState, blockId: string | null) {
  const events: Record<string, unknown>[] = []
  const seen = new Set(previous.alerts.map((alert) => alert.id))
  for (const alert of next.alerts) {
    if (seen.has(alert.id)) continue
    if (!alert.rawState) throw new Error('The alert has no raw state to store.')
    events.push({
      id: alert.id,
      type: 'alert',
      observationTimestamp: alert.raisedAtElapsedMs,
      wellId: alert.wellId,
      expectedWell: alert.wellId,
      rule: alert.rule,
      observedState: alert.observedState,
      rawState: alert.rawState,
      stableState: 'empty',
      evidence: frameEvidence(alert.evidence),
    })
  }
  const seenEntries = new Set(previous.timeline.map((entry) => entry.id))
  for (const entry of next.timeline) {
    if (seenEntries.has(entry.id)) continue
    if (entry.kind === 'correction') events.push(alertUpdate(entry))
    if (entry.source === 'human') events.push(humanReport(entry))
  }
  if (!previous.blockedReason && next.blockedReason && blockId) {
    events.push({
      id: blockId,
      type: 'block',
      observationTimestamp: Math.max(0, next.lastElapsedMs),
      reason: next.blockedReason,
    })
  }
  return events
}

export function evidenceEvent(draft: MediaDraft, observationTimestamp: number) {
  const body: Record<string, unknown> = {
    id: draft.mediaId,
    type: 'evidence',
    kind: draft.kind,
    observationTimestamp,
    runStartOffsetMs: draft.runStartOffsetMs,
    available: draft.available,
    label: draft.label,
  }
  if (draft.durationMs != null) body.durationMs = draft.durationMs
  if (draft.mimeType) body.mimeType = draft.mimeType
  return body
}

function alertUpdate(entry: LiveDecisionEntry) {
  return {
    id: entry.id,
    type: 'alert_update',
    alertId: entry.alertId,
    observationTimestamp: entry.sourceElapsedMs,
    rule: entry.rule,
    observedState: entry.observedState,
    stableState: 'filled',
    evidence: frameEvidence(entry.evidence),
  }
}

function humanReport(entry: LiveDecisionEntry) {
  if (!entry.note?.trim()) throw new Error('The human report has no note to store.')
  const body: Record<string, unknown> = {
    id: entry.id,
    type: 'human_report',
    humanActionKind: entry.kind,
    alertId: entry.alertId,
    wellId: entry.wellId,
    observationTimestamp: entry.sourceElapsedMs,
    humanNote: entry.note,
    evidence: frameEvidence(entry.evidence),
  }
  if (entry.kind === 'correction_note') {
    if (!entry.reportedState) throw new Error('The human report has no reported state to store.')
    body.humanReportedState = entry.reportedState
  }
  return body
}

function frameEvidence(evidence: LiveDecisionEntry['evidence']) {
  const label = evidence.label.trim()
  if (!label || label.startsWith('data:')) throw new Error('The evidence label cannot be stored.')
  return {
    mediaId: null,
    observationTimestamp: evidence.elapsedMs,
    frameIndex: evidence.frameIndex,
    label,
  }
}

function wellMap(wells: readonly WellReading[]): Record<WellId, WellState> | null {
  const states = {} as Record<WellId, WellState>
  for (const wellId of PROTOCOL_ORDER) {
    const found = wells.find((reading) => reading.wellId === wellId)
    if (!found) return null
    states[wellId] = found.state
  }
  return states
}
