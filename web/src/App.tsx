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
        <div className="app-brand">
          <svg className="app-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M14 7v10L7 29a4 4 0 0 0 3.5 6h19a4 4 0 0 0 3.5-6l-7-12V7M11 7h18M12 25h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="19" cy="29" r="2" fill="currentColor"/></svg>
          <div><p className="app-kicker">The evidence behind the experiment</p><h1>ReproLab<span aria-hidden="true">.</span></h1></div>
        </div>
        <nav className="app-tabs" aria-label="Primary">
          {TABS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              <span className="app-tab-number" aria-hidden="true">0{index + 1}</span>{item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <div hidden={tab !== 'prepare'}>
          <Prepare
            onOpenMonitor={() => setTab('monitor')}
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
          <Results review={review} active={tab === 'results'} onOpenLibrary={openLibrary} onOpenMonitor={() => setTab('monitor')} />
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
