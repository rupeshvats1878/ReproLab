import assert from 'node:assert/strict'
import test from 'node:test'
import { validateExplanation } from './validateExplanation.mjs'

const request = {
  runs: [
    {
      id: 'run_demo',
      alerts: [{ id: 'alert_b2' }],
      events: [],
      observations: [{ id: 'obs_1' }],
    },
  ],
}

test('accepts a citation that exists on the run', () => {
  assert.deepEqual(
    validateExplanation(request, {
      summary: 'B2 is unresolved.',
      uncertainty: 'The snapshot does not say why.',
      citations: [{ runId: 'run_demo', eventId: 'alert_b2', claim: 'B2 stayed open.' }],
    }),
    [],
  )
})

test('rejects a fabricated event id', () => {
  const errors = validateExplanation(request, {
    summary: 'Invented.',
    uncertainty: 'Unsure.',
    citations: [{ runId: 'run_demo', eventId: 'evt_missing', claim: 'no' }],
  })
  assert.equal(errors.length > 0, true)
})
