export const OBSERVATION_METHODS = ['manual', 'timer', 'vision'] as const

export type ObservationMethod = (typeof OBSERVATION_METHODS)[number]

export interface ProtocolStep {
  instruction: string
  quote: string
  duration: string | null
  observationMethod: ObservationMethod
  questions: string[]
}

export function validateDraft(sourceText: string, draft: unknown): string[] {
  if (!isRecord(draft) || !Array.isArray(draft.steps)) {
    return ['The model response is not a draft with a steps array.']
  }
  if (sourceText.trim() === '') return ['Protocol text is missing.']
  const errors: string[] = []
  if (draft.steps.length === 0) errors.push('The draft has no steps.')
  draft.steps.forEach((step, index) => {
    errors.push(...stepErrors(sourceText, step, index))
  })
  return errors
}

function stepErrors(sourceText: string, step: unknown, index: number): string[] {
  const label = `Step ${index + 1}`
  if (!isRecord(step)) return [`${label} is not an object.`]
  const errors: string[] = []
  const instruction = step.instruction
  const quote = step.quote
  const duration = step.duration
  const observationMethod = step.observationMethod
  const questions = step.questions
  if (typeof instruction !== 'string' || instruction.trim() === '') {
    errors.push(`${label} is missing an instruction.`)
  }
  if (typeof quote !== 'string' || quote.trim() === '') {
    errors.push(`${label} is missing a supporting quote.`)
  } else if (!containsPhrase(sourceText, quote)) {
    errors.push(`${label} quote does not occur in the supplied text.`)
  }
  if (!(duration === null || (typeof duration === 'string' && duration.trim() !== ''))) {
    errors.push(`${label} duration must be a stated phrase or null.`)
  } else if (typeof duration === 'string' && typeof quote === 'string' && !containsPhrase(quote, duration)) {
    errors.push(`${label} duration is not stated in its supporting quote.`)
  }
  if (!OBSERVATION_METHODS.includes(observationMethod as ObservationMethod)) {
    errors.push(`${label} has an unsupported observation method.`)
  }
  if (observationMethod === 'timer' && typeof duration !== 'string') {
    errors.push(`${label} uses a timer without a stated duration.`)
  }
  if (
    observationMethod === 'vision' &&
    !supportedVision(typeof instruction === 'string' ? instruction : '', typeof quote === 'string' ? quote : '')
  ) {
    errors.push(
      `${label} is not camera-verifiable. Supported vision only measures spatial color dispersion in a selected frame.`,
    )
  }
  if (!Array.isArray(questions) || questions.some((item) => typeof item !== 'string' || item.trim() === '')) {
    errors.push(`${label} questions must be a list of strings.`)
  }
  return errors
}

function supportedVision(instruction: string, quote: string): boolean {
  const text = `${instruction}\n${quote}`
  const visual = /(color|dye|dispersion|appearance)/i.test(text)
  const looking = /(frame|image|photo|picture|look|observe|visual|see)/i.test(text)
  const overclaims = /(chemical success|mixing endpoint|validated endpoint|concentration|pass\/fail|threshold|volume|temperature|\bpH\b)/i.test(text)
  return visual && looking && !overclaims
}

function containsPhrase(source: string, phrase: string): boolean {
  return source.replace(/\s+/g, ' ').trim().includes(phrase.replace(/\s+/g, ' ').trim())
}

export function readExtractedSteps(sourceText: string, body: unknown): ProtocolStep[] | null {
  if (!isRecord(body) || validateDraft(sourceText, body).length > 0 || !Array.isArray(body.steps)) return null
  return body.steps.flatMap((step) => {
    if (!isRecord(step) || typeof step.instruction !== 'string' || typeof step.quote !== 'string') return []
    if (!(step.duration === null || typeof step.duration === 'string')) return []
    if (!OBSERVATION_METHODS.includes(step.observationMethod as ObservationMethod)) return []
    if (!Array.isArray(step.questions) || step.questions.some((item) => typeof item !== 'string')) return []
    return [{
      instruction: step.instruction,
      quote: step.quote,
      duration: step.duration,
      observationMethod: step.observationMethod as ObservationMethod,
      questions: step.questions.filter((item): item is string => typeof item === 'string'),
    }]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
