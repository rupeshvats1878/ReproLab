import { useState } from 'react'
import { Monitor } from './components/Monitor.tsx'
import { useReviewController } from './review/useReviewController.ts'
import './App.css'
import { Prepare } from './prepare/Prepare.tsx'
import type { PreparedMonitorProtocol } from './prepare/sixWell.ts'
import { Results } from './results/Results.tsx'

type TabId = 'prepare' | 'monitor' | 'results'

const TABS: readonly { id: TabId; label: string; line: string }[] = [
  { id: 'prepare', label: 'Prepare', line: 'Write a protocol, approve a version, and publish it when you choose.' },
  { id: 'monitor', label: 'Monitor', line: 'Watch the six-well colored-water procedure with the camera.' },
  { id: 'results', label: 'Results', line: 'Inspect a saved monitor session, a review record, or an optional reference comparison.' },
]

export default function App() {
  const review = useReviewController()
  const [tab, setTab] = useState<TabId>('prepare')
  const [preparedProtocol, setPreparedProtocol] = useState<PreparedMonitorProtocol | null>(null)

  return (
    <div className={tab === 'monitor' ? 'app-shell app-shell-monitor' : 'app-shell'}>
      <header className="app-header">
        <div>
          <p className="app-kicker">Prototype</p>
          <h1>ReproLab</h1>
          <p className="app-subtitle">Prepare a protocol, notice visible deviations, and keep the evidence others can inspect.</p>
        </div>
        <nav className="app-tabs" aria-label="Primary">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <p className="app-screen-line">{TABS.find((item) => item.id === tab)?.line}</p>
        <div hidden={tab !== 'prepare'}>
          <Prepare onSetupMonitoring={(protocol) => {
            setPreparedProtocol(protocol)
            setTab('monitor')
          }} />
        </div>
        <div hidden={tab !== 'monitor'}>
          <Monitor
            protocol={review.protocol}
            onRunStart={review.startRun}
            onElapsedMs={review.updateElapsedMs}
            onObservation={review.recordObservation}
            onMediaAvailable={review.registerMedia}
            onRunComplete={review.completeRun}
            preparedProtocol={preparedProtocol}
          />
        </div>
        <div hidden={tab !== 'results'}>
          <Results review={review} active={tab === 'results'} />
        </div>
      </main>
    </div>
  )
}
