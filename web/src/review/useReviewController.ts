import { useMemo } from 'react'
import { IDLE_PROTOCOL } from '../shared/protocol.ts'
import type { ReviewController } from '../shared/types.ts'

/**
 * REVIEW CONTROLLER STUB
 *
 * Frozen export (do not rename):
 *   export function useReviewController(): ReviewController
 *
 * App.tsx imports it from:
 *   ./review/useReviewController.ts
 *
 * The review developer replaces the function body. Keep this export name and
 * return ReviewController from ../shared/types.ts.
 *
 * This stub returns an idle protocol and ignores every action so the app
 * builds before review logic exists. It does not persist, derive alerts,
 * or load the synthetic fixtures.
 *
 * Required behavior is specified in docs/INTERFACE.md.
 */
export function useReviewController(): ReviewController {
  return useMemo<ReviewController>(
    () => ({
      protocol: IDLE_PROTOCOL,
      startRun: () => {},
      updateElapsedMs: () => {},
      recordObservation: () => {},
      registerMedia: () => {},
      completeRun: () => {},
      acknowledgeOmission: () => {},
      resolveOmission: () => {},
      addHumanEvent: () => {},
      loadRun: () => {},
    }),
    [],
  )
}
