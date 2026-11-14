import type { ProtocolStep } from './validate.ts'

export interface ProtocolVersion {
  version: number
  status: 'draft' | 'approved'
  title: string
  sourceText: string
  steps: ProtocolStep[]
  createdAt: string
  approvedAt: string | null
}

export interface SavedProtocol {
  id: string
  versions: ProtocolVersion[]
}

export interface ProtocolLibrary {
  protocols: SavedProtocol[]
}

export interface CommitInput {
  id: string | null
  title: string
  sourceText: string
  steps: ProtocolStep[]
  status: 'draft' | 'approved'
  mode: 'create' | 'replace-draft' | 'append'
  replaceVersion?: number
}

const STORAGE_KEY = 'reprolab-protocol-library-v1'

export function emptyLibrary(): ProtocolLibrary {
  return { protocols: [] }
}

export function readLibrary(storage: Pick<Storage, 'getItem'> | null): ProtocolLibrary {
  if (!storage) return emptyLibrary()
  try {
    return parseLibrary(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{"protocols":[]}'))
  } catch {
    return emptyLibrary()
  }
}

export function writeLibrary(storage: Pick<Storage, 'setItem'>, library: ProtocolLibrary): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(library))
}

export function commitVersion(
  library: ProtocolLibrary,
  input: CommitInput,
  now: string,
  newId: string,
): { library: ProtocolLibrary; id: string; version: number } {
  if (input.mode === 'create' || !input.id) {
    const version = versionRecord(1, input, now)
    return {
      library: { protocols: [...library.protocols, { id: newId, versions: [version] }] },
      id: newId,
      version: 1,
    }
  }
  const current = library.protocols.find((item) => item.id === input.id)
  if (!current) {
    const version = versionRecord(1, input, now)
    return {
      library: { protocols: [...library.protocols, { id: input.id, versions: [version] }] },
      id: input.id,
      version: 1,
    }
  }
  if (input.mode === 'replace-draft') {
    const versions = current.versions.map((item) =>
      item.version === input.replaceVersion && item.status === 'draft'
        ? versionRecord(item.version, input, item.createdAt, now)
        : item,
    )
    return {
      library: replaceProtocol(library, { ...current, versions }),
      id: current.id,
      version: input.replaceVersion ?? current.versions.at(-1)?.version ?? 1,
    }
  }
  const next = (current.versions.at(-1)?.version ?? 0) + 1
  return {
    library: replaceProtocol(library, { ...current, versions: [...current.versions, versionRecord(next, input, now)] }),
    id: current.id,
    version: next,
  }
}

export function parseLibrary(value: unknown): ProtocolLibrary {
  if (!isRecord(value) || !Array.isArray(value.protocols)) return emptyLibrary()
  const protocols = value.protocols.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.versions)) return []
    const versions = item.versions.flatMap((version) => {
      const parsed = parseVersion(version)
      return parsed ? [parsed] : []
    })
    return versions.length > 0 ? [{ id: item.id, versions }] : []
  })
  return { protocols }
}

function versionRecord(
  version: number,
  input: CommitInput,
  createdAt: string,
  approvedAt: string | null = input.status === 'approved' ? createdAt : null,
): ProtocolVersion {
  return {
    version,
    status: input.status,
    title: input.title.trim(),
    sourceText: input.sourceText,
    steps: input.steps.map((step) => ({
      ...step,
      questions: [...step.questions],
      duration: step.duration,
    })),
    createdAt,
    approvedAt: input.status === 'approved' ? approvedAt : null,
  }
}

function parseVersion(value: unknown): ProtocolVersion | null {
  if (!isRecord(value)) return null
  if (typeof value.version !== 'number' || (value.status !== 'draft' && value.status !== 'approved')) return null
  if (typeof value.title !== 'string' || typeof value.sourceText !== 'string' || !Array.isArray(value.steps)) return null
  if (typeof value.createdAt !== 'string') return null
  const steps = value.steps.flatMap((step) => {
    const parsed = parseStep(step)
    return parsed ? [parsed] : []
  })
  if (steps.length !== value.steps.length) return null
  return {
    version: value.version,
    status: value.status,
    title: value.title,
    sourceText: value.sourceText,
    steps,
    createdAt: value.createdAt,
    approvedAt: typeof value.approvedAt === 'string' ? value.approvedAt : null,
  }
}

function parseStep(step: unknown): ProtocolStep | null {
  if (!isRecord(step)) return null
  if (typeof step.instruction !== 'string' || typeof step.quote !== 'string') return null
  if (!(step.duration === null || typeof step.duration === 'string')) return null
  if (step.observationMethod !== 'manual' && step.observationMethod !== 'timer' && step.observationMethod !== 'vision') {
    return null
  }
  if (!Array.isArray(step.questions) || step.questions.some((item) => typeof item !== 'string')) return null
  return {
    instruction: step.instruction,
    quote: step.quote,
    duration: step.duration,
    observationMethod: step.observationMethod,
    questions: step.questions.filter((item): item is string => typeof item === 'string'),
  }
}

function replaceProtocol(library: ProtocolLibrary, protocol: SavedProtocol): ProtocolLibrary {
  return {
    protocols: library.protocols.map((item) => (item.id === protocol.id ? protocol : item)),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
