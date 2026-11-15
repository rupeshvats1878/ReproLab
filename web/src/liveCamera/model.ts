import { reviewModelObservation } from '../capture/geminiObservation.ts'
import { recordingComparisons, type RecordingEvent } from '../capture/recordingAnalysis.ts'
import { captureProtocol, type CaptureProtocolId } from '../capture/threeCup.ts'
export const LIVE_SCHEMA = 'reprolab-live-window/v1'
export interface WindowResult {
  schemaVersion: string; dataKind: string; sessionId: string; windowId: string; index: number
  sourceOffsetMs: number; durationMs: number; callsUsed: number; maxCalls: number; protocolId: CaptureProtocolId
  processingMs: number; receivedAtMs: number; inputSha256: string; clipSha256: string; evidenceRef: string | null
  observation: unknown; coverageComplete: false
}
export interface LiveEvent extends RecordingEvent { sourceLiquidColor?:string; destinationLiquidColor?:string; windows: string[] }
export interface LiveState {
  id: string; protocolId: CaptureProtocolId; stopped: boolean; lastIndex: number; events: LiveEvent[]
  observations: HandlingEvent[]; windows: WindowResult[]; message: string; reviews: Record<string, 'confirmed'|'rejected'>
}
export function newLiveState(id:string,protocolId:CaptureProtocolId):LiveState {
  return {id,protocolId,stopped:false,lastIndex:-1,events:[],observations:[],windows:[],message:'No analyzed windows yet. Coverage is incomplete.',reviews:{}}
}
export function acceptWindow(state:LiveState,result:WindowResult):LiveState {
  if(state.stopped || result.sessionId!==state.id || result.index<=state.lastIndex) return state
  if((result.observation as {remoteCallMade?:unknown})?.remoteCallMade!==true) throw Error('No genuine remote model observation is attached.')
  if(result.schemaVersion!==LIVE_SCHEMA || result.dataKind!=='model' || result.protocolId!==state.protocolId || result.coverageComplete!==false || !Number.isInteger(result.index) || !/^[0-9a-f]{64}$/.test(result.clipSha256) || !/^[0-9a-f]{64}$/.test(result.inputSha256)) throw Error('Invalid live provenance.')
  const review=reviewModelObservation(result.observation,{sessionId:state.id,videoId:result.windowId,clipStartMs:result.sourceOffsetMs,clipEndMs:result.sourceOffsetMs+result.durationMs})
  if(!review.accepted) throw Error(`Observation requires review: ${review.reason}`)
  const events=state.events.map(e=>({...e,windows:[...e.windows]}))
  for(const [index,e] of review.events.entries()) {
    // Only overlapping intervals from distinct windows can denote the same pour.
    // Adjacent/repeated pours remain independent observations.
    const existing=events.find(x=>e.sourceCupId!=='unknown'&&e.destinationCupId!=='unknown'&&x.source===e.sourceCupId && x.destination===e.destinationCupId && x.sourceLiquidColor===e.sourceLiquidColor && x.destinationLiquidColor===e.destinationLiquidColor && x.startMs<e.eventEndMs && e.eventStartMs<x.endMs && !x.windows.includes(result.windowId))
    if(existing) { existing.windows.push(result.windowId);existing.startMs=Math.min(existing.startMs,e.eventStartMs);existing.endMs=Math.max(existing.endMs,e.eventEndMs);existing.evidence=[...new Set([...existing.evidence,...e.evidenceTimestampsMs])];existing.uncertain ||= e.observationStatus!=='observed'; continue }
    events.push({sourceLiquidColor:e.sourceLiquidColor,destinationLiquidColor:e.destinationLiquidColor,id:`${result.windowId}:${index}`,source:e.sourceCupId,destination:e.destinationCupId,startMs:e.eventStartMs,endMs:e.eventEndMs,evidence:e.evidenceTimestampsMs,humanConfirmed:false,uncertain:review.state==='uncertain'||e.observationStatus!=='observed'||!e.evidenceTimestampsMs.length,windows:[result.windowId]})
  }
  events.sort((a,b)=>a.startMs-b.startMs)
  const observations=mergeHandling(state.observations, result)
  return {...state,lastIndex:result.index,events,observations,reviews:Object.fromEntries(Object.entries(state.reviews).filter(([id])=>{const before=[...state.events,...state.observations].find(e=>e.id===id);const after=[...events,...observations].find(e=>e.id===id);return JSON.stringify(before)===JSON.stringify(after)})),windows:[...state.windows,result],message:observations.length>state.observations.length?'Expanded model observations received — human review required.':review.state==='no-transfer'?'No visible transfer reported in this window. This does not establish compliance.':review.state==='uncertain'?'Unclear observation — human review required.':'Genuine model hypotheses received — human review required.'}
}
export function liveFindings(state:LiveState):string[] {
  return recordingComparisons(state.events,captureProtocol(state.protocolId).transfers)
}
export function chooseRecorderMime(supported:(type:string)=>boolean):string {
  return ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(supported)||''
}
/** Legacy immediate-dispatch predicate; the component separately bounds its pending queue. */
export function shouldAnalyze(active:boolean,enabled:boolean,automatic:boolean,busy:boolean,used:number,max:number):boolean {
  return active && enabled && automatic && !busy && used<max
}

