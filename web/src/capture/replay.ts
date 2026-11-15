import { recordingComparisons, type RecordingEvent } from './recordingAnalysis.ts'
import type { RecordingDraft } from './recordingReview.ts'
import { captureProtocol } from './threeCup.ts'

export type ReplayFinding = 'match' | 'extra' | 'repeated' | 'wrong_order' | 'unclear'
export type ReplayReview = 'unconfirmed' | 'confirmed' | 'rejected' | 'supplied_confirmation'
export interface ReplayRow { event: RecordingEvent; finding: string; kind: ReplayFinding; reviewStatus: ReplayReview; reviewer: string | null; stepIndex: number | null }
export function replaySnapshot(draft: RecordingDraft, timeMs: number, fullResults: boolean) {
  const now = Number.isFinite(timeMs) ? Math.max(0, Math.min(timeMs, draft.parsed.durationMs)) : 0
  const protocol = captureProtocol(draft.captureProtocolId)
  const reached = draft.parsed.events.filter(event => event.startMs <= now)
  function rows(events: RecordingEvent[]): ReplayRow[] {
    const findings = recordingComparisons(events, protocol.transfers)
    return events.map((event, index) => {
      const finding = findings[index]
      const kind: ReplayFinding = event.uncertain ? 'unclear' : finding.includes('wrong order') ? 'wrong_order' : finding.includes('repeated') ? 'repeated' : finding.includes('extra transfer') ? 'extra' : 'match'
      const review = draft.reviews.filter(item => item.analysisId === draft.id && item.eventId === event.id).at(-1)
      const reviewStatus: ReplayReview = review ? review.action === 'confirm' ? 'confirmed' : 'rejected' : event.humanConfirmed ? 'supplied_confirmation' : 'unconfirmed'
      const matchedStep = protocol.transfers.findIndex(([source, destination]) => source === event.source && destination === event.destination)
      return { event, finding, kind, reviewStatus, reviewer: review?.reviewer ?? null, stepIndex: matchedStep < 0 ? null : matchedStep }
    })
  }
  const reachedRows = rows(reached)
  const active = reachedRows.findLast(row => row.event.startMs <= now && now <= row.event.endMs) ?? null
  return {
    now, protocol, visible: fullResults ? rows(draft.parsed.events) : reachedRows, active,
    latest: reachedRows.at(-1) ?? null,
    metrics: { reached: reached.length, deviations: reachedRows.filter(row => ['extra','repeated','wrong_order'].includes(row.kind)).length,
      pending: reachedRows.filter(row => row.reviewStatus === 'unconfirmed').length,
      examinedSteps: [...new Set(reachedRows.flatMap(row => row.stepIndex == null ? [] : [row.stepIndex + 1]))] },
  }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
export function replayProvenance(value: unknown) {
  const raw = record(value), segments = Array.isArray(raw.segments) ? raw.segments.map(record) : []
  const estimate = record(raw.inferenceEstimate)
  const model = [raw.modelId, raw.model, ...segments.map(segment => segment.modelId ?? segment.model)].find(value => typeof value === 'string' && value.trim())
  return { model: typeof model === 'string' ? model : null,
    windows: segments.length, remoteCalls: finite(raw.remoteCallCount) ? raw.remoteCallCount : null,
    latencyMs: segments.flatMap(segment => finite(segment.latencyMs) ? [segment.latencyMs] : []),
    estimatedCost: finite(estimate.lowUsd) && finite(estimate.highUsd) ? { low: estimate.lowUsd, high: estimate.highUsd } : null,
    geometry: 'not_available' as const,
  }
}
export function replayReviewLabel(row: ReplayRow): string {
  if (row.reviewStatus === 'confirmed') return `Human confirmed${row.reviewer ? ` · ${row.reviewer}` : ''}`
  if (row.reviewStatus === 'rejected') return `Human rejected${row.reviewer ? ` · ${row.reviewer}` : ''} · original hypothesis retained`
  if (row.reviewStatus === 'supplied_confirmation') return 'Supplied human confirmation · separate from model'
  return 'Unconfirmed · needs human review'
}
export function replayFindingLabel(row: ReplayRow): string {
  return {match:'Pair matches approved action', extra:'Possible extra transfer', repeated:'Possible repeated transfer', wrong_order:'Possible wrong order', unclear:'Unclear observation'}[row.kind]
}
export function replayClock(ms: number): string { const seconds=Math.max(0,ms)/1000; return `${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}` }

export function replayFullResultsEnabled(choice:{key:string|null;fileKey:object|null;value:boolean},draftId:string|null,fileKey:object|null):boolean {
  return draftId !== null && fileKey !== null && choice.key === draftId && choice.fileKey === fileKey && choice.value
}
