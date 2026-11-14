import { LibraryError } from './errors.mjs'

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
  return {
    id: experiment.id,
    title: experiment.title,
    description: experiment.description,
    authorDisplayName: experiment.authorDisplayName,
    approvalAcknowledged: experiment.approvalAcknowledged,
    publishedAt: experiment.publishedAt,
  }
}
