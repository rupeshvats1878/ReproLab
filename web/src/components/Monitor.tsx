import { WELL_GRID } from '../shared/types.ts'
import type { MonitorProps, WellState } from '../shared/types.ts'
import './Monitor.css'

const STATE_LABEL: Record<WellState, string> = {
  empty: 'Empty',
  filled: 'Filled',
  unknown: 'Unknown',
}

/**
 * Vision-owned placeholder.
 * When implementing the camera, call:
 * onRunStart, onElapsedMs, onObservation, onMediaAvailable, onRunComplete.
 * Read alerts from props.protocol; do not compute omission rules here.
 */
export function Monitor(props: MonitorProps) {
  const { protocol } = props
  const openAlerts = protocol.alerts.filter((alert) => alert.status !== 'resolved')

  return (
    <section className="monitor" aria-labelledby="monitor-title">
      <div className="monitor-heading">
        <h2 id="monitor-title">Monitor</h2>
        <p>Vision placeholder. The camera and well readings are not connected yet.</p>
      </div>

      <dl className="monitor-status">
        <div>
          <dt>Phase</dt>
          <dd>{protocol.phase}</dd>
        </div>
        <div>
          <dt>Expected well</dt>
          <dd>{protocol.expectedWellId ?? 'None'}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{protocol.elapsedMs} ms</dd>
        </div>
      </dl>

      <div className="well-grid" role="group" aria-label="2 by 3 bench">
        {WELL_GRID.flat().map((wellId) => {
          const state = protocol.wellStates[wellId]
          return (
            <article key={wellId} className="well" data-state={state}>
              <span className="well-id">{wellId}</span>
              <span className="well-state">{STATE_LABEL[state]}</span>
            </article>
          )
        })}
      </div>

      <div className="monitor-alerts">
        <h3>Possible omissions</h3>
        {openAlerts.length === 0 ? (
          <p>No open alerts in the current protocol state.</p>
        ) : (
          <ul>
            {openAlerts.map((alert) => (
              <li key={alert.id}>
                {alert.wellId} is {alert.status} at {alert.raisedAtElapsedMs} ms
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
