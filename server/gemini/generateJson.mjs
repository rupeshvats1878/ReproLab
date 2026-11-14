export const DEFAULT_MODEL = 'gemini-4-hydrogen'
export const EXTRACTION_BUDGET_MS = 60_000
export const MAX_RETRIES = 2
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 20_000

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
  return runAttempts(options, (timeoutMs, fetchImpl) => oneAttempt({
    prompt,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs,
    fetchImpl,
  }))
}

export async function generateInteractionJson(prompt, options) {
  return runAttempts(options, (timeoutMs, fetchImpl) => oneInteraction({
    prompt,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs,
    fetchImpl,
    shape: options.shape ?? 'steps',
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
  const started = now()
  let lastError = new GeminiError(504, 'timeout')

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const remainingMs = budgetMs - (now() - started)
    if (remainingMs < 250) throw lastError
    const outcome = await perform(Math.min(options.attemptTimeoutMs, remainingMs), fetchImpl)
    if (outcome.ok) return outcome.value
    lastError = outcome.error
    const retriesLeft = attempt < maxRetries && outcome.retry
    const wait = retriesLeft
      ? retryWaitMs({
          attempt: attempt + 1,
          retryAfter: outcome.retryAfter,
          remainingMs: budgetMs - (now() - started),
          random,
        })
      : null
    if (wait == null) throw lastError
    await sleep(wait)
  }
  throw lastError
}

async function oneAttempt({ prompt, model, apiKey, timeoutMs, fetchImpl }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
        signal: controller.signal,
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
    clearTimeout(timer)
  }
}

async function oneInteraction({ prompt, model, apiKey, timeoutMs, fetchImpl, shape }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
        signal: controller.signal,
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
    clearTimeout(timer)
  }
}
