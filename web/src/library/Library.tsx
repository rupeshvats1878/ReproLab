import { useEffect, useState } from 'react'
import {
  LibraryClientError,
  listExperiments,
  openExperiment,
  openReplication,
  startReplication,
  type ExperimentSummary,
  type PlannedReplication,
  type StoredExperiment,
} from './client.ts'
import './Library.css'

const OPEN_REPLICATION_KEY = 'reprolab-open-replication-id'

export function Library() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([])
  const [opened, setOpened] = useState<StoredExperiment | null>(null)
  const [replication, setReplication] = useState<PlannedReplication | null>(null)
  const [notice, setNotice] = useState('Published experiments are loaded from the local library service.')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listExperiments()
      .then((items) => {
        if (!cancelled) setExperiments(items)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(message(reason))
      })
    const savedId = sessionStorage.getItem(OPEN_REPLICATION_KEY)
    if (savedId) {
      void openReplication(savedId)
        .then((record) => {
          if (cancelled) return
          setReplication(record)
          setNotice('Reopened the planned replication saved in this browser session.')
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(message(reason))
        })
    }
    return () => {
      cancelled = true
    }
  }, [])

  async function openSelected(id: string) {
    setBusy(true)
    setError('')
    try {
      const record = await openExperiment(id)
      setOpened(record)
      setNotice('Opened the published snapshot. It is a copy from the library, not the local draft.')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  async function replicate() {
    if (!opened || busy) return
    setBusy(true)
    setError('')
    try {
      const record = await startReplication(opened.id)
      sessionStorage.setItem(OPEN_REPLICATION_KEY, record.id)
      setReplication(record)
      setNotice('Created a planned replication. This does not mean the experiment was performed.')
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="library-lab">
      <p className="app-kicker">ReproLab • Library</p>
      <h2>Browse published experiments.</h2>
      <p>
        Each card is an approved protocol snapshot stored by the library service. Starting a replication records a plan.
        It does not run the experiment or mark it complete.
      </p>
      <p role="status">{notice}</p>
      {error ? <p role="alert" className="library-warning">{error}</p> : null}
      <div className="library-layout">
        <div>
          <h3>Published</h3>
          {experiments.length === 0 ? <p>No published experiments yet.</p> : null}
          <ul>
            {experiments.map((experiment) => (
              <li key={experiment.id}>
                <button type="button" onClick={() => void openSelected(experiment.id)} disabled={busy}>
                  {experiment.title}
                </button>
                <p>{experiment.authorDisplayName} · {experiment.publishedAt}</p>
                <p>{experiment.description}</p>
              </li>
            ))}
          </ul>
        </div>
        <aside>
          {opened ? (
            <>
              <h3>{opened.title}</h3>
              <p>Experiment id {opened.id}</p>
              <p>{opened.description}</p>
              <SnapshotView snapshot={opened.protocolSnapshot} />
              <button type="button" onClick={() => void replicate()} disabled={busy}>
                Start replication
              </button>
            </>
          ) : <p>Open a published experiment to see its saved protocol.</p>}
          {replication ? (
            <div>
              <h3>Planned replication</h3>
              <p>Replication id {replication.id}</p>
              <p>Parent experiment {replication.experimentId}</p>
              <p>Status {replication.status}</p>
              <p>{replication.note}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  )
}

function SnapshotView(props: { snapshot: StoredExperiment['protocolSnapshot'] }) {
  const steps = Array.isArray(props.snapshot.steps) ? props.snapshot.steps : []
  return (
    <div>
      <p>Saved protocol version {typeof props.snapshot.version === 'number' ? props.snapshot.version : 'unknown'}</p>
      {typeof props.snapshot.sourceText === 'string' ? <p>{props.snapshot.sourceText}</p> : null}
      <ol>
        {steps.map((step, index) => (
          <li key={`${step.quote ?? 'step'}-${index}`}>
            {step.instruction ?? 'Step'} · duration {step.duration == null ? 'none' : step.duration} · {step.observationMethod ?? 'unspecified'}
          </li>
        ))}
      </ol>
    </div>
  )
}

function message(reason: unknown): string {
  return reason instanceof LibraryClientError ? reason.message : 'The experiment library request failed.'
}