export interface HandlingEvent {
 id:string; category:string; summary:string; startMs:number|null; endMs:number|null; evidence:number[];
 liquidColor?:string; cups:string[]; source?:string; destination?:string; utensil:string; status:string; visibility:string; windows:string[]
}
export function mergeHandling(previous:HandlingEvent[],result:WindowResult):HandlingEvent[] {
 const expanded=(result.observation as {expanded?:{schemaVersion:string;sessionId:string;videoId:string;observations:unknown[]}}).expanded
 if(!expanded)return previous
 if(expanded.schemaVersion!=='three-cup-live-window/v0.1'||expanded.sessionId!==result.sessionId||expanded.videoId!==result.windowId||!Array.isArray(expanded.observations))throw Error('Invalid expanded observation provenance.')
 const next=previous.map(e=>({...e,windows:[...e.windows]}))
 for(const raw of expanded.observations){
  if(!raw||typeof raw!=='object')throw Error('Invalid expanded event.')
  const e=raw as Record<string,unknown>
  const categories=['liquid_transfer','spill_or_splash','utensil_contact','cleaning_or_rinse','appearance_change','mixing','obstruction','other_visible_handling']
  if(!categories.includes(String(e.category))||typeof e.summary!=='string'||!['observed','possible','unclear'].includes(String(e.observationStatus)))throw Error('Invalid expanded event fields.')
  const start=typeof e.eventStartMs==='number'&&Number.isInteger(e.eventStartMs)?e.eventStartMs:null
  const end=typeof e.eventEndMs==='number'&&Number.isInteger(e.eventEndMs)?e.eventEndMs:null
  const valid=start!==null&&end!==null&&start>=result.sourceOffsetMs&&end>start&&end<=result.sourceOffsetMs+result.durationMs
  const evidence=Array.isArray(e.evidenceTimestampsMs)?e.evidenceTimestampsMs.filter((v):v is number=>typeof v==='number'&&Number.isInteger(v)&&valid&&v>=start!&&v<=end!):[]
  const item:HandlingEvent={liquidColor:typeof e.liquidColor==='string'&&['red','green','blue','yellow','orange','purple','brown','clear','mixed','other'].includes(e.liquidColor)?e.liquidColor:'unknown',source:typeof e.sourceCupId==='string'?e.sourceCupId:'unknown',destination:typeof e.destinationCupId==='string'?e.destinationCupId:'unknown',id:`${result.windowId}:${String(e.eventId)}`,category:String(e.category),summary:e.summary.slice(0,1000),startMs:valid?start:null,endMs:valid?end:null,evidence,cups:Array.isArray(e.cupIds)?e.cupIds.filter((c):c is string=>['RED','GREEN','BLUE','unknown'].includes(String(c))):[],utensil:String(e.utensil),status:valid&&evidence.length?String(e.observationStatus):'unclear',visibility:typeof e.visibilityNote==='string'?e.visibilityNote:'',windows:[result.windowId]}
  // Conservative overlap only. Near-but-disjoint actions can be distinct repeats.
  const old=next.find(x=>x.category===item.category&&(item.category!=='liquid_transfer'||(item.source!=='unknown'&&item.destination!=='unknown'&&x.source===item.source&&x.destination===item.destination))&&x.utensil===item.utensil&&x.cups.join()===item.cups.join()&&!x.windows.includes(result.windowId)&&x.startMs!==null&&item.startMs!==null&&x.endMs!==null&&item.endMs!==null&&x.startMs<item.endMs&&item.startMs<x.endMs)
  if(old){old.windows.push(result.windowId);old.startMs=Math.min(old.startMs!,item.startMs!);old.endMs=Math.max(old.endMs!,item.endMs!);old.evidence=[...new Set([...old.evidence,...item.evidence])];if(item.status!=='observed')old.status=item.status}
  else next.push(item)
 }
 return next.sort((a,b)=>(a.startMs??Infinity)-(b.startMs??Infinity))
}
export function handlingRisks(items:HandlingEvent[]):{id:string;text:string}[]{
 const risks=items.filter(e=>e.category==='spill_or_splash'&&e.status!=='unclear').map(e=>({id:e.id,text:'Visible liquid outside a vessel reported. Review the evidence; chemical contents are not established.'}))
 const contacts=items.filter(e=>e.category==='utensil_contact'&&e.status!=='unclear'&&['fork','pipette','stirrer'].includes(e.utensil)&&e.startMs!==null)
 for(let i=1;i<contacts.length;i++){
  const b=contacts[i],a=contacts.slice(0,i).reverse().find(x=>x.utensil===b.utensil)
  if(!a||!a.cups.some(c=>['RED','GREEN','BLUE'].includes(c))||!b.cups.some(c=>['RED','GREEN','BLUE'].includes(c))||a.cups.join()===b.cups.join())continue
  const cleaning=items.some(e=>e.category==='cleaning_or_rinse'&&e.status!=='unclear'&&[a.utensil,'unknown','none'].includes(e.utensil)&&e.startMs!==null&&e.endMs!==null&&e.startMs>=a.endMs!&&e.endMs<=b.startMs!)
  if(!cleaning)risks.push({id:`${a.id}:${b.id}`,text:`Possible utensil carryover: a reported ${a.utensil} contacted different cups. Tool identity is not tracked and cleaning may have happened off camera. No contamination is established.`})
 }
 return risks
}
