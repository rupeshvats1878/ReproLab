export interface ExperimentSummary {
  id: string
  title: string
  description: string
  authorDisplayName: string
  approvalAcknowledged: boolean
  publishedAt: string
  protocolVersion?: number
  stepCount?: number
  kind?: 'protocol' | 'recorded' | 'demonstration'
}

export interface ExperimentPage {
  experiments: ExperimentSummary[]
  limit: number
  offset: number
  total: number | null
}

export interface RunEvidence {
  id?: string
  kind?: string
  label?: string
  available?: boolean
  observationTimestamp?: number
  runStartOffsetMs?: number
  durationMs?: number | null
  sharedMediaId?: string | null
  byteLength?: number | null
  mimeType?: string | null
}

export interface RunAlert {
  id: string
  wellId: string
  observationTimestamp: number
  observedState: string
  evidence?: { label?: string | null; observationTimestamp?: number | null; frameIndex?: number | null } | null
  updates?: Array<{ id?: string; observationTimestamp?: number; observedState?: string; stableState?: string }>
}

export interface RunRecord {
  procedureId?: string
  sourceKind?: string
  startedAtIso?: string | null
  finishedAt?: string | null
  notes?: string | null
  observationCount?: number
  observations?: Array<{ id?: string; observationTimestamp?: number }>
  alerts?: RunAlert[]
  humanReports?: Array<{ id?: string; wellId?: string; humanActionKind?: string; humanNote?: string; humanReportedState?: string | null; observationTimestamp?: number }>
  humanMarkers?: Array<{ id?: string; marker?: string; cups?: string[]; label?: string; observationTimestamp?: number; provenance?: string }>
  evidence?: RunEvidence[]
}

export interface StoredExperiment extends ExperimentSummary {
  protocolSnapshot: ProtocolSnapshot
  monitorSessionId?: string
  runRecord?: RunRecord | null
}

export interface PlannedReplication {
  id: string
  experimentId: string
  protocolSnapshot: ProtocolSnapshot
  status: 'planned'
  note: string
  createdAt: string
}

export interface ReplicationEvent {
  id: string
  type: string
  stepIndex: number
  stepId?: string | null
  recordedAt?: string
  note?: string | null
  capturedAt?: string | null
  provenance?: string | null
  image?: { mediaType: string; byteLength: number; data: string } | null
  source?: { clipId: string; title: string; locator: string } | null
  videoTimeSec?: number | null
  crop?: { x: number; y: number; width: number; height: number } | null
  measurement?: {
    metric?: string
    value?: number | null
    quality?: string
    reason?: string | null
    analysisVersion?: string
    dispersion?: number
  } | null
  correctsEventId?: string | null
}

export interface ReplicationRecord {
  id: string
  experimentId: string
  protocolSnapshot: ProtocolSnapshot
  status: 'planned' | 'in_progress' | 'completed'
  note: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  completionNote: string | null
  events: ReplicationEvent[]
  execution: {
    sessionEnded: boolean
    unfinishedStepIndexes: number[]
    steps: Array<{
      stepIndex: number
      stepId: string | null
      humanCompleted: boolean
      ownObservationCount: number
      referenceObservationCount: number
    }>
  }
}

export interface ProtocolSnapshot {
  id?: string
  version?: number
  title?: string
  sourceText?: string
  steps?: SnapshotStep[]
  [key: string]: unknown
}

export interface SnapshotStep {
  instruction?: string
  quote?: string
  duration?: string | null
  observationMethod?: string
}

const LIBRARY = '/library'

export async function publishExperiment(body: unknown): Promise<StoredExperiment> {
  return readJson(await libraryFetch('/experiments', { method: 'POST', body }))
}

export async function publishRecordedSession(
  sessionId: string,
  notes: string,
  recording?: { evidenceId: string; mediaId: string } | null,
): Promise<StoredExperiment> {
  const body: { notes?: string; recording?: { evidenceId: string; mediaId: string } } = {}
  if (notes.trim()) body.notes = notes.trim()
  if (recording) body.recording = recording
  return readJson(await libraryFetch(`/monitor-sessions/${encodeURIComponent(sessionId)}/publish`, {
    method: 'POST',
    body,
  }))
}

