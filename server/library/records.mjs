import { LibraryError } from './errors.mjs'
import { presentMonitorSession } from './monitorRecords.mjs'

export const COMPLETION_NOTE = 'Session ended. Completed means the recording session ended, not that the experiment succeeded or was reproduced.'

export function experimentRecord(input, { id, publishedAt }) {
  return {
    id,
    title: input.title,
    description: input.description,
    authorDisplayName: input.authorDisplayName,
    approvalAcknowledged: true,
    protocolSnapshot: structuredClone(input.protocolSnapshot),
    publishedAt,
  }
}

export function replicationRecord(experiment, { id, createdAt }) {
  return {
    id,
    experimentId: experiment.id,
    protocolSnapshot: structuredClone(experiment.protocolSnapshot),
    status: 'planned',
    note: 'Planned replication. This record does not mean the experiment was performed or reproduced.',
    createdAt,
    startedAt: null,
    finishedAt: null,
    completionNote: null,
    events: [],
  }
}

export function beginExecution(record, startedAt) {
  if (record.status !== 'planned') throw new LibraryError('invalid_state')
  return { ...record, status: 'in_progress', startedAt }
}

export function finishExecution(record, finishedAt) {
  if (record.status !== 'in_progress') throw new LibraryError('invalid_state')
  return { ...record, status: 'completed', finishedAt, completionNote: COMPLETION_NOTE }
}

export function appendExecutionEvent(record, input, recordedAt) {
  const events = Array.isArray(record.events) ? record.events : []
  const existing = events.find((event) => event.id === input.id)
  if (existing) {
    if (clientCanonical(existing) !== clientCanonical(input)) throw new LibraryError('duplicate', 'id')
    return { record, created: false }
  }
  if (record.status !== 'in_progress') throw new LibraryError('invalid_state')
  const event = buildEvent(record, events, input, recordedAt)
  return { record: { ...record, events: [...events, event] }, created: true }
}

export function presentReplication(record) {
  const events = Array.isArray(record.events) ? record.events.map((event) => structuredClone(event)) : []
  const steps = Array.isArray(record.protocolSnapshot?.steps) ? record.protocolSnapshot.steps : []
  const retracted = new Set(
    events.filter((event) => event.type === 'correction').map((event) => event.correctsEventId),
  )
  const stepViews = steps.map((step, stepIndex) => {
    const related = events.filter((event) => event.stepIndex === stepIndex)
    return {
      stepIndex,
      stepId: stepIdOf(step),
      humanCompleted: related.some((event) => event.type === 'human_completion' && !retracted.has(event.id)),
      ownObservationCount: related.filter((event) => event.type === 'image_observation' && event.provenance === 'own_recording').length,
      referenceObservationCount: related.filter((event) => event.type === 'image_observation' && event.provenance === 'imported_reference').length,
    }
  })
  return {
    id: record.id,
    experimentId: record.experimentId,
    protocolSnapshot: structuredClone(record.protocolSnapshot),
    status: record.status,
    note: record.note,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? null,
    completionNote: record.completionNote ?? null,
    events,
    execution: {
      sessionEnded: record.status === 'completed',
      unfinishedStepIndexes: stepViews.filter((step) => !step.humanCompleted).map((step) => step.stepIndex),
      steps: stepViews,
    },
  }
}

function buildEvent(record, events, input, recordedAt) {
  const stepId = resolveStep(record, input.stepIndex)
  if (input.type === 'correction') {
    const prior = events.find((event) => event.id === input.correctsEventId)
    if (!prior) throw new LibraryError('invalid', 'correctsEventId')
    if (prior.stepIndex !== input.stepIndex) throw new LibraryError('invalid', 'stepIndex')
  }
  return {
    id: input.id,
    type: input.type,
    stepIndex: input.stepIndex,
    stepId,
    recordedAt,
    note: input.note ?? null,
    capturedAt: input.capturedAt ?? null,
    provenance: input.provenance ?? null,
    image: input.image ? structuredClone(input.image) : null,
    source: input.source ? structuredClone(input.source) : null,
    videoTimeSec: input.videoTimeSec ?? null,
    crop: input.crop ? structuredClone(input.crop) : null,
    measurement: input.measurement ? structuredClone(input.measurement) : null,
    correctsEventId: input.correctsEventId ?? null,
  }
}

function resolveStep(record, stepIndex) {
  const steps = record.protocolSnapshot?.steps
  if (!Array.isArray(steps) || stepIndex >= steps.length) throw new LibraryError('invalid', 'stepIndex')
  return stepIdOf(steps[stepIndex])
}

function stepIdOf(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null
  if (typeof step.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(step.id)) return null
  return step.id
}

