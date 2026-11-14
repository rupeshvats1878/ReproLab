import { useState } from 'react'
import { Monitor } from './components/Monitor.tsx'
import { Review } from './components/Review.tsx'
import { useReviewController } from './review/useReviewController.ts'
import './App.css'
import { Library } from './library/Library.tsx'
import { Prepare } from './prepare/Prepare.tsx'
import { ReferenceLab } from './reference/ReferenceLab.tsx'

type TabId = 'prepare' | 'monitor' | 'review' | 'reference' | 'library'

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'review', label: 'Review' },
  { id: 'reference', label: 'Reference lab' },
  { id: 'library', label: 'Library' },
]

export default function App() {
  const review = useReviewController()
  const [tab, setTab] = useState<TabId>('monitor')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">Prototype</p>
          <h1>ReproLab</h1>
          <p className="app-subtitle">Prepare, observe, and compare experiments with traceable evidence.</p>
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
        <div hidden={tab !== 'monitor'}>
          <Monitor
            protocol={review.protocol}
            onRunStart={review.startRun}
            onElapsedMs={review.updateElapsedMs}
            onObservation={review.recordObservation}
            onMediaAvailable={review.registerMedia}
            onRunComplete={review.completeRun}
          />
        </div>
        <div hidden={tab !== 'review'}>
          <Review
            protocol={review.protocol}
            onAcknowledgeOmission={review.acknowledgeOmission}
            onResolveOmission={review.resolveOmission}
            onAddHumanEvent={review.addHumanEvent}
            onLoadRun={review.loadRun}
          />
        </div>
        <div hidden={tab !== 'reference'}><ReferenceLab /></div>
        <div hidden={tab !== 'prepare'}><Prepare /></div>
        <div hidden={tab !== 'library'}><Library /></div>
      </main>
    </div>
  )
}
