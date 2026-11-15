import { describe, expect, it } from 'vitest'
import { readMonitorIndex, rememberMonitorSession } from './saveSession.ts'

function memory(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

describe('monitor session index', () => {
  it('keeps the latest session first and drops an unreadable index', () => {
    const storage = memory()
    rememberMonitorSession({ id: 'session_a', sourceKind: 'live', startedAtIso: '2026-11-15T00:00:00.000Z' }, storage)
    rememberMonitorSession({ id: 'session_b', sourceKind: 'synthetic', startedAtIso: '2026-11-15T00:01:00.000Z' }, storage)
    expect(readMonitorIndex(storage).map((item) => item.id)).toEqual(['session_b', 'session_a'])
    rememberMonitorSession({ id: 'session_a', sourceKind: 'live', startedAtIso: '2026-11-15T00:02:00.000Z' }, storage)
    expect(readMonitorIndex(storage)).toHaveLength(2)
    expect(readMonitorIndex(storage)[0]?.id).toBe('session_a')
    storage.setItem('reprolab-monitor-session-index', '{')
    expect(readMonitorIndex(storage)).toEqual([])
  })
})