function clientCanonical(value) {
  return stable({
    id: value.id,
    type: value.type,
    stepIndex: value.stepIndex,
    note: value.note ?? null,
    capturedAt: value.capturedAt ?? null,
    provenance: value.provenance ?? null,
    imageBase64: value.image?.data ?? value.imageBase64 ?? null,
    source: value.source ?? null,
    videoTimeSec: value.videoTimeSec ?? null,
    crop: value.crop ?? null,
    measurement: value.measurement ?? null,
    correctsEventId: value.correctsEventId ?? null,
  })
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function experimentSummary(experiment) {
  const snapshot = experiment.protocolSnapshot
  const summary = {
    id: experiment.id,
    title: experiment.title,
    description: experiment.description,
    authorDisplayName: experiment.authorDisplayName,
    approvalAcknowledged: experiment.approvalAcknowledged,
    publishedAt: experiment.publishedAt,
  }
  if (snapshot != null && typeof snapshot.version === 'number') summary.protocolVersion = snapshot.version
  if (snapshot != null && Array.isArray(snapshot.steps)) summary.stepCount = snapshot.steps.length
  summary.kind = experiment.kind === 'recorded' || experiment.kind === 'demonstration' ? experiment.kind : 'protocol'
  return summary
}

const RUN_RECORD_BYTES = 1_500_000

const CAPTURE_STEPS = [
  'RED and BLUE should look uniformly mixed. GREEN will have visible streaks.',
  'Expected transfers: RED → BLUE, then GREEN → RED.',
]

export function recordedExperimentRecord(session, notes, { id, publishedAt, shared = null }) {
  if (!session.finishedAt) throw new LibraryError('invalid_state')
  const presented = presentMonitorSession(session)
  const protocol = presented.procedureId === 'three-cup-capture'
    ? { id: 'three-cup-capture', version: 1, title: 'Three-cup capture', steps: CAPTURE_STEPS }
    : session.preparedProtocol
  if (!protocol || !Array.isArray(protocol.steps)) throw new LibraryError('invalid', 'preparedProtocol')
  if (shared) {
    const source = presented.evidence.find((item) => item.id === shared.evidenceId)
    if (!source || source.available !== true) throw new LibraryError('invalid', 'evidenceId')
    if (source.kind !== 'camera_recording' && source.kind !== 'prerecorded_source') {
      throw new LibraryError('invalid', 'evidenceId')
    }
  }
  const kind = session.sourceKind === 'synthetic' ? 'demonstration' : 'recorded'
  const runRecord = {
    procedureId: presented.procedureId,
    sourceKind: session.sourceKind,
    startedAtIso: session.startedAtIso ?? null,
    finishedAt: session.finishedAt,
    notes,
    observationCount: presented.observations.length,
    observations: presented.observations.map((item) => ({
      id: item.id,
      observationTimestamp: item.observationTimestamp,
      rawState: item.rawState,
      stableState: item.stableState,
    })),
    alerts: presented.alerts.map((alert) => ({
      id: alert.id,
      wellId: alert.wellId,
      observationTimestamp: alert.observationTimestamp,
      observedState: alert.observedState,
      rule: alert.rule,
      evidence: frameLabel(alert.evidence),
      updates: (alert.updates ?? []).map((update) => ({
        id: update.id,
        observationTimestamp: update.observationTimestamp,
        observedState: update.observedState,
        stableState: update.stableState,
        evidence: frameLabel(update.evidence),
      })),
    })),
    humanMarkers: (presented.humanMarkers ?? []).map((marker) => ({
      id: marker.id,
      marker: marker.marker,
      cups: marker.cups,
      label: marker.label,
      observationTimestamp: marker.observationTimestamp,
      provenance: 'human',
    })),
    humanReports: presented.humanReports.map((report) => ({
      id: report.id,
      wellId: report.wellId,
      humanActionKind: report.humanActionKind,
      humanNote: report.humanNote,
      humanReportedState: report.humanReportedState ?? null,
      observationTimestamp: report.observationTimestamp,
    })),
    evidence: presented.evidence.map((item) => {
      const included = shared != null && item.id === shared.evidenceId
      return {
        id: item.id,
        kind: item.kind,
        label: item.label,
        available: included,
        observationTimestamp: item.observationTimestamp,
        runStartOffsetMs: item.runStartOffsetMs ?? 0,
        durationMs: item.durationMs ?? null,
        sharedMediaId: included ? shared.mediaId : null,
        byteLength: included ? shared.byteLength : null,
        mimeType: included ? shared.mimeType : null,
      }
    }),
  }
  if (JSON.stringify(runRecord).length > RUN_RECORD_BYTES) throw new LibraryError('too_large')
  return {
    id,
    title: protocol.title,
    description: notes ?? '',
    authorDisplayName: '',
    approvalAcknowledged: true,
    kind,
    monitorSessionId: session.id,
    protocolSnapshot: {
      id: protocol.id,
      version: protocol.version,
      title: protocol.title,
      steps: protocol.steps.map((instruction) => ({ instruction })),
    },
    runRecord,
    publishedAt,
  }
}

function frameLabel(evidence) {
  if (!evidence || typeof evidence !== 'object') return null
  return {
    label: evidence.label ?? null,
    observationTimestamp: evidence.observationTimestamp ?? null,
    frameIndex: evidence.frameIndex ?? null,
  }
}

export function recordingIsReferenced(experiments, mediaId) {
  return experiments.some((experiment) =>
    (experiment.runRecord?.evidence ?? []).some((item) => item.sharedMediaId === mediaId),
  )
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function experimentTitleFilter(query) {
  if (!query) return {}
  return { title: { $regex: escapeRegExp(query), $options: 'i' } }
}

export function matchesExperimentTitle(experiment, query) {
  if (!query) return true
  return experiment.title.toLowerCase().includes(query.toLowerCase())
}

export function compareExperiments(sort) {
  const direction = sort === 'oldest' ? 1 : -1
  return (left, right) => direction * left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id)
}
