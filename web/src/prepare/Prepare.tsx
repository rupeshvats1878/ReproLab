import { useRef, useState } from 'react'
import { LibraryClientError, publishExperiment } from '../library/client.ts'
import { publishRequest } from '../library/publish.ts'
import { commitVersion, readApprovedProtocols, readLibrary, writeLibrary } from './library.ts'
import type { ProtocolVersion } from './library.ts'
import { isSupportedSixWell, preparedMonitorProtocol, sixWellDraft, type PreparedMonitorProtocol } from './sixWell.ts'
import { OBSERVATION_METHODS, readExtractedSteps, validateDraft } from './validate.ts'
import type { ObservationMethod, ProtocolStep } from './validate.ts'
import './prepare.css'

const TEXT_FILE_LIMIT = 200_000
const EXTRACT_URL = 'http://127.0.0.1:8787/protocols/extract'
const EXTRACT_TIMEOUT_MS = 70_000
const EXTRACTING_NOTICE = 'Asking Gemini for a draft. This can take up to a minute.'

export function Prepare(props: {
  onSetupMonitoring: (protocol: PreparedMonitorProtocol) => void
  onOpenLibrary: (experimentId?: string) => void
}) {
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
  const [publishTitle, setPublishTitle] = useState('')
  const [publishDescription, setPublishDescription] = useState('')
  const [authorDisplayName, setAuthorDisplayName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedId, setPublishedId] = useState<string | null>(null)
  const extractingRef = useRef(false)
  const publishingRef = useRef(false)
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
    setPublishedId(null)
    setPublishTitle(version.title)
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
    setPublishedId(null)
    setTitle(draft.title)
    setSourceText(draft.sourceText)
    setSteps(draft.steps)
    setError('')
    setNotice('Six-well procedure loaded. This draft is supported for camera monitoring. Save and approve it before monitoring. Nothing is saved yet, and the camera has not started.')
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

  async function publishApproved() {
    if (publishingRef.current || protocolId == null || originVersion == null) return
    const selected = readApprovedProtocols(localStorage).find((item) => item.id === protocolId && item.version === originVersion)
    if (!selected) {
      setError('Only an approved version can be published. Drafts stay in this browser.')
      return
    }
    const request = publishRequest(selected, {
      title: publishTitle,
      description: publishDescription,
      authorDisplayName,
    })
    if (request.title.length === 0 || request.title.length > 120 || request.description.length === 0 || request.description.length > 500 || request.authorDisplayName.length === 0 || request.authorDisplayName.length > 80) {
      setError('Enter a display title up to 120 characters, a description up to 500, and an author name up to 80.')
      return
    }
    publishingRef.current = true
    setPublishing(true)
    setError('')
    setPublishedId(null)
    try {
      const saved = await publishExperiment(request)
      if (typeof saved.id !== 'string' || saved.id === '') {
        throw new LibraryClientError('The library did not confirm a saved experiment.')
      }
      setPublishedId(saved.id)
      setNotice(`Published approved version ${selected.version}. Library id ${saved.id}. The local protocol was not changed.`)
    } catch (reason) {
      setPublishedId(null)
      setError(reason instanceof LibraryClientError ? reason.message : 'Publishing failed. Nothing was saved.')
    } finally {
      publishingRef.current = false
      setPublishing(false)
    }
  }

  return (
    <section className="prepare-lab">
      <p className="app-kicker">ReproLab • Prepare</p>
      <h2>Prepare a protocol.</h2>
      <p>Start with the procedure the camera can monitor, or write a different protocol.</p>
      <div className="prepare-entries">
        <button type="button" className="prepare-entry" onClick={useSixWell}>
          <strong>Use six-well procedure</strong>
          <span>Supported for camera monitoring. Loads Fill A1 through Fill B3 as an editable draft.</span>
        </button>
        <button type="button" className="prepare-entry" onClick={() => document.getElementById('protocol-text')?.focus()}>
          <strong>Write or upload a protocol</strong>
          <span>Paste text or choose a .txt file. This does not configure the camera detector.</span>
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
              {extracting ? 'Asking Gemini…' : 'Extract steps with Gemini'}
            </button>
            <button type="button" disabled={locked} onClick={() => updateSteps([...steps, blankStep()])}>
              Add a step manually
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
              <button type="button" onClick={() => { setRevising(true); setPublishedId(null); setNotice('Editing creates a new draft. The approved version stays unchanged.') }}>
                Revise as a new draft
              </button>
            ) : (
              <>
                <button type="button" disabled={problems.length > 0} onClick={() => save('draft')}>Save draft</button>
                <button type="button" disabled={problems.length > 0} onClick={() => save('approved')}>Approve protocol</button>
              </>
            )}
          </div>
          {locked && protocolId != null && originVersion != null ? (
            isSupportedSixWell(steps) ? (
              <div className="prepare-actions">
                <button
                  type="button"
                  onClick={() => props.onSetupMonitoring(preparedMonitorProtocol(protocolId, originVersion, title, steps))}
                >
                  Set up monitoring
                </button>
                <p>Opens Monitor with this approved version. It does not start the camera or a run.</p>
              </div>
            ) : (
              <p>Automatic monitoring is unavailable for this version. The steps are not the supported six-well procedure.</p>
            )
          ) : null}
          <details className="prepare-extra">
            <summary>Publishing and library</summary>
            <p>Versions in the side list are local drafts in this browser. Publishing copies an approved version into the shared experiment library. That library is not a public website and does not sign anyone in.</p>
            <button type="button" onClick={() => props.onOpenLibrary()}>Open Library</button>
            {locked ? (
              <form onSubmit={(event) => { event.preventDefault(); void publishApproved() }}>
                <h3>Publish this approved version</h3>
                <p>Publishing sends this approved version only. A draft is not published, and later local edits do not change the saved snapshot.</p>
                <label>
                  Display title
                  <input value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} maxLength={120} />
                </label>
                <label>
                  Description
                  <textarea value={publishDescription} rows={3} maxLength={500} onChange={(event) => setPublishDescription(event.target.value)} />
                </label>
                <label>
                  Author name
                  <input value={authorDisplayName} onChange={(event) => setAuthorDisplayName(event.target.value)} maxLength={80} />
                </label>
                <button type="submit" disabled={publishing}>
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
                {publishedId ? (
                  <div role="status">
                    <p>The shared experiment library saved this publication as {publishedId}.</p>
                    <button type="button" onClick={() => props.onOpenLibrary(publishedId)}>View in Library</button>
                  </div>
                ) : null}
              </form>
            ) : (
              <p>Approve a version before publishing. A published protocol does not configure the six-well detector.</p>
            )}
          </details>
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
