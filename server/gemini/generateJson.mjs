export const DEFAULT_MODEL = 'gemini-4-hydrogen'
export const EXTRACTION_BUDGET_MS = 60_000
export const MAX_RETRIES = 2
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 45_000
const MIN_ATTEMPT_MS = 250

export function attemptTimeoutMs(configured, budgetMs = EXTRACTION_BUDGET_MS) {
  const value = Number(configured)
  const chosen = Number.isFinite(value) && value > 0 ? value : DEFAULT_ATTEMPT_TIMEOUT_MS
  return Math.min(chosen, budgetMs)
}

export function classifyStatus(status) {
  if (status === 401 || status === 403) return { category: 'invalid_credentials', retry: false }
  if (status === 400) return { category: 'invalid_request', retry: false }
  if (status === 404) return { category: 'model_unavailable', retry: false }
  if (status === 429) return { category: 'rate_limited', retry: true }
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return { category: 'model_unavailable', retry: true }
  }
  return { category: 'model_unavailable', retry: false }
}

export function clientStatus(category) {
  if (category === 'invalid_credentials') return 401
  if (category === 'rate_limited') return 429
  if (category === 'timeout') return 504
  if (category === 'model_unavailable') return 503
  if (category === 'missing_credentials') return 503
  return 502
}

export function retryAfterMs(header, nowMs) {
  if (typeof header !== 'string' || header.trim() === '') return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - nowMs)
  return null
}

export function retryWaitMs({ attempt, retryAfter, remainingMs, random }) {
  if (attempt < 1 || remainingMs <= 0) return null
  const backoff = 500 * 2 ** (attempt - 1) + Math.floor(random() * 250)
  const planned = retryAfter == null ? backoff : retryAfter
  if (planned < 0 || planned >= remainingMs) return null
  return planned
}

export class GeminiError extends Error {
  constructor(status, message, details = []) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function interactionText(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : []
  return steps.flatMap((step) => Array.isArray(step.content) ? step.content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

export function parseCompletedInteraction(payload, shape = 'steps') {
  if (!payload || payload.status !== 'completed') {
    const status = typeof payload?.status === 'string' ? payload.status : 'missing'
    return { error: `The Gemini interaction did not complete (${status}).` }
  }
  const text = interactionText(payload).trim()
  if (text === '') return { error: 'The Gemini interaction returned no text.' }
  try {
    const draft = JSON.parse(text)
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      return { error: 'The model response was not a JSON object.' }
    }
    if (shape === 'steps' && (!Array.isArray(draft.steps) || draft.steps.length === 0)) {
      return { error: 'The model response did not contain a completed steps array.' }
    }
    return { draft }
  } catch {
    return { error: 'The model response was not JSON.' }
  }
}

export async function generateJson(prompt, options) {
  return runAttempts(options, (timeoutMs, fetchImpl, deadlineSignal, schedule, cancelSchedule) => oneAttempt({
    prompt,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs,
    fetchImpl,
    deadlineSignal,
    schedule,
    cancelSchedule,
  }))
}

export async function generateInteractionJson(prompt, options) {
  return runAttempts(options, (timeoutMs, fetchImpl, deadlineSignal, schedule, cancelSchedule) => oneInteraction({
    prompt,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs,
    fetchImpl,
    shape: options.shape ?? 'steps',
    deadlineSignal,
    schedule,
    cancelSchedule,
  }))
}

async function runAttempts(options, perform) {
  const apiKey = options.apiKey
  if (!apiKey) throw new GeminiError(503, 'missing_credentials')
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? Math.random
  const budgetMs = options.budgetMs ?? EXTRACTION_BUDGET_MS
  const maxRetries = options.maxRetries ?? MAX_RETRIES
  const schedule = options.schedule ?? ((ms, fn) => setTimeout(fn, ms))
  const cancelSchedule = options.cancelSchedule ?? ((handle) => clearTimeout(handle))
  const started = now()
  const deadline = new AbortController()
  const deadlineTimer = schedule(budgetMs, () => deadline.abort())
  let lastError = new GeminiError(504, 'timeout')

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const remainingMs = budgetMs - (now() - started)
      if (remainingMs < MIN_ATTEMPT_MS || deadline.signal.aborted) throw lastError
      const outcome = await perform(
        Math.min(options.attemptTimeoutMs, remainingMs),
        fetchImpl,
        deadline.signal,
        schedule,
        cancelSchedule,
      )
      if (outcome.ok) return outcome.value
      lastError = outcome.error
      const remainingAfterFailure = budgetMs - (now() - started)
      const retriesLeft = attempt < maxRetries && outcome.retry && !deadline.signal.aborted
      const wait = retriesLeft
        ? retryWaitMs({
            attempt: attempt + 1,
            retryAfter: outcome.retryAfter,
            remainingMs: remainingAfterFailure,
            random,
          })
        : null
      if (wait == null || remainingAfterFailure - wait < MIN_ATTEMPT_MS) throw lastError
      await sleep(wait)
    }
    throw lastError
  } finally {
    cancelSchedule(deadlineTimer)
  }
}