export async function deleteUnreferencedRecording(mediaId: string): Promise<boolean> {
  let response: Response
  try {
    response = await fetch(`${LIBRARY}/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' })
  } catch {
    return false
  }
  if (response.status === 409) return false
  return response.ok || response.status === 404
}

export async function uploadSharedRecording(blob: Blob): Promise<{ id: string; byteLength: number; mimeType: string }> {
  const mimeType = (blob.type.split(';')[0] || 'video/webm').toLowerCase()
  let response: Response
  try {
    response = await fetch(`${LIBRARY}/media`, {
      method: 'POST',
      headers: { 'content-type': mimeType },
      body: blob,
    })
  } catch {
    throw new LibraryClientError('The recording was not uploaded. The local file is still here.')
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object' || !('id' in payload)) {
    throw new LibraryClientError(
      response.status === 413
        ? 'The recording is over the 80 MB library limit. The local file is still here.'
        : 'The recording was not uploaded. The local file is still here.',
    )
  }
  return payload as { id: string; byteLength: number; mimeType: string }
}

export function sharedRecordingUrl(mediaId: string): string {
  return `${LIBRARY}/media/${encodeURIComponent(mediaId)}`
}

export async function listExperiments(query: string): Promise<ExperimentPage> {
  const body = await readJson<{ experiments?: ExperimentSummary[]; limit?: number; offset?: number; total?: number }>(
    await libraryFetch(`/experiments?${query}`),
  )
  return {
    experiments: Array.isArray(body.experiments) ? body.experiments : [],
    limit: typeof body.limit === 'number' ? body.limit : 20,
    offset: typeof body.offset === 'number' ? body.offset : 0,
    total: typeof body.total === 'number' ? body.total : null,
  }
}

export async function openExperiment(id: string): Promise<StoredExperiment> {
  return readJson(await libraryFetch(`/experiments/${encodeURIComponent(id)}`))
}

export async function startReplication(experimentId: string): Promise<ReplicationRecord> {
  return readJson(await libraryFetch('/replications', { method: 'POST', body: { experimentId } }))
}

export async function openReplication(id: string): Promise<ReplicationRecord> {
  return readJson(await libraryFetch(`/replications/${encodeURIComponent(id)}`))
}

export async function beginReplication(id: string): Promise<ReplicationRecord> {
  return readJson(await libraryFetch(`/replications/${encodeURIComponent(id)}/start`, { method: 'POST', body: {} }))
}

export async function appendReplicationEvent(id: string, body: unknown): Promise<ReplicationRecord> {
  return readJson(await libraryFetch(`/replications/${encodeURIComponent(id)}/events`, { method: 'POST', body }))
}

export async function finishReplication(id: string): Promise<ReplicationRecord> {
  return readJson(await libraryFetch(`/replications/${encodeURIComponent(id)}/finish`, { method: 'POST', body: {} }))
}

async function libraryFetch(path: string, options: { method?: string; body?: unknown } = {}) {
  let response: Response
  try {
    response = await fetch(`${LIBRARY}${path}`, {
      method: options.method ?? 'GET',
      headers: options.body == null ? {} : { 'content-type': 'application/json' },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new LibraryClientError('The experiment library is not reachable at 127.0.0.1:8788.')
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new LibraryClientError(libraryMessage(payload), response.status)
  return payload
}

async function readJson<T>(value: unknown): Promise<T> {
  if (!value || typeof value !== 'object') throw new LibraryClientError('The experiment library returned an unusable response.')
  return value as T
}

export class LibraryClientError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

function libraryMessage(payload: unknown): string {
  const error = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : ''
  if (error === 'database_unavailable') return 'The experiment library could not reach the database. Nothing was saved.'
  if (error === 'approval_required') return 'Publishing requires an explicit approval acknowledgement.'
  if (error === 'not_found') return 'That library record was not found.'
  if (error === 'invalid_input') {
    const field = payload && typeof payload === 'object' && 'field' in payload ? String(payload.field) : ''
    return field ? `The library rejected ${field}. Nothing was saved.` : 'The library rejected the request. Nothing was saved.'
  }
  if (error === 'invalid_state') return 'This replication is not in the state required for that action. Nothing new was saved.'
  if (error === 'duplicate_event') return 'That event id was already saved with different details. Nothing new was saved.'
  if (error === 'payload_too_large') return 'The request is too large to store. Nothing was saved.'
  return 'The experiment library did not save this request.'
}
