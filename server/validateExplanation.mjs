export function validateExplanation(request, response) {
  const errors = []
  if (!isRecord(response)) return ['Explanation response is not an object.']
  if (typeof response.summary !== 'string' || response.summary.trim() === '') {
    errors.push('Explanation summary is missing.')
  }
  if (typeof response.uncertainty !== 'string' || response.uncertainty.trim() === '') {
    errors.push('Explanation uncertainty is missing.')
  }
  if (!Array.isArray(response.citations)) {
    errors.push('Explanation citations are missing.')
    return errors
  }
  const ids = new Map(request.runs.map((run) => [run.id, allowedIds(run)]))
  response.citations.forEach((citation, index) => {
    if (!isRecord(citation)) {
      errors.push(`Citation ${index} is not an object.`)
      return
    }
    const { runId, eventId, claim } = citation
    if (typeof runId !== 'string' || typeof eventId !== 'string' || typeof claim !== 'string' || !claim.trim()) {
      errors.push(`Citation ${index} is incomplete.`)
      return
    }
    const allowed = ids.get(runId)
    if (!allowed || !allowed.has(eventId)) {
      errors.push(`Citation ${index} references an unknown run or event.`)
    }
  })
  return errors
}

function allowedIds(run) {
  return new Set([
    ...run.alerts.map((alert) => alert.id),
    ...run.events.map((event) => event.id),
    ...run.observations.map((observation) => observation.id),
  ])
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
