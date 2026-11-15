import { handlingAnnotations } from './handlingAnnotations.ts'
import { useEffect, useRef, useState } from 'react'
import { postMonitor, RESULTS_SELECTION_KEY } from '../monitor/saveSession.ts'
import { sha256Hex } from './clipCheck.ts'
import { parseRecordingAnalysis, recordingComparisons } from './recordingAnalysis.ts'
import { captureProtocol } from './threeCup.ts'
import { reviewAction, type RecordingAssociation, type RecordingDraft, type RecordingHumanReview, type StoredRecordingAnalysis } from './recordingReview.ts'
import './recordingReview.css'

export function RecordingReviewCard({draft,association,onChange,onWatch}:{draft:RecordingDraft;association:RecordingAssociation|null;onChange:(draft:RecordingDraft)=>void;onWatch?:(time:number)=>void}) {
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reviewer,setReviewer]=useState('')
 async function save() {
  if (!association) {setNotice('Verify the original video against its SHA-256 manifest before saving.');return}
  setBusy(true);setNotice('')
  try {
   await postMonitor('/monitor-sessions',{sessionId:draft.sessionId,sourceKind:draft.dataKind==='synthetic'?'synthetic':'prerecorded',startedAtIso:draft.startedAtIso,procedureId:'three-cup-capture',captureProtocolId:draft.captureProtocolId})
   await postMonitor(`/monitor-sessions/${draft.sessionId}/events`,{id:draft.id,type:'recording_analysis',observationTimestamp:0,captureProtocolId:draft.captureProtocolId,analysis:draft.analysis,dataKind:draft.dataKind,association})
   onChange({...draft,saved:true,association});sessionStorage.setItem(RESULTS_SELECTION_KEY,draft.sessionId);setNotice('Saved as a separate three-cup session. Review decisions remain separate.')
  } catch(e) {setNotice(e instanceof Error?e.message:'Saving failed.')} finally {setBusy(false)}
 }
 async function review(eventId:string,action:'confirm'|'reject') {
  const event=draft.parsed.events.find(e=>e.id===eventId);if(!event)return
  setBusy(true)
  try {const record=reviewAction(draft,event,action,reviewer);await postMonitor(`/monitor-sessions/${draft.sessionId}/events`,record);onChange({...draft,reviews:[...draft.reviews,record]});setNotice('Human decision saved. Original model hypothesis retained.')}
  catch(e){setNotice(e instanceof Error?e.message:'Review was not saved.')}finally{setBusy(false)}
 }
 async function finish(){setBusy(true);try{await postMonitor(`/monitor-sessions/${draft.sessionId}/finish`);onChange({...draft,finished:true});sessionStorage.setItem(RESULTS_SELECTION_KEY,draft.sessionId);setNotice('Finished review session. Open Results to publish; this does not mean compliance.')}catch(e){setNotice(e instanceof Error?e.message:'Unable to finish.')}finally{setBusy(false)}}
 return <section className="recording-review" aria-label="Imported recording review">
  <h3>{draft.parsed.videoId} · {draft.dataKind==='synthetic'?'Synthetic software fixture':'Saved model hypotheses'}</h3>
  <p>{draft.parsed.sessionId} · Frozen procedure: {captureProtocol(draft.captureProtocolId).title}</p>
  <p>No automatic completion or compliance verdict. Physical cup IDs remain unchanged after mixing.</p>
  {!draft.saved && !association ? <p role="status">To save: open Analysis loaded · manage, add the original recording manifest under Verify source file, then link again. Local playback alone does not save a session.</p> : null}
  {!draft.saved?<button onClick={()=>void save()} disabled={busy||!association}>Save analysis for Results</button>:<p>Saved session {draft.sessionId}</p>}
  {draft.saved&&!draft.finished?<label>Reviewer <input value={reviewer} onChange={e=>setReviewer(e.target.value)} /></label>:null}
  <RecordingEvidence analyses={[draft]} reviews={draft.reviews} onWatch={onWatch} onReview={draft.saved&&!draft.finished?(id,action)=>void review(id,action):undefined} busy={busy}/>
  {draft.saved&&!draft.finished?<button onClick={()=>void finish()} disabled={busy}>Finish review for Results</button>:null}
  {notice?<p role="status">{notice}</p>:null}
 </section>
}

