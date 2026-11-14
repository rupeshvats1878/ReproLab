import { useEffect, useRef, useState } from 'react'
import { capturePausedFrame } from './captureFrame.ts'
import { REFERENCE_CLIPS, REFERENCE_SOURCE } from './clips.ts'
import { methodVersionLabel, readEvidenceList, type Evidence } from './evidence.ts'
import { DEFAULT_REGION, validRegion, type Region } from './measure.ts'
import './reference.css'

const SOURCE = REFERENCE_SOURCE
const CLIPS = REFERENCE_CLIPS
const KEY = 'reprolab-reference-evidence-v1'
function readSaved(): Evidence[] {
  try {
    return readEvidenceList(JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown)
  } catch { return [] }
}
export function ReferenceLab() {
  const [clipId, setClipId] = useState('nonrotating')
  const [local, setLocal] = useState<{ id: string; src: string; name: string } | null>(null)
  const [region, setRegion] = useState<Region>(DEFAULT_REGION)
  const [evidence, setEvidence] = useState<Evidence[]>(readSaved)
  const [notice, setNotice] = useState('Pause at a useful frame, confirm the crop, then capture evidence.')
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const clip = CLIPS.find(c => c.id === clipId)
  const src = clip?.src ?? local?.src ?? ''
  const title = clip?.name ?? local?.name ?? 'Imported recording'
  useEffect(() => () => { if (local) URL.revokeObjectURL(local.src) }, [local])
  function saveEvidence(next: Evidence[]) {
    setEvidence(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) }
    catch { setError('Browser storage is full. Export evidence before closing this page; new captures may not survive reload.') }
  }
  function capture() {
    const player = video.current
    if (!player || player.readyState < 2 || player.seeking || !player.paused || !validRegion(region)) {
      setError('Pause the video, wait for seeking to finish, and choose a crop inside the image.'); return
    }
    try {
      const frozen = capturePausedFrame(player, region)
      setError('')
      saveEvidence([...evidence, { id: crypto.randomUUID(), clipId, title,
        source: clip ? SOURCE : 'Local import; provenance not independently verified', time: frozen.videoTimeSec,
        region: frozen.crop, result: frozen.localResult, image: frozen.imageDataUrl, capturedAt: new Date().toISOString() }].slice(-24))
      setNotice(`Captured ${title} at ${frozen.videoTimeSec.toFixed(2)} seconds. Last 24 captures are saved in this browser.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to read the frame. Import a local video file or use the bundled reference clips.') }
  }
  function exportEvidence() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, kind: 'reference-observations',
      caveat: 'Descriptive image measurements, not independent replications or proof of chemical failure.', evidence }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'reprolab-reference-evidence.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const latest = CLIPS.map(c => [...evidence].reverse().find(e => e.clipId === c.id && e.result.quality === 'accepted'))
  return <section className="reference-lab">
    <p className="app-kicker">ReproLab • Reference footage</p>
    <h2>Inspect the experiment. Keep the evidence.</h2>
    <p>MIT dye-dispersion experiments: rotating versus non-rotating water. These are external references, not successful and failed replications.</p>
    <p><a href={SOURCE} target="_blank" rel="noreferrer">Original footage and experiment context ↗</a></p>
    <div className="reference-tools">
      <label>Recording <select value={clipId} onChange={e => { setClipId(e.target.value); setError('') }}>
        {CLIPS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        {local && <option value={local.id}>{local.name}</option>}
      </select></label>
      <label>Or import your own video <input type="file" accept="video/*" onChange={e => {
        const file = e.target.files?.[0]; if (!file) return
        if (file.type && !file.type.startsWith('video/')) { setError('Choose a video file.'); return }
        const id = `local-${crypto.randomUUID()}`
        setLocal({ id, src: URL.createObjectURL(file), name: file.name }); setClipId(id); setError('')
        e.target.value = ''
      }} /></label>
    </div>
    <div className="reference-layout">
      <div>
        <div className="reference-player">
          <video key={src} ref={video} src={src} controls preload="metadata" onError={() => setError('Video unavailable or unsupported. Install the reference media pack, or import a supported local MP4.')} />
        </div>
        <p>Clips contain zooms. Crop coordinates apply to the decoded image; re-check the crop after every zoom or cut. The captured image below confirms what was measured.</p>
        <div className="reference-crop">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key} (%)
          <input type="number" min={key === 'width' || key === 'height' ? 5 : 0} max={100} value={region[key]}
            onChange={e => setRegion(r => ({ ...r, [key]: Number(e.target.value) }))} />
        </label>)}</div>
        <button onClick={capture} disabled={!validRegion(region)}>Capture paused frame + measure crop</button>
        <p role="status">{notice}</p>{error && <p role="alert" className="reference-warning">{error}</p>}
      </div>
      <aside>
        <h3>What this measures</h3>
        <p>Spatial color dispersion across a 6 × 6 grid. Higher values mean more variation in RGB color ratios inside this crop.</p>
        <p><strong>No pass/fail threshold is assigned.</strong> Clear water can also have a low score. This does not prove molecular mixing, concentration, or protocol failure.</p>
        <p>Dark and heavily clipped crops are rejected. Hands, blur, exposure changes, and camera motion still need manual review.</p>
        <h3>Reference comparison</h3>
        {CLIPS.map((c, i) => <p key={c.id}>{c.name}: <strong>{latest[i]?.result.dispersion?.toFixed(4) ?? 'Capture a frame'}</strong>
          {latest[i] && <> at {latest[i]!.time.toFixed(2)}s</>}</p>)}
        <p>Descriptive comparison only: crop, timing, dye distribution, and camera geometry differ. No causal diagnosis is made.</p>
      </aside>
    </div>
    <div className="reference-tools"><h3>Evidence ({evidence.length}/24)</h3><button onClick={exportEvidence} disabled={!evidence.length}>Export evidence JSON</button></div>
    <div className="reference-evidence">{[...evidence].reverse().map(item => <article key={item.id}>
      <img src={item.image} alt={`Measured crop from ${item.title} at ${item.time.toFixed(2)} seconds`} />
      <h4>{item.title}</h4><p>{item.time.toFixed(2)}s · {item.result.quality}</p>
      <p>Method: {methodVersionLabel(item.result)}</p>
      <p>Dispersion: <strong>{item.result.dispersion?.toFixed(4) ?? 'Not assessed'}</strong></p>
      <p>{item.result.reason}</p>
      <button disabled={!CLIPS.some(c => c.id === item.clipId) && item.clipId !== local?.id} onClick={() => {
        if (clipId === item.clipId && video.current) { video.current.pause(); video.current.currentTime = item.time }
        else { setClipId(item.clipId); setNotice(`Select ${item.time.toFixed(2)} seconds in the recording to review this capture.`) }
        setRegion(item.region)
      }}>Review timestamp / crop</button>
      <button onClick={() => saveEvidence(evidence.filter(e => e.id !== item.id))}>Remove capture</button>
    </article>)}</div>
  </section>
}
