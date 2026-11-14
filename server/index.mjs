import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractionPrompt, validateDraft } from './protocols/validateDraft.mjs'
import { validateExplanation } from './validateExplanation.mjs'

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '.env'))

const port = Number(process.env.PORT || 8787)
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

const server = createServer((req, res) => {
  const origin = req.headers.origin
  if (localDevOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  if (req.method !== 'POST' || (req.url !== '/explain' && req.url !== '/protocols/extract')) {
    send(res, 404, { error: 'not_found' })
    return
  }
  const handle = req.url === '/explain' ? explain : extractProtocol
  readBody(req)
    .then((body) => handle(body))
    .then((result) => send(res, result.status, result.body))
    .catch((error) => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'request_failed'
      const details = error instanceof HttpError ? error.details : []
      send(res, status, details.length > 0 ? { error: message, details } : { error: message })
    })
})

server.listen(port, '127.0.0.1', () => {
  const key = process.env.GEMINI_API_KEY
  console.log(
    `LabBench explain server on http://127.0.0.1:${port} (${key ? 'key present' : 'live AI unavailable'})`,
  )
})

async function explain(raw) {
  const request = JSON.parse(raw)
  if (containsMedia(request)) throw new HttpError(400, 'media_not_accepted')
  const explanation = await generateJson([
    'Explain this colored-water six-well demo.',
    'Use only the JSON. Do not invent run or event ids.',
    'Do not claim the runs prove a cause, that no alerts means no mistakes, or that a final image is a biological assay.',
    'Return JSON with summary, uncertainty, and citations. Each citation has runId, eventId, and claim.',
    'Copy runId and eventId from the input. Say what is uncertain.',
    JSON.stringify(request),
  ].join('\n'))
  const errors = validateExplanation(request, explanation)
  if (errors.length > 0) throw new HttpError(502, 'model_response_rejected')
  return { status: 200, body: explanation }
}

async function extractProtocol(raw) {
  const request = JSON.parse(raw)
  if (containsMedia(request)) throw new HttpError(400, 'media_not_accepted')
  const title = request?.title
  const sourceText = request?.sourceText
  if (typeof title !== 'string' || title.trim() === '' || title.length > 200) {
    throw new HttpError(400, 'title_required')
  }
  if (typeof sourceText !== 'string' || sourceText.trim() === '' || sourceText.length > 20000) {
    throw new HttpError(400, 'protocol_text_required')
  }
  const draft = await generateJson(extractionPrompt(title.trim(), sourceText))
  const errors = validateDraft(sourceText, draft)
  if (errors.length > 0) throw new HttpError(502, 'model_response_rejected', errors)
  return { status: 200, body: { steps: draft.steps } }
}

async function generateJson(prompt) {
  if (!process.env.GEMINI_API_KEY) throw new HttpError(503, 'missing_credentials')
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new HttpError(502, 'model_request_failed')
  const payload = await response.json()
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(502, 'model_response_rejected', ['The model response was not JSON.'])
  }
}

function containsMedia(value) {
  if (typeof value === 'string') return value.startsWith('data:')
  if (Array.isArray(value)) return value.some(containsMedia)
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, inner]) => {
      const name = key.toLowerCase()
      if (name.includes('blob') || name.includes('image') || name.includes('video') || name === 'dataurl') {
        return true
      }
      return containsMedia(inner)
    })
  }
  return false
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(json)
}

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (process.env[key] == null) process.env[key] = value
  }
}

function localDevOrigin(origin) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

class HttpError extends Error {
  constructor(status, message, details = []) {
    super(message)
    this.status = status
    this.details = details
  }
}
