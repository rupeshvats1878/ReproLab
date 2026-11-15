/**
 * Media time of a run-clock event.
 * `runStartOffsetMs` is the recording position of run time 0.
 * It is negative when monitoring started before the recorder.
 */
export function mediaTimeMs(observationTimestamp: number, runStartOffsetMs: number): number {
  return observationTimestamp + runStartOffsetMs
}

/** Playback position, or null when the event is outside the stored recording. */
export function watchMomentMs(
  observationTimestamp: number,
  runStartOffsetMs: number,
  durationMs: number | null | undefined,
): number | null {
  if (!Number.isInteger(observationTimestamp) || !Number.isInteger(runStartOffsetMs)) return null
  const mediaMs = mediaTimeMs(observationTimestamp, runStartOffsetMs)
  if (mediaMs < 0) return null
  if (durationMs == null) return mediaMs
  if (!Number.isInteger(durationMs) || durationMs < 0 || mediaMs > durationMs) return null
  return mediaMs
}
