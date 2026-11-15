// Authored synthetic parser fixtures; not captures or model performance evidence.
export const base = {
  schemaVersion: 'three-cup-gemini-observation/v0.1', sessionId: 'synthetic-acceptance', videoId: 'synthetic-video',
  events: [{ sourceCupId: 'RED', destinationCupId: 'BLUE', eventStartMs: 85000, eventEndMs: 86000, evidenceTimestampsMs: [85500], observationStatus: 'observed', needsHumanVerification: true }],
  appearances: [], observationStatus: 'observed', needsHumanVerification: true, modelId: 'fixture-only', latencyMs: null,
  error: null, warnings: [], videoDurationMs: 8000, sourceOffsetMs: 84000, remoteCallMade: false,
}
export const disabled = { ...structuredClone(base), events: [], observationStatus: 'unavailable', error: { category: 'remote_disabled', message: 'Synthetic disabled-state test.' } }
const cases = []
function add(name, mutate, expectedState, layer) {
  const payload = structuredClone(base); mutate(payload)
  cases.push({ name, payload, expectedState, layer, expected: { sessionId: base.sessionId, videoId: base.videoId }, ...(expectedState === 'hypothesis' ? { expectedFirstEventStartMs: 85000 } : {}) })
}
add('valid known pair', () => {}, 'hypothesis')
add('unknown cup', p => { p.events[0].sourceCupId = 'unknown' }, 'uncertain')
add('unclear model', p => { p.observationStatus = 'unclear' }, 'uncertain')
add('empty unknown', p => { p.events = [] }, 'uncertain')
add('explicit no transfer', p => { p.events = []; p.observationStatus = 'no_transfer' }, 'no-transfer')
add('disabled adapter', p => Object.assign(p, structuredClone(disabled)), 'unavailable')
add('wrong session', p => { p.sessionId = 'other-session' }, 'rejected')
add('wrong schema', p => { p.schemaVersion = 'bad' }, 'rejected')
add('negative time', p => { p.events[0].eventStartMs = -1 }, 'rejected')
add('reversed interval', p => { p.events[0].eventEndMs = 84999 }, 'rejected')
add('zero duration', p => { p.events[0].eventEndMs = 85000 }, 'rejected')
add('outside clip', p => { p.events[0].eventEndMs = 93000 }, 'rejected')
add('evidence outside event', p => { p.events[0].evidenceTimestampsMs = [87000] }, 'uncertain')
add('evidence outside clip', p => { p.events[0].evidenceTimestampsMs = [93000] }, 'rejected')
add('same cups', p => { p.events[0].destinationCupId = 'RED' }, 'rejected')
add('wrong offset', p => { p.sourceOffsetMs = 0 }, 'rejected')
add('stale wrapper', () => {}, 'rejected', 'request_wrapper')
export const fixtures = { cases }
