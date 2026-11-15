import { describe, expect, it } from 'vitest'
import { isSupportedSixWell, preparedMonitorProtocol, sixWellDraft, SIX_WELL_INSTRUCTIONS } from './sixWell.ts'
import { validateDraft } from './validate.ts'

describe('six-well procedure template', () => {
  it('creates an editable draft with the six fill instructions and no duration', () => {
    const draft = sixWellDraft()
    expect(validateDraft(draft.sourceText, draft)).toEqual([])
    expect(draft.steps.map((step) => step.instruction)).toEqual([...SIX_WELL_INSTRUCTIONS])
    expect(draft.steps.every((step) => step.duration == null)).toBe(true)
    expect(isSupportedSixWell(draft.steps)).toBe(true)
  })

  it('rejects an edited procedure', () => {
    const draft = sixWellDraft()
    const edited = draft.steps.map((step, index) => (index === 1 ? { ...step, instruction: 'Wait 5 minutes' } : step))
    expect(isSupportedSixWell(edited)).toBe(false)
    const timed = draft.steps.map((step, index) => (index === 0 ? { ...step, duration: '10 seconds' } : step))
    expect(isSupportedSixWell(timed)).toBe(false)
  })

  it('copies the instructions into the session snapshot', () => {
    const draft = sixWellDraft()
    const snapshot = preparedMonitorProtocol('protocol-1', 2, draft.title, draft.steps)
    draft.steps[0]!.instruction = 'Changed later'
    expect(snapshot).toEqual({
      id: 'protocol-1',
      version: 2,
      title: draft.title,
      steps: [...SIX_WELL_INSTRUCTIONS],
    })
  })
})
