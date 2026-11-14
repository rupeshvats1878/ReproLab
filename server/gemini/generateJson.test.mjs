import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyStatus, generateJson, retryWaitMs } from './generateJson.mjs'

const draft = {
  candidates: [{ content: { parts: [{ text: '{"steps":[]}' }] } }],
}

test('does not retry invalid credentials, invalid requests, or missing models', async () => {
  for (const status of [401, 400, 404]) {
    let calls = 0
    await assert.rejects(
      () => generateJson('prompt', {
        model: 'gemini-3.8-flash',
        apiKey: 'test-key',
        attemptTimeoutMs: 1000,
        fetchImpl: async () => {
          calls += 1
          return fakeResponse(status, {})
        },
        sleep: async () => {},
        now: () => 0,
        random: () => 0,
      }),
      (error) => error.status === classifyStatus(status).category || error.message === classifyStatus(status).category,
    )
    assert.equal(calls, 1)
  }
})

test('retries a transient failure twice, then stops', async () => {
  let calls = 0
  const waits = []
  let clock = 0
  await assert.rejects(
    () => generateJson('prompt', {
      model: 'gemini-3.8-flash',
      apiKey: 'test-key',
      attemptTimeoutMs: 1000,
      fetchImpl: async () => {
        calls += 1
        return fakeResponse(503, {})
      },
      sleep: async (ms) => {
        waits.push(ms)
        clock += ms
      },
      now: () => clock,
      random: () => 0,
    }),
    (error) => error.message === 'model_unavailable',
  )
  assert.equal(calls, 3)
  assert.deepEqual(waits, [500, 1000])
})

test('waits for Retry-After and does not wait past the budget', async () => {
  let calls = 0
  await assert.rejects(
    () => generateJson('prompt', {
      model: 'gemini-3.8-flash',
      apiKey: 'test-key',
      attemptTimeoutMs: 1000,
      budgetMs: 2000,
      fetchImpl: async () => {
        calls += 1
        return fakeResponse(429, {}, { 'retry-after': '10' })
      },
      sleep: async () => {
        throw new Error('should not sleep past the budget')
      },
      now: () => 0,
      random: () => 0,
    }),
    (error) => error.message === 'rate_limited',
  )
  assert.equal(calls, 1)
  assert.equal(retryWaitMs({ attempt: 1, retryAfter: 10_000, remainingMs: 2000, random: () => 0 }), null)
})

test('returns parsed JSON after one transient failure', async () => {
  let calls = 0
  const value = await generateJson('prompt', {
    model: 'gemini-3.8-flash',
    apiKey: 'test-key',
    attemptTimeoutMs: 1000,
    fetchImpl: async () => {
      calls += 1
      return calls === 1 ? fakeResponse(503, {}) : fakeResponse(200, draft)
    },
    sleep: async () => {},
    now: () => 0,
    random: () => 0,
  })
  assert.equal(calls, 2)
  assert.deepEqual(value, { steps: [] })
})

test('does not retry an unusable model body', async () => {
  let calls = 0
  await assert.rejects(
    () => generateJson('prompt', {
      model: 'gemini-3.8-flash',
      apiKey: 'test-key',
      attemptTimeoutMs: 1000,
      fetchImpl: async () => {
        calls += 1
        return fakeResponse(200, { candidates: [{ content: { parts: [{ text: 'not-json' }] } }] })
      },
      sleep: async () => {},
      now: () => 0,
      random: () => 0,
    }),
    (error) => error.message === 'model_response_rejected' && error.details[0] === 'The model response was not JSON.',
  )
  assert.equal(calls, 1)
})

test('retries an aborted attempt as a timeout', async () => {
  let calls = 0
  await assert.rejects(
    () => generateJson('prompt', {
      model: 'gemini-3.8-flash',
      apiKey: 'test-key',
      attemptTimeoutMs: 1000,
      budgetMs: 400,
      fetchImpl: async () => {
        calls += 1
        const error = new Error('aborted')
        error.name = 'AbortError'
        throw error
      },
      sleep: async () => {
        throw new Error('should not sleep past the budget')
      },
      now: () => 0,
      random: () => 0,
    }),
    (error) => error.message === 'timeout',
  )
  assert.equal(calls, 1)
})

function fakeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}
