import assert from 'node:assert/strict'
import { fixtures, disabled } from './fixtures/adapterCases.mjs'
import test from 'node:test'
import { acceptAdapterResult, beginClipCheck, resetClipChecks } from './clipObservation.mjs'

const { reviewModelObservation } = await import(new URL('../../web/src/capture/geminiObservation.ts', import.meta.url))

const ACTIVE = 'request_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OLD = 'request_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'


function jobFor(fixture, requestId) {
  return {
    sessionId: fixture.expected.sessionId,
    videoId: fixture.expected.videoId,
    requestId,
    sourceOffsetMs: 84_000,
    clipStartMs: 84_000,
    clipEndMs: 92_000,
  }
}

test('synthetic acceptance fixtures pass through the wrapper', () => {
  assert.equal(fixtures.cases.length, 17)
  const results = []
  for (const fixture of fixtures.cases) {
    resetClipChecks()
    const job = beginClipCheck(jobFor(fixture, ACTIVE))
    const responseId = fixture.layer === 'request_wrapper' ? OLD : undefined
    const result = acceptAdapterResult(job, fixture.payload, responseId)
    assert.equal(result.status, fixture.expectedState, fixture.name)
    assert.equal(result.sessionId, fixture.expected.sessionId, fixture.name)
    assert.equal(result.videoId, fixture.expected.videoId, fixture.name)
    assert.equal(result.needsHumanVerification, true, fixture.name)
    if (fixture.layer === 'request_wrapper') {
      assert.equal(result.reason, 'stale', fixture.name)
      assert.deepEqual(result.events, [], fixture.name)
    }
    if (fixture.expectedFirstEventStartMs != null && result.status === 'hypothesis') {
      assert.equal(result.events[0].eventStartMs, fixture.expectedFirstEventStartMs, fixture.name)
      assert.equal(result.raw.events[0].eventStartMs, fixture.expectedFirstEventStartMs, fixture.name)
      assert.equal(result.sourceOffsetMs, fixture.payload.sourceOffsetMs, fixture.name)
    }
    if (result.status !== 'rejected') assert.deepEqual(result.raw, fixture.payload, fixture.name)
    if (fixture.layer !== 'request_wrapper') {
      const review = reviewModelObservation(fixture.payload, { ...fixture.expected, clipStartMs: 84_000, clipEndMs: 92_000 })
      assert.equal(review.state, fixture.expectedState, fixture.name)
      assert.deepEqual(review.raw, fixture.payload, fixture.name)
      if (fixture.expectedFirstEventStartMs != null) {
        assert.equal(review.events[0].eventStartMs, fixture.expectedFirstEventStartMs, fixture.name)
      }
    }
    results.push({ name: fixture.name, layer: fixture.layer ?? 'parser', status: 'passed', actualState: result.status })
  }
  assert.equal(results.every((result) => result.status === 'passed'), true)
})

test('a synthetic disabled adapter response stays unavailable and makes no remote call', () => {
  resetClipChecks()
  const job = beginClipCheck({
    sessionId: disabled.sessionId,
    videoId: disabled.videoId,
    requestId: ACTIVE,
    sourceOffsetMs: disabled.sourceOffsetMs,
    clipStartMs: disabled.sourceOffsetMs,
    clipEndMs: disabled.sourceOffsetMs + disabled.videoDurationMs,
  })
  const result = acceptAdapterResult(job, disabled)
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reason, 'remote_disabled')
  assert.equal(result.remoteCallMade, false)
  assert.equal(result.needsHumanVerification, true)
  assert.equal(result.raw.latencyMs, null)
  assert.equal(result.raw.remoteCallMade, false)
  assert.deepEqual(result.events, [])
  assert.equal(result.sourceOffsetMs, 84000)
  assert.equal(result.raw.sourceOffsetMs, 84000)
  assert.notEqual(result.reason, 'no-transfer')
})
