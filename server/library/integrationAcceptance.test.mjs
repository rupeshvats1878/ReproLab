import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { acceptAdapterResult, beginClipCheck, resetClipChecks } from './clipObservation.mjs'

const parserUrl = pathToFileURL('C:/Users/rupes/OneDrive/Documents/GitHub/labbench/web/src/capture/geminiObservation.ts')
const { reviewModelObservation } = await import(parserUrl.href)

const FIXTURES = 'C:/Users/rupes/Projects/labbench-codex-offline/server/three-cup-offline/tests/fixtures/integration_cases.json'
const DISABLED = 'C:/Users/rupes/Projects/labbench-codex-offline/server/three-cup-offline/local/integration/adapter-disabled-response.json'
const ACTIVE = 'request_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OLD = 'request_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'))
const disabled = JSON.parse(readFileSync(DISABLED, 'utf8'))

function jobFor(fixture, requestId) {
  const offset = Number.isInteger(fixture.payload?.sourceOffsetMs) ? fixture.payload.sourceOffsetMs : 0
  const duration = Number.isInteger(fixture.payload?.videoDurationMs) ? fixture.payload.videoDurationMs : 1000
  return {
    sessionId: fixture.expected.sessionId,
    videoId: fixture.expected.videoId,
    requestId,
    sourceOffsetMs: offset,
    clipStartMs: offset,
    clipEndMs: offset + duration,
  }
}

test('synthetic acceptance fixtures pass through the wrapper', () => {
  assert.equal(fixtures.cases.length, 15)
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
      const review = reviewModelObservation(fixture.payload, fixture.expected)
      assert.equal(review.state, fixture.expectedState, fixture.name)
      assert.deepEqual(review.raw, fixture.payload, fixture.name)
      if (fixture.expectedFirstEventStartMs != null) {
        assert.equal(review.events[0].eventStartMs, fixture.expectedFirstEventStartMs, fixture.name)
      }
    }
    results.push({ name: fixture.name, layer: fixture.layer ?? 'parser', status: 'passed', actualState: result.status })
  }
  writeFileSync(new URL('./integration-acceptance-record.json', import.meta.url), JSON.stringify({
    synthetic: true,
    fixtureCursorCommit: fixtures.cursorCommit,
    adapterCommit: 'a34c5a6b9dc29c5bdf9f8f382c48755c98c3d1c6',
    probe: 'Codex probe_integration.mjs loads only the parser and reports the stale case as blocked. This wrapper run rejects that same-session old request.',
    results,
  }, null, 2))
})

test('the captured disabled adapter response stays unavailable and makes no remote call', () => {
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