async function oneAttempt({ prompt, model, apiKey, timeoutMs, fetchImpl, deadlineSignal, schedule, cancelSchedule }) {
  const attempt = armAttempt({ timeoutMs, deadlineSignal, schedule, cancelSchedule })
  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
        signal: attempt.signal,
      },
    )
    if (!response.ok) {
      const failure = classifyStatus(response.status)
      return {
        ok: false,
        retry: failure.retry,
        retryAfter: retryAfterMs(response.headers?.get?.('retry-after') ?? null, Date.now()),
        error: new GeminiError(clientStatus(failure.category), failure.category),
      }
    }
    const payload = await response.json()
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch {
      return {
        ok: false,
        retry: false,
        retryAfter: null,
        error: new GeminiError(502, 'model_response_rejected', ['The model response was not JSON.']),
      }
    }
  } catch (error) {
    if (error instanceof GeminiError) throw error
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { ok: false, retry: true, retryAfter: null, error: new GeminiError(504, 'timeout') }
    }
    return { ok: false, retry: true, retryAfter: null, error: new GeminiError(503, 'model_unavailable') }
  } finally {
    attempt.cleanup()
  }
}

async function oneInteraction({ prompt, model, apiKey, timeoutMs, fetchImpl, shape, deadlineSignal, schedule, cancelSchedule }) {
  const attempt = armAttempt({ timeoutMs, deadlineSignal, schedule, cancelSchedule })
  try {
    const response = await fetchImpl(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          input: prompt,
          response_format: { type: 'text', mime_type: 'application/json' },
        }),
        signal: attempt.signal,
      },
    )
    if (!response.ok) {
      const failure = classifyStatus(response.status)
      return {
        ok: false,
        retry: failure.retry,
        retryAfter: retryAfterMs(response.headers?.get?.('retry-after') ?? null, Date.now()),
        error: new GeminiError(clientStatus(failure.category), failure.category),
      }
    }
    const payload = await response.json()
    const parsed = parseCompletedInteraction(payload, shape)
    if (parsed.error) {
      return {
        ok: false,
        retry: false,
        retryAfter: null,
        error: new GeminiError(502, 'model_response_rejected', [parsed.error]),
      }
    }
    return { ok: true, value: parsed.draft }
  } catch (error) {
    if (error instanceof GeminiError) throw error
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { ok: false, retry: true, retryAfter: null, error: new GeminiError(504, 'timeout') }
    }
    return { ok: false, retry: true, retryAfter: null, error: new GeminiError(503, 'model_unavailable') }
  } finally {
    attempt.cleanup()
  }
}

function armAttempt({ timeoutMs, deadlineSignal, schedule, cancelSchedule }) {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort()
  }
  if (deadlineSignal?.aborted) abort()
  else deadlineSignal?.addEventListener('abort', abort)
  const timer = schedule(timeoutMs, abort)
  return {
    signal: controller.signal,
    cleanup() {
      cancelSchedule(timer)
      deadlineSignal?.removeEventListener('abort', abort)
    },
  }
}
