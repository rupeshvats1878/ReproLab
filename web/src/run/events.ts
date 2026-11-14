import { ANALYSIS_METHOD } from '../reference/measure.ts'
import { jpegByteLength, MAX_JPEG_BYTES, type FrozenCapture } from '../reference/captureFrame.ts'

export interface ObservationSource {
  clipId: string
  title: string
  locator: string
}

export function eventIdForAttempt(existing: string | null): string {
  return existing ?? crypto.randomUUID()
}

export function idForUnchangedAttempt(state: { signature: string; id: string } | null, signature: string) {
  if (state?.signature === signature) return { signature, id: state.id }
  return { signature, id: crypto.randomUUID() }
}

export function buildHumanCompletion(id: string, stepIndex: number, note: string) {
  const body: { id: string; type: 'human_completion'; stepIndex: number; note?: string } = {
    id,
    type: 'human_completion',
    stepIndex,
  }
  const trimmed = note.trim()
  if (trimmed) body.note = trimmed
  return body
}

export function buildCorrection(id: string, stepIndex: number, correctsEventId: string, note: string) {
  return {
    id,
    type: 'correction' as const,
    stepIndex,
    correctsEventId,
    note: note.trim(),
  }
}

export function buildImageObservation(input: {
  id: string
  stepIndex: number
  capturedAt: string
  provenance: 'own_recording' | 'imported_reference'
  source: ObservationSource
  capture: FrozenCapture
}) {
  if (jpegByteLength(input.capture.imageBase64) > MAX_JPEG_BYTES || input.capture.byteLength > MAX_JPEG_BYTES) {
    throw new Error('The JPEG is larger than 256 KiB. Capture a smaller frame before attaching it.')
  }
  if (input.capture.measurement.quality === 'rejected' && input.capture.measurement.value !== null) {
    throw new Error('A rejected measurement cannot be saved as a number.')
  }
  return {
    id: input.id,
    type: 'image_observation' as const,
    stepIndex: input.stepIndex,
    capturedAt: input.capturedAt,
    provenance: input.provenance,
    imageBase64: input.capture.imageBase64,
    source: { ...input.source },
    videoTimeSec: input.capture.videoTimeSec,
    crop: { ...input.capture.crop },
    measurement: {
      metric: 'spatial_color_dispersion' as const,
      value: input.capture.measurement.value,
      quality: input.capture.measurement.quality,
      reason: input.capture.measurement.reason,
      analysisVersion: ANALYSIS_METHOD,
    },
  }
}
