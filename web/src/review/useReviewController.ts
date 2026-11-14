import { useMemo, useRef, useState } from 'react'
import type {
  ElapsedMs,
  HumanEventDraft,
  MediaDraft,
  ObservationDraft,
  ReviewController,
  RunCompletion,
  RunRecord,
  RunStartDraft,
} from '../shared/types.ts'
import { createReviewState, reduceReview, type ReviewAction, type ReviewState } from './engine.ts'

/**
 * Frozen export. App.tsx imports useReviewController from this file.
 * Protocol rules stay in the pure reducer and the shared protocol helpers.
 */
export function useReviewController(): ReviewController {
  const [state, setState] = useState<ReviewState>(createReviewState)
  const stateRef = useRef(state)

  const actions = useMemo(() => {
    const dispatch = (action: ReviewAction) => {
      const next = reduceReview(stateRef.current, action)
      stateRef.current = next
      setState(next)
    }
    return {
      startRun: (draft: RunStartDraft) => dispatch({ type: 'startRun', draft }),
      updateElapsedMs: (elapsedMs: ElapsedMs) => dispatch({ type: 'updateElapsedMs', elapsedMs }),
      recordObservation: (draft: ObservationDraft) => dispatch({ type: 'recordObservation', draft }),
      registerMedia: (media: MediaDraft) => dispatch({ type: 'registerMedia', media }),
      completeRun: (completion: RunCompletion) => dispatch({ type: 'completeRun', completion }),
      acknowledgeOmission: (alertId: string) => dispatch({ type: 'acknowledgeOmission', alertId }),
      resolveOmission: (alertId: string, note?: string) =>
        dispatch({ type: 'resolveOmission', alertId, note }),
      addHumanEvent: (draft: HumanEventDraft) => dispatch({ type: 'addHumanEvent', draft }),
      loadRun: (record: RunRecord) => dispatch({ type: 'loadRun', record }),
    }
  }, [])

  return { protocol: state.protocol, ...actions }
}
