import { describe, expect, it } from 'vitest'
import { MONITOR_SESSION_ID, sessionChoiceLabel, statusLabel } from './sessionBrowse.ts'

describe('saved session labels', () => {
  it('names an associated protocol without treating a saved session as finished', () => {
    const label = sessionChoiceLabel({
      sourceKind: 'synthetic',
      startedAtIso: 'not-a-time',
      preparedProtocol: { title: 'Six-well colored water' },
      blockedReason: null,
    })
    expect(label).toContain('Six-well colored water')
    expect(label).toContain('Synthetic')
    expect(label).toContain('Status not recorded')
    expect(statusLabel(null)).toBe('Status not recorded')
    expect(statusLabel('The video clock moved backward.')).toBe('Blocked: The video clock moved backward.')
  })

  it('keeps an older session without a protocol association readable', () => {
    const label = sessionChoiceLabel({
      sourceKind: 'live',
      recordedAt: '2026-11-14T23:00:00.000Z',
      preparedProtocol: null,
    })
    expect(label.startsWith('Protocol association not recorded')).toBe(true)
    expect(label).toContain('Camera')
    expect(MONITOR_SESSION_ID.test('session_11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(MONITOR_SESSION_ID.test('session_not-an-id')).toBe(false)
  })
})
