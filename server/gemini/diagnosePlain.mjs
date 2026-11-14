import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyStatus } from './generateJson.mjs'

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'))

const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
const apiKey = process.env.GEMINI_API_KEY
if (!apiKey || apiKey === 'PASTE_YOUR_KEY_HERE') {
  console.log(JSON.stringify({ model, elapsedMs: 0, httpStatus: 0, category: 'missing_credentials' }))
  process.exit(1)
}

const started = Date.now()
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 90_000)
let httpStatus = 0
let category = 'network'
let finishReason = null
let textLength = 0
let thoughtParts = 0
let reply = ''
let promptTokens = null
let candidateTokens = null
let thoughtTokens = null

try {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly OK.' }] }],
      }),
      signal: controller.signal,
    },
  )
  httpStatus = response.status
  const raw = (await response.text()).split(apiKey).join('[redacted]')
  if (!response.ok) {
    category = classifyStatus(httpStatus).category
    try {
      const parsed = JSON.parse(raw)
      finishReason = parsed?.error?.status ?? null
    } catch {
      finishReason = null
    }
  } else {
    const payload = JSON.parse(raw)
    const parts = payload?.candidates?.[0]?.content?.parts ?? []
    thoughtParts = parts.filter((part) => part?.thought === true).length
    reply = parts.filter((part) => part?.thought !== true).map((part) => part.text ?? '').join('')
    textLength = reply.length
    finishReason = payload?.candidates?.[0]?.finishReason ?? null
    promptTokens = payload?.usageMetadata?.promptTokenCount ?? null
    candidateTokens = payload?.usageMetadata?.candidatesTokenCount ?? null
    thoughtTokens = payload?.usageMetadata?.thoughtsTokenCount ?? null
    category = reply.includes('OK') ? 'ok' : 'unexpected_text'
  }
} catch (error) {
  category = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network'
} finally {
  clearTimeout(timer)
}

console.log(JSON.stringify({
  model,
  elapsedMs: Date.now() - started,
  httpStatus,
  category,
  finishReason,
  textLength,
  thoughtParts,
  reply: reply.slice(0, 80),
  promptTokens,
  candidateTokens,
  thoughtTokens,
}))

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
