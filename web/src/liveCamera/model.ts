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
  windows: WindowResult[]; message: string; reviews: Record<string, 'confirmed'|'rejected'>
}
export function newLiveState(id:string,protocolId:CaptureProtocolId):LiveState {
  return {id,protocolId,stopped:false,lastIndex:-1,events:[],windows:[],message:'No analyzed windows yet. Coverage is incomplete.',reviews:{}}
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
    const existing=events.find(x=>x.source===e.sourceCupId && x.destination===e.destinationCupId && x.sourceLiquidColor===e.sourceLiquidColor && x.destinationLiquidColor===e.destinationLiquidColor && x.startMs<e.eventEndMs && e.eventStartMs<x.endMs && !x.windows.includes(result.windowId))
    if(existing) { existing.windows.push(result.windowId); continue }
    events.push({sourceLiquidColor:e.sourceLiquidColor,destinationLiquidColor:e.destinationLiquidColor,id:`${result.windowId}:${index}`,source:e.sourceCupId,destination:e.destinationCupId,startMs:e.eventStartMs,endMs:e.eventEndMs,evidence:e.evidenceTimestampsMs,humanConfirmed:false,uncertain:review.state==='uncertain'||e.observationStatus!=='observed'||!e.evidenceTimestampsMs.length,windows:[result.windowId]})
  }
  events.sort((a,b)=>a.startMs-b.startMs)
  return {...state,lastIndex:result.index,events,windows:[...state.windows,result],message:review.state==='no-transfer'?'No visible transfer reported in this window. This does not establish compliance.':review.state==='uncertain'?'Unclear observation — human review required.':'Genuine model hypotheses received — human review required.'}
}
export function liveFindings(state:LiveState):string[] {
  return recordingComparisons(state.events,captureProtocol(state.protocolId).transfers)
}
export function chooseRecorderMime(supported:(type:string)=>boolean):string {
  return ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(supported)||''
}
/** Reused by the capture loop and tests: skip busy windows, never queue them. */
export function shouldAnalyze(active:boolean,enabled:boolean,automatic:boolean,busy:boolean,used:number,max:number):boolean {
  return active && enabled && automatic && !busy && used<max
}