export function RecordingEvidence({analyses,reviews=[],onWatch,onReview,busy=false}:{analyses:StoredRecordingAnalysis[];reviews?:RecordingHumanReview[];onWatch?:(time:number)=>void;onReview?:(id:string,action:'confirm'|'reject')=>void;busy?:boolean}) {
 return <>{analyses.map(entry=>{
  let parsed;try{parsed=parseRecordingAnalysis(entry.analysis)}catch{return <p role="alert" key={entry.id}>Saved analysis is invalid and cannot be displayed as evidence.</p>}
  const findings=recordingComparisons(parsed.events,captureProtocol(entry.captureProtocolId).transfers)
  return <section key={entry.id}><h4>{parsed.videoId} · {captureProtocol(entry.captureProtocolId).title}</h4>
   <p>{entry.dataKind==='synthetic'?'Synthetic demonstration · ':''}Model observations, not verified ground truth. No chemical homogeneity or contamination claim.</p>
   {handlingAnnotations(entry.analysis,parsed.durationMs).length ? <section aria-label="Handling procedure concerns"><h4>Handling procedure concerns</h4><p>Team annotations · possible deviations requiring review, separate from model transfer hypotheses.</p><ul>{handlingAnnotations(entry.analysis,parsed.durationMs).map(item=><li key={item.timestampMs}><strong>{(item.timestampMs/1000).toFixed(0)} s · {item.message}</strong>{onWatch ? <button onClick={()=>onWatch(item.timestampMs)}>Watch handling moment</button> : null}</li>)}</ul></section> : null}
   <ol>{parsed.events.map((event,index)=>{const review=reviews.filter(r=>r.analysisId===entry.id&&r.eventId===event.id).at(-1);return <li key={event.id}>
    <strong>{event.source} → {event.destination}</strong> · {(event.startMs/1000).toFixed(2)}–{(event.endMs/1000).toFixed(2)} s
    <p>{findings[index]}</p><p>{review?`Human ${review.action==='confirm'?'confirmation':'rejection'} by ${review.reviewer}. Original hypothesis retained.`:'Unconfirmed · researcher review required.'}</p>
    {event.humanConfirmed?<p>Imported human-confirmation claim retained separately; not a new review decision.</p>:null}
    <p>Evidence: {event.evidence.map(t=>`${(t/1000).toFixed(2)} s`).join(', ')||'missing'}</p>
    {onWatch?<button onClick={()=>onWatch(event.startMs)}>Watch source moment</button>:null}
    {onReview?<><button disabled={busy} onClick={()=>onReview(event.id,'confirm')}>Confirm observation</button><button disabled={busy} onClick={()=>onReview(event.id,'reject')}>Reject observation</button></>:null}
   </li>})}</ol>
   {parsed.warnings.map(w=><p key={w}>{w}</p>)}
  </section>
 })}</>
}

/** Re-select original footage locally; published metadata never implies the video was uploaded. */
export function SavedRecordingEvidence({analyses,reviews}:{analyses:StoredRecordingAnalysis[];reviews?:RecordingHumanReview[]}) {
 const video=useRef<HTMLVideoElement>(null),generation=useRef(0)
 const [url,setUrl]=useState<string|null>(null),[linked,setLinked]=useState<string|null>(null),[notice,setNotice]=useState('')
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url])
 async function select(file:File,entry:StoredRecordingAnalysis){const token=++generation.current;setLinked(null);setNotice('Checking original video hash…');try{const hash=await sha256Hex(file);if(token!==generation.current)return;if(!entry.association||hash!==entry.association.sourceSha256)throw new Error('Video hash does not match this analysis. Seeking is disabled.');setUrl(URL.createObjectURL(file));setLinked(entry.id);setNotice('Original video hash verified locally. No video uploaded.')}catch(e){if(token===generation.current)setNotice(e instanceof Error?e.message:'Unable to read video.')}}
 return <section className="recording-review"><h3>Imported three-cup evidence</h3>
  {analyses.map(entry=><div key={entry.id}><label>Original video for {entry.captureProtocolId}<input type="file" accept="video/*" onChange={e=>{const f=e.target.files?.[0];if(f)void select(f,entry)}}/></label><RecordingEvidence analyses={[entry]} reviews={reviews} onWatch={linked===entry.id?(ms)=>{if(video.current&&ms>=0&&ms<=video.current.duration*1000)video.current.currentTime=ms/1000}:undefined}/></div>)}
  {url?<video ref={video} src={url} controls playsInline/>:null}{notice?<p role="status">{notice}</p>:null}
 </section>
}
