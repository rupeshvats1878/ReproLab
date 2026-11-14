/**
 * Live run clock. `origin` and `now` are performance.now() milliseconds.
 * This is not wall-clock time and not a MediaRecorder chunk index.
 */
export function liveElapsedMs(now: number, origin: number): number {
  return Math.max(0, Math.round(now - origin))
}

/** The controller ignores decreases. Keep the vision clock from stepping backwards too. */
export function monotonicElapsed(next: number, previous: number): number {
  if (!Number.isFinite(next)) return previous
  const rounded = Math.round(next)
  if (rounded < previous) return previous
  return rounded
}

/**
 * Prerecorded clock. `runStartOffsetMs` is the media time of run t = 0.
 * Returns null before that point in the file.
 */
export function prerecordedElapsedMs(
  currentTimeSec: number,
  runStartOffsetMs: number,
): number | null {
  if (!Number.isFinite(currentTimeSec) || !Number.isFinite(runStartOffsetMs)) return null
  const elapsed = Math.round(currentTimeSec * 1000 - runStartOffsetMs)
  if (elapsed < 0) return null
  return elapsed
}

/**
 * Media position of run t = 0.
 * Positive when the recording or file was already moving before the run started.
 * Negative when the run clock started before the recorder did.
 */
export function runStartOffsetFromClocks(runStartPerf: number, mediaStartPerf: number): number {
  return Math.round(runStartPerf - mediaStartPerf)
}

/** A seek or replay moved backwards. Normal forward playback is not a jump. */
export function isBackwardJump(
  previousSec: number,
  currentSec: number,
  toleranceSec = 0.05,
): boolean {
  if (!Number.isFinite(previousSec) || !Number.isFinite(currentSec)) return false
  return currentSec < previousSec - toleranceSec
}
