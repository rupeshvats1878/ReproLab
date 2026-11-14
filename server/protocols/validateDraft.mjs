const METHODS = ['manual', 'timer', 'vision']

export function extractionPrompt(title, sourceText) {
  return [
    'Extract ordered steps from this experiment protocol.',
    'Return JSON with a steps array. Each step has instruction, quote, duration, observationMethod, and questions.',
    'quote must be copied from the protocol text.',
    'duration is null unless that duration is written in the quote. Never invent a time, volume, temperature, concentration, or threshold.',
    'Phrases such as "mix thoroughly" stay unknown. Put the missing parameter in questions.',
    'observationMethod is manual, timer, or vision.',
    'Use timer only when the quote states a duration.',
    'Use vision only when the step asks someone to look at color, dye, or dispersion in a frame or image.',
    'Supported vision measures spatial color dispersion in a selected frame. It does not establish chemical success or a mixing endpoint.',
    'Do not mark other steps as vision.',
    'questions lists what the text does not specify.',
    `Title: ${title}`,
    'Protocol text:',
    sourceText,
  ].join('\n')
}

export function validateDraft(sourceText, draft) {
  if (!isRecord(draft) || !Array.isArray(draft.steps)) {
    return ['The model response is not a draft with a steps array.']
  }
  if (typeof sourceText !== 'string' || sourceText.trim() === '') {
    return ['Protocol text is missing.']
  }
  const errors = []
  if (draft.steps.length === 0) errors.push('The draft has no steps.')
  draft.steps.forEach((step, index) => {
    errors.push(...stepErrors(sourceText, step, index))
  })
  return errors
}

function stepErrors(sourceText, step, index) {
  const label = `Step ${index + 1}`
  if (!isRecord(step)) return [`${label} is not an object.`]
  const errors = []
  const { instruction, quote, duration, observationMethod, questions } = step
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
  if (!METHODS.includes(observationMethod)) {
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

export function supportedVision(instruction, quote) {
  const text = `${instruction}\n${quote}`
  const visual = /(color|dye|dispersion|appearance)/i.test(text)
  const looking = /(frame|image|photo|picture|look|observe|visual|see)/i.test(text)
  const overclaims = /(chemical success|mixing endpoint|validated endpoint|concentration|pass\/fail|threshold|volume|temperature|\bpH\b)/i.test(text)
  return visual && looking && !overclaims
}

function containsPhrase(source, phrase) {
  return normalize(source).includes(normalize(phrase))
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
