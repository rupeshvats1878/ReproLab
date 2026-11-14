import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptTimeoutMs, classifyStatus, generateInteractionJson, generateJson, parseCompletedInteraction, retryWaitMs } from './generateJson.mjs'

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

  const explanation = interactionPayload('completed', '{"summary":"B2 stayed open.","uncertainty":"The snapshot does not say why.","citations":[{"runId":"run_demo","eventId":"alert_b2","claim":"B2 was flagged."}]}')
  assert.equal(parseCompletedInteraction(explanation, 'object').draft.summary, 'B2 stayed open.')
  assert.match(parseCompletedInteraction(interactionPayload('incomplete', '{"summary":"partial"}'), 'object').error, /did not complete/)
  assert.match(parseCompletedInteraction(interactionPayload('completed', '[]'), 'object').error, /JSON object/)
  const explained = await generateInteractionJson('prompt', {
    model: 'gemini-4-hydrogen',
    apiKey: 'test-key',
    attemptTimeoutMs: 1000,
    shape: 'object',
    fetchImpl: async (url, request) => {
      const sent = JSON.parse(request.body)
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
      assert.equal(sent.tools, undefined)
      assert.equal(sent.generation_config, undefined)
      return fakeResponse(200, explanation)
    },
    sleep: async () => {},
    now: () => 0,
    random: () => 0,
  })
  assert.equal(explained.citations[0].eventId, 'alert_b2')
})

test('accepts an interaction that arrives after 20 seconds and before 45 seconds', async () => {
  assert.equal(attemptTimeoutMs(undefined), 45_000)
  assert.equal(attemptTimeoutMs('90000'), 60_000)
  const timing = mockTiming()
  const completed = interactionPayload('completed', '{"steps":[{"instruction":"Stir"}]}')
  let calls = 0
  const value = await generateInteractionJson('prompt', {
    ...interactionOptions(timing),
    fetchImpl: async (_url, request) => {
      calls += 1
      timing.advance(30_000)
      assert.equal(request.signal.aborted, false)
      return fakeResponse(200, completed)
    },
  })
  assert.equal(calls, 1)
  assert.equal(timing.elapsed(), 30_000)
  assert.equal(value.steps[0].instruction, 'Stir')
})

test('cancels outstanding work when the 60 second budget expires', async () => {
  const timing = mockTiming()
  let calls = 0
  const stops = []
  await assert.rejects(
    () => generateInteractionJson('prompt', {
      ...interactionOptions(timing),
      fetchImpl: async (_url, request) => {
        calls += 1
        while (!request.signal.aborted) assert.equal(timing.advanceToNext(), true)
        stops.push(timing.elapsed())
        throw abortError()
      },
    }),
    (error) => error.message === 'timeout',
  )
  assert.equal(calls, 2)
  assert.deepEqual(stops, [45_000, 60_000])
})

test('retries a transient failure when the success still fits the budget', async () => {
  const timing = mockTiming()
  const completed = interactionPayload('completed', '{"steps":[{"instruction":"Stir"}]}')
  let calls = 0
  const value = await generateInteractionJson('prompt', {
    ...interactionOptions(timing),
    fetchImpl: async (_url, request) => {
      calls += 1
      if (calls === 1) {
        timing.advance(1_000)
        return fakeResponse(503, {})
      }
      timing.advance(20_000)
      assert.equal(request.signal.aborted, false)
      return fakeResponse(200, completed)
    },
  })
  assert.equal(calls, 2)
  assert.equal(timing.elapsed() < 60_000, true)
  assert.equal(value.steps[0].instruction, 'Stir')
})

function interactionOptions(timing) {
  return {
    model: 'gemini-4-hydrogen',
    apiKey: 'test-key',
    attemptTimeoutMs: 45_000,
    budgetMs: 60_000,
    sleep: (ms) => timing.sleep(ms),
    now: () => timing.now(),
    schedule: (ms, fn) => timing.schedule(ms, fn),
    cancelSchedule: (handle) => timing.cancel(handle),
    random: () => 0,
  }
}

function mockTiming() {
  let clock = 0
  const tasks = []
  function runDue() {
    let progressed = true
    while (progressed) {
      progressed = false
      const next = tasks
        .filter((task) => !task.cancelled && !task.ran && task.at <= clock)
        .sort((left, right) => left.at - right.at)[0]
      if (next) {
        next.ran = true
        next.fn()
        progressed = true
      }
    }
  }
  return {
    now: () => clock,
    elapsed: () => clock,
    schedule(ms, fn) {
      const task = { at: clock + ms, fn, cancelled: false, ran: false }
      tasks.push(task)
      return task
    },
    cancel(task) {
      if (task) task.cancelled = true
    },
    async sleep(ms) {
      clock += ms
      runDue()
    },
    advance(ms) {
      clock += ms
      runDue()
    },
    advanceToNext() {
      const next = tasks
        .filter((task) => !task.cancelled && !task.ran)
        .sort((left, right) => left.at - right.at)[0]
      if (!next) return false
      clock = next.at
      runDue()
      return true
    },
  }
}

function abortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

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
