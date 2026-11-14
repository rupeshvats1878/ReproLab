import { describe, expect, it } from 'vitest'
import { commitVersion, emptyLibrary, parseLibrary } from './library.ts'
import type { ProtocolStep } from './validate.ts'

const step: ProtocolStep = {
  instruction: 'Mix the tank.',
  quote: 'Mix thoroughly.',
  duration: null,
  observationMethod: 'manual',
  questions: ['The text does not say how long to mix.'],
}

const base = {
  title: 'Dye run',
  sourceText: 'Mix thoroughly.',
  steps: [step],
}

describe('protocol versions', () => {
  it('approves a new protocol without changing later revisions of an older approval', () => {
    const created = commitVersion(emptyLibrary(), { ...base, id: null, status: 'approved', mode: 'create' }, '2026-11-14T12:00:00.000Z', 'proto_1')
    const revised = commitVersion(
      created.library,
      { ...base, id: created.id, title: 'Dye run revised', status: 'draft', mode: 'append' },
      '2026-11-14T12:05:00.000Z',
      'unused',
    )
    const approved = created.library.protocols[0]?.versions[0]
    const stored = revised.library.protocols[0]
    expect(approved?.status).toBe('approved')
    expect(approved?.title).toBe('Dye run')
    expect(stored?.versions).toHaveLength(2)
    expect(stored?.versions[0]).toEqual(approved)
    expect(stored?.versions[1]?.status).toBe('draft')
    expect(stored?.versions[1]?.version).toBe(2)
    expect(stored?.versions[1]?.title).toBe('Dye run revised')
  })

  it('replaces a saved draft instead of appending another copy', () => {
    const created = commitVersion(emptyLibrary(), { ...base, id: null, status: 'draft', mode: 'create' }, '2026-11-14T12:00:00.000Z', 'proto_1')
    const replaced = commitVersion(
      created.library,
      { ...base, id: created.id, title: 'Renamed', status: 'approved', mode: 'replace-draft', replaceVersion: 1 },
      '2026-11-14T12:10:00.000Z',
      'unused',
    )
    expect(replaced.library.protocols[0]?.versions).toHaveLength(1)
    expect(replaced.library.protocols[0]?.versions[0]?.status).toBe('approved')
    expect(replaced.library.protocols[0]?.versions[0]?.title).toBe('Renamed')
    expect(replaced.version).toBe(1)
  })

  it('drops malformed saved records', () => {
    const library = parseLibrary({
      protocols: [
        { id: 'ok', versions: [{ ...base, version: 1, status: 'draft', createdAt: 't', approvedAt: null }] },
        { id: 'bad', versions: [{ version: 1, status: 'approved' }] },
      ],
    })
    expect(library.protocols.map((item) => item.id)).toEqual(['ok'])
  })
})
