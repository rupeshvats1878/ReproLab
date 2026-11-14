import { useState } from 'react'
import { Monitor } from './components/Monitor.tsx'
import { Review } from './components/Review.tsx'
import { useReviewController } from './review/useReviewController.ts'
import './App.css'

type TabId = 'monitor' | 'review'

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'review', label: 'Review' },
]

export default function App() {
  const review = useReviewController()
  const [tab, setTab] = useState<TabId>('monitor')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">Prototype</p>
          <h1>LabBench</h1>
          <p className="app-subtitle">Colored-water bench observations for a six-well demo.</p>
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
        {tab === 'monitor' ? (
          <Monitor
            protocol={review.protocol}
            onRunStart={review.startRun}
            onElapsedMs={review.updateElapsedMs}
            onObservation={review.recordObservation}
            onMediaAvailable={review.registerMedia}
            onRunComplete={review.completeRun}
          />
        ) : (
          <Review
            protocol={review.protocol}
            onAcknowledgeOmission={review.acknowledgeOmission}
            onResolveOmission={review.resolveOmission}
            onAddHumanEvent={review.addHumanEvent}
            onLoadRun={review.loadRun}
          />
        )}
      </main>
    </div>
  )
}
