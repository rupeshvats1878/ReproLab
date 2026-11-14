import { describe, expect, it } from 'vitest'
import { ANALYSIS_METHOD, measure, validRegion } from './measure.ts'
import { methodVersionLabel, readEvidenceList } from './evidence.ts'
import { buildCorrection, buildHumanCompletion, buildImageObservation, eventIdForAttempt, idForUnchangedAttempt } from '../run/events.ts'
import type { FrozenCapture } from './captureFrame.ts'
function pixels(color: (x: number) => number[]) {
  const out = new Uint8ClampedArray(60 * 60 * 4)
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) out.set([...color(x), 255], (y * 60 + x) * 4)
  return out
}
describe('reference measurements', () => {
  it('distinguishes spatially different colors from a uniform field', () => {
    const uniform = measure(pixels(() => [150, 100, 80]), 60, 60)
    const split = measure(pixels(x => x < 30 ? [180, 70, 70] : [70, 180, 70]), 60, 60)
    expect(uniform.quality).toBe('accepted')
    expect(uniform.dispersion).toBeLessThan(0.00001)
    expect(split.dispersion).toBeGreaterThan(0.1)
  })
  it('rejects clipped images rather than declaring them uniform', () => {
    expect(measure(pixels(() => [255, 255, 255]), 60, 60).dispersion).toBeNull()
    expect(measure(pixels(() => [0, 0, 0]), 60, 60).quality).toBe('rejected')
  })
  it('keeps the analysis method separate from legacy captures', () => {
    expect(ANALYSIS_METHOD).toBe('rgb-chromaticity-6x6-v1')
    expect(measure(pixels(() => [150, 100, 80]), 60, 60).analysisVersion).toBeUndefined()
    const legacy = readEvidenceList([{
      id: 'old', clipId: 'nonrotating', title: 'MIT • Non-rotating tank', source: 'https://example.test',
      time: 20, region: { x: 32, y: 25, width: 36, height: 50 },
      result: { quality: 'accepted', reason: 'Pixel quality check passed; no threshold is applied', dispersion: 0.05, clippedFraction: 0 },
      image: 'data:image/jpeg;base64,AAAA', capturedAt: '2026-11-14T20:00:00.000Z',
    }])
    expect(legacy).toHaveLength(1)
    expect(methodVersionLabel(legacy[0]!.result)).toBe('method version not recorded')
    const current = readEvidenceList([{ ...legacy[0], result: { ...legacy[0]!.result, analysisVersion: ANALYSIS_METHOD } }])
    expect(methodVersionLabel(current[0]!.result)).toBe(ANALYSIS_METHOD)
  })

  it('reuses an event id for the same request and keeps a rejected value null', () => {
    const first = eventIdForAttempt(null)
    expect(eventIdForAttempt(first)).toBe(first)
    const same = idForUnchangedAttempt({ signature: 'completion', id: first }, 'completion')
    const changed = idForUnchangedAttempt(same, 'completion-edited')
    expect(same.id).toBe(first)
    expect(changed.id).not.toBe(first)
    expect(buildHumanCompletion(first, 1, '  done  ')).toEqual({ id: first, type: 'human_completion', stepIndex: 1, note: 'done' })
    expect(buildCorrection('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, first, ' wrong step ')).toEqual({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', type: 'correction', stepIndex: 1, correctsEventId: first, note: 'wrong step',
    })
    const capture: FrozenCapture = {
      imageDataUrl: 'data:image/jpeg;base64,QQ==', imageBase64: 'QQ==', byteLength: 1, videoTimeSec: 12.5,
      crop: { x: 32, y: 25, width: 36, height: 50 },
      measurement: { metric: 'spatial_color_dispersion', value: null, quality: 'rejected', reason: 'Too dark', analysisVersion: ANALYSIS_METHOD },
      localResult: { quality: 'rejected', reason: 'Too dark', dispersion: null, clippedFraction: 1, analysisVersion: ANALYSIS_METHOD },
    }
    const body = buildImageObservation({
      id: first, stepIndex: 3, capturedAt: '2026-11-14T22:16:14.748Z', provenance: 'imported_reference',
      source: { clipId: 'nonrotating', title: 'MIT • Non-rotating tank', locator: 'https://example.test' }, capture,
    })
    expect(body.measurement.value).toBeNull()
    expect(body.measurement.analysisVersion).toBe(ANALYSIS_METHOD)
    expect(body).not.toHaveProperty('schema')
    expect(() => buildImageObservation({
      id: first, stepIndex: 3, capturedAt: '2026-11-14T22:16:14.748Z', provenance: 'imported_reference',
      source: { clipId: 'nonrotating', title: 'MIT • Non-rotating tank', locator: 'https://example.test' },
      capture: { ...capture, measurement: { ...capture.measurement, value: 0 } },
    })).toThrow(/rejected/)
  })

  it('rejects invalid regions and undersized pixel arrays', () => {
    expect(validRegion({ x: 90, y: 0, width: 20, height: 20 })).toBe(false)
    expect(validRegion({ x: 20, y: 20, width: 30, height: 30 })).toBe(true)
    expect(measure(new Uint8ClampedArray(4), 60, 60).quality).toBe('rejected')
  })
})
