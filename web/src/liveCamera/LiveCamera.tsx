import { useEffect, useRef, useState } from 'react'
import { CAPTURE_PROTOCOLS, captureProtocol, type CaptureProtocolId } from '../capture/threeCup.ts'
import { acceptWindow, liveFindings, newLiveState, shouldAnalyze, type LiveState, type WindowResult } from './model.ts'
import { reviewModelObservation } from '../capture/geminiObservation.ts'
import { recordClip } from './capture.ts'
import './liveCamera.css'
type Clip={blob:Blob;startMs:number;durationMs:number;sent:boolean}
type Run={id:string;token:string;stream:MediaStream;start:number;enabled:boolean;max:number;used:number;next:number;active:boolean;busy:boolean;automatic:boolean;cancelClip:(()=>void)|null;windowMs:number}
async function jsonRequest(path:string,token:string,body?:unknown) {
  const response=await fetch(`/live-camera${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Live-Token':token},body:JSON.stringify(body??{})})
  const result=await response.json(); if(!response.ok) throw Error(result.error||'Local bridge unavailable.'); return result
}
export function LiveCamera({beforeStart}:{beforeStart:()=>void}) {
  const [protocol,setProtocol]=useState<CaptureProtocolId>('blue-red-then-green-blue')
  const [enabled,setEnabled]=useState(false),[maximum,setMaximum]=useState(12),[windowMs,setWindowMs]=useState(2000)
  const [automatic,setAutomatic]=useState(false),[running,setRunning]=useState(false),[starting,setStarting]=useState(false)
  const [capture,setCapture]=useState('Camera off'),[request,setRequest]=useState('OFFLINE — no external inference')
  const [error,setError]=useState(''),[clock,setClock]=useState(0),[busy,setBusy]=useState(false),[used,setUsed]=useState(0),[skipped,setSkipped]=useState(0)
  const [state,setState]=useState<LiveState|null>(null),[hasClip,setHasClip]=useState(false)
  const run=useRef<Run|null>(null),recent=useRef<Clip|null>(null),video=useRef<HTMLVideoElement>(null),generation=useRef(0)
  function stop() {
    generation.current++
    const r=run.current
    if(r) {
      r.active=false; r.cancelClip?.()
      r.stream.getTracks().forEach(t=>t.stop())
      void jsonRequest(`/sessions/${r.id}/stop`,r.token).catch(()=>{})
    }
    run.current=null; recent.current=null
    if(video.current) video.current.srcObject=null
    setRunning(false);setStarting(false);setBusy(false);setHasClip(false);setCapture('Stopped');setRequest('Stopped — no new requests. An already sent request may still be billed.')
    setState(s=>s?{...s,stopped:true}:s)
  }
  useEffect(()=>()=>{generation.current++; const r=run.current;if(r){r.active=false;r.cancelClip?.();r.stream.getTracks().forEach(t=>t.stop());void jsonRequest(`/sessions/${r.id}/stop`,r.token).catch(()=>{})}},[])
  useEffect(()=>{if(!running)return;const timer=window.setInterval(()=>{const r=run.current;if(r)setClock(Math.round(performance.now()-r.start))},250);return()=>clearInterval(timer)},[running])
  async function analyze(r:Run,clip:Clip) {
    if(!r.active || r.busy || clip.sent || !r.enabled || r.used>=r.max) return
    clip.sent=true;r.busy=true;setBusy(true);setHasClip(false);setError('');setRequest('Sending new camera clip to Gemini…')
    const index=r.next++
    const delayed=window.setTimeout(()=>{if(r.active)setRequest('Analysis delayed — camera continues; busy windows are skipped.')},3000)
    try {
      const response=await fetch(`/live-camera/sessions/${r.id}/clips`,{method:'POST',headers:{'Content-Type':clip.blob.type,'X-Live-Token':r.token,'X-Live-Window':JSON.stringify({index,startMs:clip.startMs,durationMs:clip.durationMs})},body:clip.blob,signal:AbortSignal.timeout(50_000)})
      const result=await response.json()
      if(!r.active || run.current!==r)return
      if(Number.isInteger(result.callsUsed)){r.used=result.callsUsed;setUsed(r.used)}
      if(!response.ok) throw Error(result.error||'Analysis failed. No retry was made.')
      if(result.discarded)return
      r.used=result.callsUsed;setUsed(r.used)
      setState(s=>{if(!s)return s; try{return acceptWindow(s,result as WindowResult)}catch(e){return {...s,message:(e as Error).message,windows:[...s.windows,result]}}})
      const checked=reviewModelObservation(result.observation,{sessionId:r.id,videoId:result.windowId,clipStartMs:result.sourceOffsetMs,clipEndMs:result.sourceOffsetMs+result.durationMs})
      if(!checked.accepted) throw Error(`Gemini observation requires review: ${checked.reason}. No retry was made.`)
      setRequest(`Result received · ${(result.processingMs/1000).toFixed(2)} s processing`)
      if(r.used>=r.max) {stop();setRequest('Call limit reached. Session stopped. Review the model observations below.')}
    } catch(e) {if(r.active){stop();setError((e as Error).message)}}
    finally {clearTimeout(delayed);r.busy=false;if(run.current===r){setBusy(false);setHasClip(Boolean(recent.current&&!recent.current.sent))}}
  }
  function captureWindow(r:Run) {
    if(!r.active)return
    try {
      const task=recordClip(r.stream,r.start,r.windowMs,clip=>{
        if(!r.active)return
        recent.current=clip;setHasClip(true)
        if(shouldAnalyze(r.active,r.enabled,r.automatic,r.busy,r.used,r.max))void analyze(r,clip)
        else if(r.automatic&&r.busy)setSkipped(n=>n+1)
        if(r.active)captureWindow(r)
      },()=>{if(r.active){stop();setError('Camera encoding failed or the window was delayed. Restart the session.')}})
      r.cancelClip=task.cancel
      setCapture(`Capturing finalized ${(r.windowMs/1000).toFixed(0)} s windows`)
    } catch(e) {stop();setError((e as Error).message)}
  }

  async function start() {
    if(starting||running)return
    setStarting(true);setError('');const gen=++generation.current
    let stream:MediaStream|null=null,sessionId='',token=''
    try {
      const response=await fetch('/live-camera/config'); if(!response.ok)throw Error('Start the live-demo launcher first.')
      const config=await response.json();token=config.token
      if(enabled&&!config.credentialsConfigured)throw Error('The local bridge needs GEMINI_API_KEY. See the startup instructions.')
      if(enabled&&config.remainingCalls<1)throw Error('The persistent server call ceiling has been reached.')
      const limit=enabled?Math.min(maximum,config.remainingCalls):maximum
      beforeStart()
      setCapture('Waiting for camera permission — click Allow in your browser')
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640,max:1280},height:{ideal:360,max:720},frameRate:{ideal:15,max:30}}})
      if(gen!==generation.current){stream.getTracks().forEach(t=>t.stop());return}
      const session=await jsonRequest('/sessions',token,{maxCalls:limit,protocolId:protocol,enabled});sessionId=session.id
      if(gen!==generation.current){stream.getTracks().forEach(t=>t.stop());void jsonRequest(`/sessions/${sessionId}/stop`,token);return}
      const r:Run={id:sessionId,token,stream,start:performance.now(),enabled,max:limit,used:0,next:0,active:true,busy:false,automatic,cancelClip:null,windowMs}
      run.current=r;recent.current=null;setMaximum(limit);setState(newLiveState(r.id,protocol));setUsed(0);setSkipped(0);setClock(0);setRunning(true)
      if(video.current){video.current.srcObject=stream;await video.current.play()}
      stream.getVideoTracks()[0].onended=()=>{if(r.active){stop();setError('Camera disconnected.')}}
      setRequest(enabled?'Ready for authorized Gemini analysis':'OFFLINE — preview only; no external inference')
      captureWindow(r)
    } catch(e) {stream?.getTracks().forEach(t=>t.stop());if(sessionId)void jsonRequest(`/sessions/${sessionId}/stop`,token);if(gen===generation.current){stop();setError((e as Error).message)}}
    finally {if(gen===generation.current)setStarting(false)}
  }
  const last=state?.windows.at(-1), findings=state?liveFindings(state):[]
  const waiting=state?.events.filter(e=>!state.reviews[e.id]).length??0
  return <section className="live-ai" aria-label="Live Gemini camera monitoring">
    <header><div><span className="live-ai-kicker">NEW CAMERA FOOTAGE · {running&&enabled?'REAL GEMINI':'PROVIDER OFF'}</span><h2>Live AI Monitoring</h2><p>Physical cup labels. Genuine model observations. Human decisions.</p></div><span className="live-ai-clock">{(clock/1000).toFixed(1)}<small>session seconds</small></span></header>
    <div className="live-ai-settings">
      <label>Approved procedure<select value={protocol} disabled={running||starting} onChange={e=>setProtocol(e.target.value as CaptureProtocolId)}>{CAPTURE_PROTOCOLS.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <label>Clip window<select value={windowMs} disabled={running||starting} onChange={e=>setWindowMs(Number(e.target.value))}><option value={2000}>2 seconds · fastest updates</option><option value={6000}>6 seconds · more pour context</option><option value={12000}>12 seconds · full transfer context</option></select></label>
      <label>Maximum calls<input type="number" min={1} max={15} value={maximum} disabled={running||starting} onChange={e=>setMaximum(Math.min(15,Math.max(1,Number(e.target.value)||1)))}/></label>
    </div>
    <div className="live-ai-consent"><label><input type="checkbox" checked={enabled} disabled={running||starting} onChange={e=>setEnabled(e.target.checked)}/> Enable Real Gemini Analysis</label><p>When enabled, new camera clips are sent to Google Gemini and may incur charges. No microphone. Maximum 15 calls across server restarts; no retries. Model: gemini-4-hydrogen.</p></div>
    <div className="live-ai-actions"><button type="button" className="primary-action" disabled={running||starting} onClick={()=>void start()}>{starting?'Opening camera…':'Start Live AI Monitoring'}</button><button type="button" disabled={!running&&!starting} onClick={stop}>Stop Live AI Monitoring</button><button type="button" disabled={!running||!enabled||busy||!hasClip} onClick={()=>{const r=run.current,c=recent.current;if(r&&c)void analyze(r,c)}}>Analyze recent clip</button><label><input type="checkbox" checked={automatic} onChange={e=>{setAutomatic(e.target.checked);if(run.current)run.current.automatic=e.target.checked}}/> Automatic analysis</label></div>
    {error?<p className="live-ai-error" role="alert">{error}</p>:null}
    <div className="live-ai-grid"><div><video ref={video} autoPlay muted playsInline aria-label="Live camera preview"/><div className="live-ai-cups"><span>RED</span><span>GREEN</span><span>BLUE</span></div><p>{capture} · {skipped} busy windows skipped</p><p>Short windows can split a pour. Analysis gaps and uncertain labels require review. Under-three-second feedback is a target, not a guarantee.</p></div><div className="live-ai-summary"><strong aria-live="polite">{request}</strong><dl><dt>Approved for this run</dt><dd>{captureProtocol(state?.protocolId??protocol).title}</dd><dt>Calls reserved</dt><dd>{used} / {maximum}</dd><dt>Observed events / awaiting review</dt><dd>{state?.events.length??0} / {waiting}</dd><dt>Model observation status</dt><dd>{last?(last.observation as {observationStatus?:string}).observationStatus??'unavailable':'None'}</dd><dt>Last analyzed window</dt><dd>{last?`${(last.sourceOffsetMs/1000).toFixed(2)}–${((last.sourceOffsetMs+last.durationMs)/1000).toFixed(2)} s`:'None'}</dd><dt>Measured clip-end → result</dt><dd>{last?`${Math.max(0,(last.receivedAtMs-last.sourceOffsetMs-last.durationMs)/1000).toFixed(2)} s`:'Not measured'}</dd></dl><p aria-live="polite">{state?.message??'No model observation yet.'}</p><p>Partial monitoring only. No whole-run compliance decision or automatic step completion.</p></div></div>
    <div className="live-ai-events">{state?.events.map((event,i)=><article key={event.id} className={findings[i].includes('Possible')||event.uncertain?'caution':''}><div><strong>{event.source} → {event.destination}</strong><span>{(event.startMs/1000).toFixed(2)}–{(event.endMs/1000).toFixed(2)} s · MODEL HYPOTHESIS</span></div><h3>{findings[i]}</h3><p>Human verification: {state.reviews[event.id]??'required'}. Model record remains unchanged.</p><button onClick={()=>setState(s=>s?{...s,reviews:{...s.reviews,[event.id]:'confirmed'}}:s)}>Confirm observation</button><button onClick={()=>setState(s=>s?{...s,reviews:{...s.reviews,[event.id]:'rejected'}}:s)}>Reject observation</button><small>Evidence windows: {event.windows.join(', ')}</small></article>)}</div>
    <details><summary>Local evidence provenance</summary><p>Session: {state?.id??'not started'}</p><p>Raw response reference: {last?.evidenceRef??'none'}</p><p className="live-ai-hash">Camera clip SHA-256: {last?.inputSha256??'not analyzed'}</p><p className="live-ai-hash">Normalized clip SHA-256: {last?.clipSha256??'not analyzed'}</p><p>Camera video is temporary; provider JSON and metadata stay private on this computer.</p></details>
    <p className="live-ai-footnote">Reviews are held in this page only. Raw provider evidence stays in the bridge’s private local capture directory. Stop and restart to change the approved procedure.</p>
  </section>
}
