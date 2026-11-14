import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDraft } from './validateDraft.mjs'

const source = [
  'Add dye to the tank.',
  'Mix thoroughly.',
  'Wait 5 minutes.',
  'Observe the dye color in a still frame.',
].join('\n')

function step(overrides) {
  return {
    instruction: 'Follow the written line.',
    quote: 'Add dye to the tank.',
    duration: null,
    observationMethod: 'manual',
    questions: [],
    ...overrides,
  }
}

test('rejects a malformed model response', () => {
  assert.deepEqual(validateDraft(source, { steps: 'no' }), [
    'The model response is not a draft with a steps array.',
  ])
  const errors = validateDraft(source, { steps: [{ instruction: 'Do it' }] })
  assert.equal(errors.some((error) => error.includes('supporting quote')), true)
  assert.equal(errors.some((error) => error.includes('observation method')), true)
})

test('does not accept an invented duration for an unspecified mix', () => {
  const errors = validateDraft(source, {
    steps: [step({ quote: 'Mix thoroughly.', duration: '30 seconds', questions: [] })],
  })
  assert.equal(errors.some((error) => error.includes('duration is not stated')), true)
})

test('keeps an unspecified mix unknown when the quote is real', () => {
  assert.deepEqual(
    validateDraft(source, {
      steps: [
        step({
          instruction: 'Mix the tank.',
          quote: 'Mix thoroughly.',
          duration: null,
          observationMethod: 'manual',
          questions: ['The text does not say how long or how hard to mix.'],
        }),
      ],
    }),
    [],
  )
})

test('rejects a quote that is not in the supplied text', () => {
  const errors = validateDraft(source, {
    steps: [step({ quote: 'Stir for exactly 12 revolutions.' })],
  })
  assert.equal(errors.some((error) => error.includes('does not occur')), true)
})

test('accepts a stated duration and rejects vision on an arbitrary step', () => {
  assert.deepEqual(
    validateDraft(source, {
      steps: [step({ quote: 'Wait 5 minutes.', duration: '5 minutes', observationMethod: 'timer' })],
    }),
    [],
  )
  const errors = validateDraft(source, {
    steps: [step({ quote: 'Mix thoroughly.', observationMethod: 'vision' })],
  })
  assert.equal(errors.some((error) => error.includes('not camera-verifiable')), true)
})

test('allows vision only for looking at color in a frame', () => {
  assert.deepEqual(
    validateDraft(source, {
      steps: [
        step({
          instruction: 'Look at the dye color in the still frame.',
          quote: 'Observe the dye color in a still frame.',
          observationMethod: 'vision',
        }),
      ],
    }),
    [],
  )
})
