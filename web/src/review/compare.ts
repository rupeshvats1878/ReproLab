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
      record.finalAssessment?.wells.filter((well) => well.state !== 'filled').map((well) => well.wellId) ??
      [],
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
  if (run.unresolved.length > 0) {
    const wells = run.unresolved.join(', ')
    const empty = run.finalEmpty.length > 0 ? run.finalEmpty.join(', ') : 'none'
    return `${run.title} has an unresolved ${wells} omission and ${empty} appears empty in its final image. Review the linked events.`
  }
  if (run.observedFilled.length > 0) {
    const wells = run.observedFilled.join(', ')
    const reported = run.reportedFilled.filter((wellId) => !run.observedFilled.includes(wellId))
    const reportedText = reported.length > 0 ? ` ${reported.join(', ')} is user-reported only.` : ''
    return `${run.title}: ${wells} was flagged and later observed filled. A person recorded the resolution.${reportedText}`
  }
  return `${run.title}: no omission was detected, and the final image shows every compared well filled.`
}
