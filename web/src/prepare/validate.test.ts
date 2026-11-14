import { describe, expect, it } from 'vitest'
import { validateDraft } from './validate.ts'

const source = 'Mix thoroughly.\nWait 5 minutes.\nObserve the dye color in a still frame.'

describe('protocol draft validation', () => {
  it('rejects malformed responses, invented durations, and unsupported quotes', () => {
    expect(validateDraft(source, { steps: null as unknown as [] })[0]).toMatch(/steps array/)
    expect(
      validateDraft(source, {
        steps: [
          {
            instruction: 'Mix.',
            quote: 'Mix thoroughly.',
            duration: '30 seconds',
            observationMethod: 'manual',
            questions: [],
          },
        ],
      }).join(' '),
    ).toMatch(/duration is not stated/)
    expect(
      validateDraft(source, {
        steps: [
          {
            instruction: 'Stir.',
            quote: 'Stir for 12 revolutions.',
            duration: null,
            observationMethod: 'manual',
            questions: [],
          },
        ],
      }).join(' '),
    ).toMatch(/does not occur/)
  })

  it('accepts an unknown mix and a color-frame observation', () => {
    expect(
      validateDraft(source, {
        steps: [
          {
            instruction: 'Mix the tank.',
            quote: 'Mix thoroughly.',
            duration: null,
            observationMethod: 'manual',
            questions: ['How long is thoroughly?'],
          },
          {
            instruction: 'Look at the dye color in the still frame.',
            quote: 'Observe the dye color in a still frame.',
            duration: null,
            observationMethod: 'vision',
            questions: [],
          },
        ],
      }),
    ).toEqual([])
  })
})
