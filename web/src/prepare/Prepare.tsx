import { useRef, useState } from 'react'
import { commitVersion, readLibrary, writeLibrary } from './library.ts'
import type { ProtocolVersion } from './library.ts'
import { isSupportedSixWell, preparedMonitorProtocol, sixWellDraft, type PreparedMonitorProtocol } from './sixWell.ts'
import { OBSERVATION_METHODS, readExtractedSteps, validateDraft } from './validate.ts'
import type { ObservationMethod, ProtocolStep } from './validate.ts'
import './prepare.css'

const TEXT_FILE_LIMIT = 200_000
const EXTRACT_URL = 'http://127.0.0.1:8787/protocols/extract'
const EXTRACT_TIMEOUT_MS = 70_000
const EXTRACTING_NOTICE = 'Extracting a draft. This can take up to a minute. Nothing is saved yet.'

export function Prepare(props: {
  onSetupMonitoring: (protocol: PreparedMonitorProtocol) => void
  onOpenMonitor: () => void
}) {
  const [library, setLibrary] = useState(() => readLibrary(localStorage))
  const [protocolId, setProtocolId] = useState<string | null>(null)
  const [originVersion, setOriginVersion] = useState<number | null>(null)
  const [originStatus, setOriginStatus] = useState<'draft' | 'approved' | null>(null)
  const [revising, setRevising] = useState(false)
  const [title, setTitle] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [steps, setSteps] = useState<ProtocolStep[]>([])
  const [notice, setNotice] = useState('Nothing is saved yet.')
  const [error, setError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const extractingRef = useRef(false)
  const locked = originStatus === 'approved' && !revising
  const problems = editorProblems(title, sourceText, normalizeSteps(steps))

  function updateSteps(next: ProtocolStep[]) {
    if (locked) return
    setSteps(next)
  }

  async function extract() {
    if (extractingRef.current) return
    extractingRef.current = true
    setExtracting(true)
    setError('')
    setNotice(EXTRACTING_NOTICE)
    try {
      const response = await fetch(EXTRACT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, sourceText }),
        signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      })
      const body: unknown = await response.json().catch(() => null)
      const category = isRecord(body) && typeof body.error === 'string' ? body.error : ''
      const categoryMessage = extractionMessage(category)
      if (categoryMessage) {
        setNotice('Nothing is saved yet.')
        setError(categoryMessage)
        return
      }
      if (!response.ok) {
        const details = isRecord(body) && Array.isArray(body.details)
          ? body.details.filter((item): item is string => typeof item === 'string').join(' ')
          : ''
        setNotice('Nothing is saved yet.')
        setError(`Gemini extraction was rejected. ${details || 'The server did not return a usable draft.'} Add the steps manually. No generated protocol was substituted.`)
        return
      }
      const extracted = readExtractedSteps(sourceText, body)
      if (!extracted || extracted.length === 0) {
        setNotice('Nothing is saved yet.')
        setError('The extraction did not match the supplied text. No draft was applied.')
        return
      }
      setSteps(extracted)
      setNotice(`Extracted ${extracted.length} steps. Check every quote before saving. This draft is not saved yet.`)
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
      setNotice('Nothing is saved yet.')
      setError(
        timedOut
          ? 'Gemini extraction timed out. Add the steps manually. No generated protocol was substituted.'
          : 'The protocol server is not reachable at 127.0.0.1:8787. Start it from server/ with npm start, or add the steps manually. No generated protocol was substituted.',
      )
    } finally {
      extractingRef.current = false
      setExtracting(false)
    }
  }

  function save(status: 'draft' | 'approved') {
    const ready = normalizeSteps(steps)
    const current = editorProblems(title, sourceText, ready)
    if (current.length > 0) {
      setError(current.join(' '))
      return
    }
    const mode = protocolId == null ? 'create' : originStatus === 'draft' && !revising ? 'replace-draft' : 'append'
    const result = commitVersion(
      library,
      {
        id: protocolId,
        title,
        sourceText,
        steps: ready,
        status,
        mode,
        replaceVersion: originVersion ?? undefined,
      },
      new Date().toISOString(),
      crypto.randomUUID(),
    )
    writeLibrary(localStorage, result.library)
    setLibrary(result.library)
    setProtocolId(result.id)
    setOriginVersion(result.version)
    setOriginStatus(status)
    setRevising(false)
    setError('')
    setNotice(
      status === 'approved'
        ? `Approved version ${result.version}. Later edits become a new draft and leave this version unchanged.`
        : `Saved draft version ${result.version} in this browser.`,
    )
  }

  function openVersion(id: string, version: ProtocolVersion) {
    setProtocolId(id)
    setOriginVersion(version.version)
    setOriginStatus(version.status)
    setRevising(false)
    setTitle(version.title)
    setSourceText(version.sourceText)
    setSteps(version.steps.map((step) => ({ ...step, questions: [...step.questions] })))
    setError('')
    setNotice(
      version.status === 'approved'
        ? `Opened approved version ${version.version}. Revise it to create a new draft.`
        : `Opened draft version ${version.version}.`,
    )
  }

  function useSixWell() {
    const draft = sixWellDraft()
    setProtocolId(null)
    setOriginVersion(null)
    setOriginStatus(null)
    setRevising(false)
    setTitle(draft.title)
    setSourceText(draft.sourceText)
    setSteps(draft.steps)
    setError('')
    setNotice('Six-well draft loaded. Not saved. Approve it before monitoring. The camera has not started.')
  }

  function loadTextFile(file: File) {
    const textFile = file.name.toLowerCase().endsWith('.txt') || file.type === 'text/plain' || file.type === ''
    if (!textFile) {
      setError('Only a .txt file is read into the protocol field. PDF text is not extracted.')
      return
    }
    if (file.size > TEXT_FILE_LIMIT) {
      setError('That file is larger than 200 KB. Paste a shorter protocol.')
      return
    }
    void file.text().then((text) => {
      if (text.length > TEXT_FILE_LIMIT) {
        setError('That file is larger than 200 KB. Paste a shorter protocol.')
        return
      }
      setSourceText(text)
      setError('')
      setNotice('Loaded the text file into the protocol field. It is not saved until you save a version.')
    }).catch(() => {
      setError('The text file could not be read. Nothing was added.')
    })
  }

  return (
    <section className="prepare-lab">
      <header className="workspace-hero prepare-hero">
        <div><p className="workspace-eyebrow">01 / Prepare</p>
          <h2>Good science starts<br />with a <span>clear plan.</span></h2>
          <p className="workspace-lede">Define the procedure. Capture the experiment. Keep the evidence that connects them.</p>
        </div>
        <div className="prepare-launch">
          <span className="workspace-eyebrow">Ready for the bench?</span>
          <h3>Your experiment, in focus.</h3>
          <p>Open the three-cup workspace to choose a procedure, use your webcam, or review a recording.</p>
          <button type="button" className="primary-action" onClick={props.onOpenMonitor}>Open Monitor <span aria-hidden="true">↗</span></button>
        </div>
      </header>
      <div className="workspace-section-title"><h3>Build your procedure</h3><p>Draft, review, then approve a version.</p></div>
      <div className="prepare-entries">
        <button type="button" className="prepare-entry" onClick={useSixWell}>
          Load six-well example
        </button>
        <button type="button" className="prepare-entry" onClick={() => document.getElementById('protocol-text')?.focus()}>
          Write a protocol
        </button>
      </div>
      <div className="prepare-layout">
        <div>
          <label>
            Experiment title
            <input value={title} disabled={locked} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Protocol text
            <textarea id="protocol-text" value={sourceText} disabled={locked} rows={8} onChange={(event) => setSourceText(event.target.value)} />
          </label>
          <label>
            Or upload a .txt file
            <input
              type="file"
              accept=".txt,text/plain"
              disabled={locked}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) loadTextFile(file)
                event.target.value = ''
              }}
            />
          </label>
          <div className="prepare-actions">
            <button
              type="button"
              aria-busy={extracting}
              onClick={() => void extract()}
              disabled={locked || extracting || title.trim() === '' || sourceText.trim() === ''}
            >
              {extracting ? 'Extracting…' : 'Extract steps'}
            </button>
            <button type="button" disabled={locked} onClick={() => updateSteps([...steps, blankStep()])}>
              Add step
            </button>
          </div>
          <p role="status">{notice}</p>
          {error ? <p role="alert" className="prepare-warning">{error}</p> : null}
          {steps.map((step, index) => {
            const questionCount = step.questions.map((question) => question.trim()).filter(Boolean).length
            return (
              <article key={index} className="prepare-step">
                <h3>Step {index + 1}</h3>
                <label>
                  Instruction
                  <textarea
                    value={step.instruction}
                    disabled={locked}
                    rows={2}
                    onChange={(event) => updateSteps(replaceStep(steps, index, { ...step, instruction: event.target.value }))}
                  />
                </label>
                <label>
                  Observation
                  <select
                    value={step.observationMethod}
                    disabled={locked}
                    onChange={(event) => updateSteps(replaceStep(steps, index, { ...step, observationMethod: event.target.value as ObservationMethod }))}
                  >
                    {OBSERVATION_METHODS.map((method) => (
                      <option key={method} value={method}>{methodLabel(method)}</option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>
                    {questionCount > 0 ? `Source and ${questionCount} question${questionCount === 1 ? '' : 's'}` : 'Source quote'}
                  </summary>
                  <label>
                    Supporting quote
                    <textarea
                      value={step.quote}
                      disabled={locked}
                      rows={2}
                      onChange={(event) => updateSteps(replaceStep(steps, index, { ...step, quote: event.target.value }))}
                    />
                  </label>
                  <label>
                    Stated duration
                    <input
                      value={step.duration ?? ''}
                      disabled={locked}
                      placeholder="Leave blank when the text does not state one"
                      onChange={(event) => updateSteps(replaceStep(steps, index, { ...step, duration: event.target.value.trim() === '' ? null : event.target.value }))}
                    />
                  </label>
                  <label>
                    Missing information
                    <textarea
                      value={step.questions.join('\n')}
                      disabled={locked}
                      rows={2}
                      placeholder="One question per line"
                      onChange={(event) => updateSteps(replaceStep(steps, index, { ...step, questions: event.target.value.split('\n') }))}
                    />
                  </label>
                </details>
                <button type="button" disabled={locked} onClick={() => updateSteps(steps.filter((_, item) => item !== index))}>
                  Remove step
                </button>
              </article>
            )
          })}
          {problems.length > 0 && steps.length > 0 ? (
            <ul className="prepare-problems">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}
          <div className="prepare-actions">
            {locked ? (
              <button type="button" onClick={() => { setRevising(true); setNotice('Editing creates a new draft. The approved version stays unchanged.') }}>
                Revise
              </button>
            ) : (
              <>
                <button type="button" disabled={problems.length > 0} onClick={() => save('draft')}>Save draft</button>
                <button type="button" className="primary-action" disabled={problems.length > 0} onClick={() => save('approved')}>Approve</button>
              </>
            )}
          </div>
          {locked && protocolId != null && originVersion != null ? (
            isSupportedSixWell(steps) ? (
              <div className="prepare-actions">
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => props.onSetupMonitoring(preparedMonitorProtocol(protocolId, originVersion, title, steps))}
                >
                  Set up monitoring
                </button>
                <p>The camera has not started.</p>
              </div>
            ) : (
              <p>Automatic monitoring is unavailable for this version. The steps are not the supported six-well procedure.</p>
            )
          ) : null}
        </div>
        <aside>
          <p className="workspace-eyebrow">Your workspace</p>
          <h3>Protocol versions</h3>
          <p>Saved in this browser. Each approved version preserves the plan you reviewed.</p>
          {library.protocols.length === 0 ? <p>No protocols saved yet.</p> : null}
          {library.protocols.map((protocol) => (
            <article key={protocol.id}>
              <h4>{protocol.versions.at(-1)?.title || 'Untitled protocol'}</h4>
              <ul>
                {protocol.versions.map((version) => (
                  <li key={version.version}>
                    Version {version.version} · {version.status}
                    <button type="button" onClick={() => openVersion(protocol.id, version)}>Open</button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </aside>
      </div>
    </section>
  )
}

function normalizeSteps(steps: ProtocolStep[]): ProtocolStep[] {
  return steps.map((step) => ({
    ...step,
    questions: step.questions.map((question) => question.trim()).filter(Boolean),
  }))
}

function editorProblems(title: string, sourceText: string, steps: ProtocolStep[]): string[] {
  const errors: string[] = []
  if (title.trim() === '') errors.push('Enter an experiment title.')
  errors.push(...validateDraft(sourceText, { steps }))
  return errors
}

function blankStep(): ProtocolStep {
  return { instruction: '', quote: '', duration: null, observationMethod: 'manual', questions: [] }
}

function replaceStep(steps: ProtocolStep[], index: number, step: ProtocolStep): ProtocolStep[] {
  return steps.map((item, itemIndex) => (itemIndex === index ? step : item))
}

function methodLabel(method: ObservationMethod): string {
  if (method === 'manual') return 'Manual confirmation'
  if (method === 'timer') return 'Timer'
  return 'Supported vision: color dispersion in a frame'
}

function extractionMessage(category: string): string | null {
  if (category === 'missing_credentials') {
    return 'Live Gemini extraction is unavailable. No API key is configured on the local server. Add the steps manually. No generated protocol was substituted.'
  }
  if (category === 'invalid_credentials') {
    return 'Gemini rejected the API key on the local server. Add the steps manually. No generated protocol was substituted.'
  }
  if (category === 'model_unavailable') {
    return 'The Gemini model is unavailable right now. Add the steps manually. No generated protocol was substituted.'
  }
  if (category === 'rate_limited') {
    return 'Gemini rate or quota limit was reached. Add the steps manually. No generated protocol was substituted.'
  }
  if (category === 'timeout') {
    return 'Gemini extraction timed out. Add the steps manually. No generated protocol was substituted.'
  }
  if (category === 'invalid_request') {
    return 'Gemini rejected the extraction request. Add the steps manually. No generated protocol was substituted.'
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
