import { useRef, useState } from 'react'
import { commitVersion, readLibrary, writeLibrary } from './library.ts'
import type { ProtocolVersion } from './library.ts'
import { OBSERVATION_METHODS, readExtractedSteps, validateDraft } from './validate.ts'
import type { ObservationMethod, ProtocolStep } from './validate.ts'
import './prepare.css'

const EXTRACT_URL = 'http://127.0.0.1:8787/protocols/extract'
const EXTRACT_TIMEOUT_MS = 70_000
const EXTRACTING_NOTICE = 'Asking Gemini for a draft. This can take up to a minute.'

export function Prepare() {
  const [library, setLibrary] = useState(() => readLibrary(localStorage))
  const [protocolId, setProtocolId] = useState<string | null>(null)
  const [originVersion, setOriginVersion] = useState<number | null>(null)
  const [originStatus, setOriginStatus] = useState<'draft' | 'approved' | null>(null)
  const [revising, setRevising] = useState(false)
  const [title, setTitle] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [steps, setSteps] = useState<ProtocolStep[]>([])
  const [notice, setNotice] = useState('Paste a protocol, extract a draft, or write the steps yourself.')
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
        setNotice('Paste a protocol, extract a draft, or write the steps yourself.')
        setError(categoryMessage)
        return
      }
      if (!response.ok) {
        const details = isRecord(body) && Array.isArray(body.details)
          ? body.details.filter((item): item is string => typeof item === 'string').join(' ')
          : ''
        setNotice('Paste a protocol, extract a draft, or write the steps yourself.')
        setError(`Gemini extraction was rejected. ${details || 'The server did not return a usable draft.'} Add the steps manually. No generated protocol was substituted.`)
        return
      }
      const extracted = readExtractedSteps(sourceText, body)
      if (!extracted || extracted.length === 0) {
        setNotice('Paste a protocol, extract a draft, or write the steps yourself.')
        setError('The extraction did not match the supplied text. No draft was applied.')
        return
      }
      setSteps(extracted)
      setNotice(`Extracted ${extracted.length} steps. Check every quote before saving. This draft is not saved yet.`)
    } catch (error) {
      const timedOut = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
      setNotice('Paste a protocol, extract a draft, or write the steps yourself.')
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

  return (
    <section className="prepare-lab">
      <p className="app-kicker">ReproLab • Prepare</p>
      <h2>Turn a written protocol into an approved draft.</h2>
      <p>
        The reference lab measures spatial color dispersion in a selected frame. It does not establish chemical success
        or a validated mixing endpoint. Only a step that asks someone to look at color, dye, or dispersion in a frame
        can use supported vision. This page does not connect a protocol to a Monitor or Review run.
      </p>
      <div className="prepare-layout">
        <div>
          <label>
            Experiment title
            <input value={title} disabled={locked} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Protocol text
            <textarea value={sourceText} disabled={locked} rows={8} onChange={(event) => setSourceText(event.target.value)} />
          </label>
          <div className="prepare-actions">
            <button
              type="button"
              aria-busy={extracting}
              onClick={() => void extract()}
              disabled={locked || extracting || title.trim() === '' || sourceText.trim() === ''}
            >
              {extracting ? 'Asking Gemini…' : 'Extract steps with Gemini'}
            </button>
            <button type="button" disabled={locked} onClick={() => updateSteps([...steps, blankStep()])}>
              Add a step manually
            </button>
          </div>
          <p role="status">{notice}</p>
          {error ? <p role="alert" className="prepare-warning">{error}</p> : null}
          {steps.map((step, index) => (
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
              <button type="button" disabled={locked} onClick={() => updateSteps(steps.filter((_, item) => item !== index))}>
                Remove step
              </button>
            </article>
          ))}
          {problems.length > 0 && steps.length > 0 ? (
            <ul className="prepare-problems">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}
          <div className="prepare-actions">
            {locked ? (
              <button type="button" onClick={() => { setRevising(true); setNotice('Editing creates a new draft. The approved version stays unchanged.') }}>
                Revise as a new draft
              </button>
            ) : (
              <>
                <button type="button" disabled={problems.length > 0} onClick={() => save('draft')}>Save draft</button>
                <button type="button" disabled={problems.length > 0} onClick={() => save('approved')}>Approve protocol</button>
              </>
            )}
          </div>
        </div>
        <aside>
          <h3>Saved in this browser</h3>
          <p>Versions stay in local storage. Approving one version does not change an older approval.</p>
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
