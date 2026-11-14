import { evidenceIsCovered, evidenceOffsetMs, foldWellStates } from '../shared/protocol.ts'
import type { RunRecord, WellId } from '../shared/types.ts'
import { CAMERA_MISSED_NOTE } from './engine.ts'

export interface EvidenceLink {
  label: string
  elapsedMs: number
  mediaId: string
  mediaOffsetMs: number | null
  covered: boolean
}

export interface RunComparison {
  runId: string
  title: string
  synthetic: boolean
  observedFilled: WellId[]
  reportedFilled: WellId[]
  unresolved: WellId[]
  unknownWells: WellId[]
  finalEmpty: WellId[]
  finalUnknown: WellId[]
  hasFinalAssessment: boolean
  evidence: EvidenceLink[]
}

export interface ComparisonReport {
  runs: RunComparison[]
  summary: string
  caveat: string
}

const CAVEAT =
  'These runs do not prove causation. A final occupancy image is not an independent biological result. Stored feedback is not automatic model learning.'

export function compareRuns(records: readonly RunRecord[]): ComparisonReport {
  const runs = records.map(compareRun)
  return {
    runs,
    summary: `${runs.map(summaryLine).join(' ')} No alerts does not mean no mistakes.`,
    caveat: CAVEAT,
  }
}

function compareRun(record: RunRecord): RunComparison {
  const states = foldWellStates(record.observations)
  const observedFilled = record.alerts
    .filter((alert) => states[alert.wellId] === 'filled')
    .map((alert) => alert.wellId)
  const reportedFilled = [
    ...new Set(
      record.humanEvents
        .filter(
          (event) =>
            event.wellId &&
            (event.reportedState === 'filled' || event.note === CAMERA_MISSED_NOTE),
        )
        .map((event) => event.wellId as WellId),
    ),
  ]
  return {
    runId: record.metadata.id,
    title: record.metadata.title,
    synthetic: record.metadata.syntheticFixture,
    observedFilled,
    reportedFilled,
    unresolved: record.alerts.filter((alert) => alert.status !== 'resolved').map((alert) => alert.wellId),
    unknownWells: record.metadata.protocolOrder.filter((wellId) => states[wellId] === 'unknown'),
    finalEmpty:
      record.finalAssessment?.wells.filter((well) => well.state === 'empty').map((well) => well.wellId) ??
      [],
    finalUnknown: record.finalAssessment?.wells.filter(w => w.state === 'unknown').map(w => w.wellId) ?? [],
    hasFinalAssessment: record.finalAssessment != null,
    evidence: evidenceLinks(record),
  }
}

function evidenceLinks(record: RunRecord): EvidenceLink[] {
  const links: EvidenceLink[] = []
  for (const event of record.humanEvents) {
    if (!event.evidence) continue
    const media = record.media.find((item) => item.mediaId === event.evidence?.mediaId)
    links.push({
      label: event.evidence.label ?? event.kind,
      elapsedMs: event.evidence.elapsedMs,
      mediaId: event.evidence.mediaId,
      mediaOffsetMs: media ? evidenceOffsetMs(media.runStartOffsetMs, event.evidence.elapsedMs) : null,
      covered: media ? evidenceIsCovered(media, event.evidence.elapsedMs) : false,
    })
  }
  return links
}

function summaryLine(run: RunComparison): string {
  const status = run.unresolved.length
    ? `${run.title} has an unresolved ${run.unresolved.join(', ')} omission or verification request.`
    : run.observedFilled.length
      ? `${run.title}: ${run.observedFilled.join(', ')} was flagged and later observed filled.`
      : `${run.title}: no unresolved alert is recorded.`
  const final = !run.hasFinalAssessment ? 'No final image assessment is available.'
    : [run.finalEmpty.length ? `${run.finalEmpty.join(', ')} appears empty in its final image.` : '',
       run.finalUnknown.length ? `${run.finalUnknown.join(', ')} is unknown in its final image.` : '',
       !run.finalEmpty.length && !run.finalUnknown.length ? 'The assessed final wells appear filled.' : ''].filter(Boolean).join(' ')
  return `${status} ${final} Review the linked events.`
}
