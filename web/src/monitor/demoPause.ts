import type { LiveMonitorState } from './liveDecisions.ts'

export type DemoSource = 'live' | 'prerecorded' | 'synthetic' | 'unspecified'

export interface DemoPresentation {
  pauseOnIssue: boolean
  paused: boolean
  handledAlertIds: ReadonlySet<string>
  correctionNote: string | null
}

export function initialDemoPresentation(): DemoPresentation {
  return { pauseOnIssue: true, paused: false, handledAlertIds: new Set(), correctionNote: null }
}

/**
 * Presentation only. This does not acknowledge, correct, or create an observation.
 * A live camera or imported video is returned unchanged.
 */
export function afterSyntheticObservation(
  presentation: DemoPresentation,
  source: DemoSource,
  previous: LiveMonitorState,
  next: LiveMonitorState,
): DemoPresentation {
  if (source !== 'synthetic') return presentation
  const correctionNote = correctionLine(presentation.correctionNote, previous, next)
  const noted = correctionNote === presentation.correctionNote ? presentation : { ...presentation, correctionNote }
  if (!presentation.pauseOnIssue || presentation.paused) return noted
  const fresh = next.alerts.find(
    (alert) =>
      alert.status === 'open' &&
      !previous.alerts.some((item) => item.id === alert.id) &&
      !presentation.handledAlertIds.has(alert.id),
  )
  if (!fresh) return noted
  const handledAlertIds = new Set(presentation.handledAlertIds)
  handledAlertIds.add(fresh.id)
  return { ...noted, paused: true, handledAlertIds }
}

/** Resume playback. The monitor state is not an input and is not changed. */
export function continueDemoPlayback(presentation: DemoPresentation): DemoPresentation {
  if (!presentation.paused) return presentation
  return { ...presentation, paused: false }
}

export function setPauseOnIssue(presentation: DemoPresentation, enabled: boolean): DemoPresentation {
  return { ...presentation, pauseOnIssue: enabled, paused: enabled ? presentation.paused : false }
}

export function resetDemoPresentation(pauseOnIssue: boolean): DemoPresentation {
  return { pauseOnIssue, paused: false, handledAlertIds: new Set(), correctionNote: null }
}

function correctionLine(current: string | null, previous: LiveMonitorState, next: LiveMonitorState): string | null {
  const seen = new Set(previous.timeline.map((entry) => entry.id))
  const correction = next.timeline.find((entry) => !seen.has(entry.id) && entry.kind === 'correction')
  if (!correction) return current
  return `${correction.wellId} appears filled. The original alert remains.`
}
