import { describe, expect, it } from 'vitest'
import { createRecordingDraft, recordingAssociation, reviewAction, type StoredRecordingAnalysis } from './recordingReview.ts'
import { parseRecordingAnalysis, recordingComparisons } from './recordingAnalysis.ts'
const raw = (videoId = 'recording-2') => ({schemaVersion:'three-cup-recording-analysis/v0.1',sessionId:'synthetic-session',videoId,recording:{durationMs:2000,sizeBytes:1000},segments:[{sourceOffsetMs:0,durationMs:2000,endMs:2000,observationStatus:'observed'}],timeline:{events:[{eventId:'e1',sourceCupId:'GREEN',destinationCupId:'BLUE',eventStartMs:100,eventEndMs:200,evidenceTimestampsMs:[150],observationStatus:'observed',needsHumanVerification:true,humanConfirmed:false,segmentIndexes:[0]}],appearances:[]}})
describe('separate recording review sessions (synthetic)',()=>{
 it('freezes Recording 2 protocol and rejects using Recording 1 card',()=>{
  expect(()=>createRecordingDraft(parseRecordingAnalysis(raw()),'red-blue-then-green-red','synthetic')).toThrow(/procedure/)
  const draft=createRecordingDraft(parseRecordingAnalysis(raw()),'blue-red-then-green-blue','synthetic')
  expect(draft.captureProtocolId).toBe('blue-red-then-green-blue'); expect(draft.sessionId).toMatch(/^session_/)
 })
 it('requires verified source hashes and keeps original source times',()=>{
  const a=parseRecordingAnalysis(raw())
  expect(()=>recordingAssociation(a,'a'.repeat(64),'b'.repeat(64),1000,2000)).toThrow(/hash/)
  expect(recordingAssociation(a,'a'.repeat(64),'a'.repeat(64),1000,2000).sourceSha256).toBe('a'.repeat(64))
  expect(a.events[0].startMs).toBe(100)
 })
 it('keeps review events separate from the original analysis',()=>{
  const a=parseRecordingAnalysis(raw()), before=structuredClone(a)
  const saved={id:'analysis_test',analysis:a.raw,captureProtocolId:'blue-red-then-green-blue',dataKind:'synthetic'} as StoredRecordingAnalysis
  expect(reviewAction(saved,a.events[0],'reject','Researcher').action).toBe('reject'); expect(a).toEqual(before)
 })
})

describe('source identity and reversed transfer order',()=>{
 it('rejects a manifest contradicting the analysis source hash',()=>{
  const document={...raw(),recording:{durationMs:2000,sizeBytes:1000,sha256:'a'.repeat(64)}}
  const parsed=parseRecordingAnalysis(document)
  expect(()=>recordingAssociation(parsed,'b'.repeat(64),'b'.repeat(64),1000,2000)).toThrow(/hash/)
 })
})

it('shows both reversed Recording 2 hypotheses as possible wrong order, unconfirmed',()=>{
 const document=raw();document.timeline.events.push({...document.timeline.events[0],eventId:'e2',sourceCupId:'BLUE',destinationCupId:'RED',eventStartMs:500,eventEndMs:600,evidenceTimestampsMs:[550]})
 const parsed=parseRecordingAnalysis(document)
 expect(recordingComparisons(parsed.events,[['BLUE','RED'],['GREEN','BLUE']]).every(text=>text.includes('Possible wrong order'))).toBe(true)
 expect(parsed.events.every(event=>!event.humanConfirmed)).toBe(true)
})
