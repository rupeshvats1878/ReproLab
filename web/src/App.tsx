import { useCallback, useState } from 'react'
import { Monitor } from './components/Monitor.tsx'
import { useReviewController } from './review/useReviewController.ts'
import './App.css'
import { Library } from './library/Library.tsx'
import { Prepare } from './prepare/Prepare.tsx'
import type { PreparedMonitorProtocol } from './prepare/sixWell.ts'
import { Results } from './results/Results.tsx'

type TabId = 'prepare' | 'monitor' | 'results' | 'library'

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'results', label: 'Results' },
  { id: 'library', label: 'Library' },
]

export default function App() {
  const review = useReviewController()
  const [tab, setTab] = useState<TabId>('prepare')
  const [preparedProtocol, setPreparedProtocol] = useState<PreparedMonitorProtocol | null>(null)
  const [libraryFocusId, setLibraryFocusId] = useState<string | null>(null)
  const openLibrary = useCallback((experimentId?: string) => {
    setLibraryFocusId(experimentId ?? null)
    setTab('library')
  }, [])
  const clearLibraryFocus = useCallback(() => setLibraryFocusId(null), [])

  return (
    <div className={tab === 'monitor' ? 'app-shell app-shell-monitor' : 'app-shell'}>
      <header className="app-header">
        <div>
          <p className="app-kicker">Prototype</p>
          <h1>ReproLab</h1>
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
        <div hidden={tab !== 'prepare'}>
          <Prepare
            onSetupMonitoring={(protocol) => {
              setPreparedProtocol(protocol)
              setTab('monitor')
            }}
          />
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
          <Results review={review} active={tab === 'results'} onOpenLibrary={openLibrary} />
        </div>
        <div hidden={tab !== 'library'}>
          <Library
            focusId={libraryFocusId}
            onFocusHandled={clearLibraryFocus}
            onOpenResults={() => setTab('results')}
            onSetupMonitoring={(protocol) => {
              setPreparedProtocol(protocol)
              setTab('monitor')
            }}
          />
        </div>
      </main>
    </div>
  )
}
