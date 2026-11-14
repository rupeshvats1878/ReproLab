import { describe, expect, it } from 'vitest'
import { SYNTHETIC_DEMO_RUNS } from '../shared/exampleRun.ts'
import {
  explanationRequestFromRuns,
  isCurrentExplanation,
  validateExplanation,
} from './explanation.ts'

describe('explanation validation', () => {
  it('accepts citations that point at real run and event ids', () => {
    const request = explanationRequestFromRuns(SYNTHETIC_DEMO_RUNS)
    const demo = SYNTHETIC_DEMO_RUNS[1]!
    const result = validateExplanation(request, {
      summary: 'Demo 2 still has an open B2 omission.',
      uncertainty: 'The camera snapshot does not explain why B2 is empty.',
      citations: [
        {
          runId: demo.metadata.id,
          eventId: demo.alerts[0]!.id,
          claim: 'B2 was flagged and left unresolved.',
        },
      ],
    })
    expect(result).toEqual([])
  })

  it('rejects fabricated ids and incomplete payloads', () => {
    const request = explanationRequestFromRuns(SYNTHETIC_DEMO_RUNS)
    expect(
      validateExplanation(request, {
        summary: 'Invented.',
        uncertainty: 'Unsure.',
        citations: [{ runId: 'run_missing', eventId: 'evt_missing', claim: 'no' }],
      }).length,
    ).toBeGreaterThan(0)
    expect(validateExplanation(request, { summary: '', uncertainty: 'x', citations: [] })).not.toEqual(
      [],
    )
  })

  it('ignores a stale explanation response', () => {
    expect(isCurrentExplanation(3, 3)).toBe(true)
    expect(isCurrentExplanation(4, 3)).toBe(false)
  })
})
