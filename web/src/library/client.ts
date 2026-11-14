export interface ExperimentSummary {
  id: string
  title: string
  description: string
  authorDisplayName: string
  approvalAcknowledged: boolean
  publishedAt: string
}

export interface StoredExperiment extends ExperimentSummary {
  protocolSnapshot: ProtocolSnapshot
}

export interface PlannedReplication {
  id: string
  experimentId: string
  protocolSnapshot: ProtocolSnapshot
  status: 'planned'
  note: string
  createdAt: string
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

export async function listExperiments(): Promise<ExperimentSummary[]> {
  const body = await readJson<{ experiments?: ExperimentSummary[] }>(await libraryFetch('/experiments'))
  return Array.isArray(body.experiments) ? body.experiments : []
}

export async function openExperiment(id: string): Promise<StoredExperiment> {
  return readJson(await libraryFetch(`/experiments/${encodeURIComponent(id)}`))
}

export async function startReplication(experimentId: string): Promise<PlannedReplication> {
  return readJson(await libraryFetch('/replications', { method: 'POST', body: { experimentId } }))
}

export async function openReplication(id: string): Promise<PlannedReplication> {
  return readJson(await libraryFetch(`/replications/${encodeURIComponent(id)}`))
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
  if (error === 'invalid_input') return 'The library rejected the request.'
  if (error === 'payload_too_large') return 'The protocol snapshot is too large to publish.'
  return 'The experiment library did not save this request.'
}
