import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyStatus, generateInteractionJson, generateJson, parseCompletedInteraction, retryWaitMs } from './generateJson.mjs'

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

test('reads a completed interaction and rejects unfinished output', async () => {
  const completed = interactionPayload('completed', '{"steps":[{"instruction":"Stir","quote":"Stir cup A for 10 seconds.","duration":"10 seconds","observationMethod":"timer","questions":[]}]}')
  assert.equal(parseCompletedInteraction(completed).draft.steps[0].duration, '10 seconds')
  for (const status of ['failed', 'incomplete', 'in_progress', 'cancelled']) {
    const parsed = parseCompletedInteraction(interactionPayload(status, '{"steps":[{"instruction":"x"}]}'))
    assert.equal(parsed.draft, undefined)
    assert.match(parsed.error, /did not complete/)
  }
  assert.match(parseCompletedInteraction(interactionPayload('completed', '')).error, /no text/)
  assert.match(parseCompletedInteraction(interactionPayload('completed', 'not-json')).error, /not JSON/)
  assert.match(parseCompletedInteraction(interactionPayload('completed', '{"steps":[]}')).error, /steps array/)

  let body = null
  const value = await generateInteractionJson('prompt', {
    model: 'gemini-4-hydrogen',
    apiKey: 'test-key',
    attemptTimeoutMs: 1000,
    fetchImpl: async (url, request) => {
      body = JSON.parse(request.body)
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
      return fakeResponse(200, completed)
    },
    sleep: async () => {},
    now: () => 0,
    random: () => 0,
  })
  assert.equal(body.model, 'gemini-4-hydrogen')
  assert.equal(body.input, 'prompt')
  assert.deepEqual(body.response_format, { type: 'text', mime_type: 'application/json' })
  assert.equal(body.tools, undefined)
  assert.equal(body.generation_config, undefined)
  assert.equal(value.steps.length, 1)
})

function interactionPayload(status, text) {
  return {
    status,
    steps: text === '' ? [] : [{ type: 'model_output', content: [{ type: 'text', text }] }],
  }
}

function fakeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}
