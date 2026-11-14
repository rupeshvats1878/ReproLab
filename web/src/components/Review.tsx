import { SYNTHETIC_DEMO_RUNS } from '../shared/exampleRun.ts'
import type { ReviewProps } from '../shared/types.ts'
import './Review.css'

/**
 * Review-owned placeholder.
 * When implementing corrections, call:
 * onAcknowledgeOmission, onResolveOmission, onAddHumanEvent, onLoadRun.
 * Own protocol processing in useReviewController, not in this file's local state.
 */
export function Review(props: ReviewProps) {
  const { protocol } = props

  return (
    <section className="review" aria-labelledby="review-title">
      <div className="review-heading">
        <h2 id="review-title">Review</h2>
        <p>
          Review placeholder. Protocol processing, corrections, and persistence are not
          implemented yet.
        </p>
      </div>

      <p className="review-live">
        Controller phase: <strong>{protocol.phase}</strong>
        {protocol.metadata ? ` — ${protocol.metadata.title}` : ' — no run loaded'}
      </p>

      <div className="fixture-banner">
        <p>Synthetic sample records. These are not live results and contain no video files.</p>
      </div>

      <ul className="fixture-list">
        {SYNTHETIC_DEMO_RUNS.map((run) => {
          const openAlerts = run.alerts.filter((alert) => alert.status !== 'resolved')
          return (
            <li key={run.metadata.id}>
              <h3>{run.metadata.title}</h3>
              <p>{run.metadata.notes}</p>
              <p className="fixture-meta">
                {run.metadata.source} fixture · {run.observations.length} observations ·{' '}
                {run.humanEvents.length} human events · {openAlerts.length} unresolved alerts
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
