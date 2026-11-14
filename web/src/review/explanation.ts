import type { RunRecord } from '../shared/types.ts'

export interface ExplanationRun {
  id: string
  title: string
  synthetic: boolean
  alerts: { id: string; wellId: string; status: string; raisedAtElapsedMs: number }[]
  events: { id: string; kind: string; elapsedMs: number; wellId?: string; note?: string }[]
  observations: { id: string; elapsedMs: number; wells: RunRecord['observations'][number]['wells'] }[]
  finalAssessment?: RunRecord['finalAssessment']
}

export interface ExplanationRequest {
  runs: ExplanationRun[]
}

export interface ExplanationCitation {
  runId: string
  eventId: string
  claim: string
}

export interface ExplanationResponse {
  summary: string
  uncertainty: string
  citations: ExplanationCitation[]
}

export function explanationRequestFromRuns(records: readonly RunRecord[]): ExplanationRequest {
  return {
    runs: records.map((record) => ({
      id: record.metadata.id,
      title: record.metadata.title,
      synthetic: record.metadata.syntheticFixture,
      alerts: record.alerts.map((alert) => ({
        id: alert.id,
        wellId: alert.wellId,
        status: alert.status,
        raisedAtElapsedMs: alert.raisedAtElapsedMs,
      })),
      events: record.humanEvents.map((event) => ({
        id: event.id,
        kind: event.kind,
        elapsedMs: event.elapsedMs,
        wellId: event.wellId,
        note: event.note,
      })),
      finalAssessment: record.finalAssessment,
      observations: record.observations.map((observation) => ({
        id: observation.id,
        elapsedMs: observation.elapsedMs,
        wells: observation.wells,
      })),
    })),
  }
}

export function validateExplanation(request: ExplanationRequest, response: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(response)) return ['Explanation response is not an object.']
  if (typeof response.summary !== 'string' || response.summary.trim() === '') {
    errors.push('Explanation summary is missing.')
  }
  if (typeof response.uncertainty !== 'string' || response.uncertainty.trim() === '') {
    errors.push('Explanation uncertainty is missing.')
  }
  if (!Array.isArray(response.citations)) {
    errors.push('Explanation citations are missing.')
    return errors
  }
  const ids = new Map(request.runs.map((run) => [run.id, allowedIds(run)]))
  response.citations.forEach((citation, index) => {
    if (!isRecord(citation)) {
      errors.push(`Citation ${index} is not an object.`)
      return
    }
    const runId = citation.runId
    const eventId = citation.eventId
    const claim = citation.claim
    if (typeof runId !== 'string' || typeof eventId !== 'string' || typeof claim !== 'string' || !claim.trim()) {
      errors.push(`Citation ${index} is incomplete.`)
      return
    }
    const allowed = ids.get(runId)
    if (!allowed || !allowed.has(eventId)) {
      errors.push(`Citation ${index} references an unknown run or event.`)
    }
  })
  return errors
}

export function isCurrentExplanation(latestId: number, responseId: number): boolean {
  return latestId === responseId
}

function allowedIds(run: ExplanationRun): Set<string> {
  return new Set([
    ...run.alerts.map((alert) => alert.id),
    ...run.events.map((event) => event.id),
    ...run.observations.map((observation) => observation.id),
  ])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
