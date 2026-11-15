import { describe, expect, it } from 'vitest'
import { createRecordingDraft } from './recordingReview.ts'
import { parseRecordingAnalysis } from './recordingAnalysis.ts'
import { replaySnapshot, replayProvenance, replayFullResultsEnabled } from './replay.ts'

// Synthetic timings only; these are software fixtures, never model evaluation.
function fixture(second=false) {
 const pairs=second?[['GREEN','BLUE'],['BLUE','RED']]:[['RED','BLUE'],['GREEN','BLUE'],['GREEN','RED']]
 const raw={schemaVersion:'three-cup-recording-analysis/v0.1',sessionId:second?'test-session-2':'test-session-1',videoId:second?'recording-2':'recording-1',recording:{durationMs:10000,sizeBytes:100},segments:[{sourceOffsetMs:0,durationMs:10000,endMs:10000,observationStatus:'observed'}],timeline:{events:pairs.map(([sourceCupId,destinationCupId],i)=>({eventId:`e${i}`,sourceCupId,destinationCupId,eventStartMs:1000+i*2000,eventEndMs:1500+i*2000,evidenceTimestampsMs:[1200+i*2000],needsHumanVerification:true,humanConfirmed:false,observationStatus:'observed',segmentIndexes:[0]})),appearances:[]}}
 return createRecordingDraft(parseRecordingAnalysis(raw),second?'blue-red-then-green-blue':'red-blue-then-green-red','synthetic')
}
describe('actual media-time replay projection',()=>{
 it('reveals no future events and rewinds on backward seek or restart',()=>{
  const draft=fixture();expect(replaySnapshot(draft,0,false).visible).toHaveLength(0)
  expect(replaySnapshot(draft,3500,false).visible).toHaveLength(2)
  expect(replaySnapshot(draft,1100,false).visible).toHaveLength(1)
  expect(replaySnapshot(draft,0,false).metrics.reached).toBe(0)
 })
 it('derives approved, extra and later valid observations from reached history',()=>{
  const state=replaySnapshot(fixture(),5200,false)
  expect(state.visible.map(row=>row.kind)).toEqual(['match','extra','match'])
  expect(state.metrics.deviations).toBe(1);expect(state.active?.event.source).toBe('GREEN')
 })
 it('shows both reversed Recording2 findings without Recording1 leakage',()=>{
  const state=replaySnapshot(fixture(true),3400,false)
  expect(state.visible.map(row=>row.kind)).toEqual(['wrong_order','wrong_order'])
  expect(state.visible.some(row=>row.event.source==='RED')).toBe(false)
  expect(state.metrics.pending).toBe(2)
 })
 it('full-results is explicit while reached metrics remain driven by playback',()=>{
  const state=replaySnapshot(fixture(),0,true)
  expect(state.visible).toHaveLength(3);expect(state.metrics.reached).toBe(0);expect(state.active).toBeNull()
 })
 it('does not pretend latest completed event is active between events',()=>{
  const state=replaySnapshot(fixture(),2000,false)
  expect(state.active).toBeNull();expect(state.latest?.event.id).toBe('e0')
 })
 it('retains independent supplied/confirmed/rejected review states',()=>{
  const draft=fixture();draft.parsed.events[2].humanConfirmed=true
  draft.reviews=[{id:'r',type:'recording_review',analysisId:draft.id,eventId:'e0',action:'reject',reviewer:'Synthetic reviewer',note:'',observationTimestamp:1000}]
  const state=replaySnapshot(draft,6000,false)
  expect(state.visible.map(row=>row.reviewStatus)).toEqual(['rejected','unconfirmed','supplied_confirmation'])
  expect(state.metrics.pending).toBe(1)
  const other=fixture(true);other.reviews=draft.reviews
  expect(replaySnapshot(other,6000,false).visible[0].reviewStatus).toBe('unconfirmed')
 })
 it('reports only recorded provenance and has no invented geometry or confidence',()=>{
  const provenance=replayProvenance(fixture().analysis)
  expect(provenance.model).toBeNull();expect(provenance.latencyMs).toEqual([]);expect(provenance.estimatedCost).toBeNull()
  expect(provenance.geometry).toBe('not_available')
 })
 it('pause is stable and timestamps are original-source milliseconds exactly once',()=>{
  const draft=fixture(true)
  expect(replaySnapshot(draft,1200,false)).toEqual(replaySnapshot(draft,1200,false))
  expect(replaySnapshot(draft,1200,false).active?.event.startMs).toBe(1000)
 })
})

it('never carries Full Results into a different recording or selected file',()=>{
 const fileA={}, fileB={}
 const choice={key:'recording-a',fileKey:fileA,value:true}
 expect(replayFullResultsEnabled(choice,'recording-a',fileA)).toBe(true)
 expect(replayFullResultsEnabled(choice,'recording-b',fileB)).toBe(false)
 expect(replayFullResultsEnabled(choice,'recording-a',fileB)).toBe(false)
 expect(replayFullResultsEnabled(choice,null,null)).toBe(false)
})
