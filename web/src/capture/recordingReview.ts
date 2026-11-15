import { captureProtocol, type CaptureProtocolId } from './threeCup.ts'
import { recordingLinkError, type RecordingAnalysis, type RecordingEvent } from './recordingAnalysis.ts'
export interface RecordingAssociation { sourceSha256: string; byteLength: number; durationMs: number; method: 'sha256' }
export interface StoredRecordingAnalysis { id: string; analysis: unknown; captureProtocolId: CaptureProtocolId; dataKind: 'real'|'synthetic'; association?: RecordingAssociation }
export interface RecordingHumanReview { id: string; type: 'recording_review'; analysisId: string; eventId: string; action: 'confirm'|'reject'; reviewer: string; note: string; observationTimestamp: number }
export interface RecordingDraft extends StoredRecordingAnalysis { parsed: RecordingAnalysis; sessionId: string; startedAtIso: string; saved: boolean; finished: boolean; reviews: RecordingHumanReview[] }
export function createRecordingDraft(analysis: RecordingAnalysis, protocolId: CaptureProtocolId, dataKind: 'real'|'synthetic'): RecordingDraft {
  const expected = analysis.videoId === 'recording-2' ? 'blue-red-then-green-blue' : analysis.videoId === 'recording-1' ? 'red-blue-then-green-red' : null
  if (expected && expected !== protocolId) throw new Error(`Choose the approved procedure ${captureProtocol(expected).title} before importing ${analysis.videoId}.`)
  if (dataKind==='real' && JSON.stringify(analysis.raw).includes('"dataKind":"synthetic"')) throw new Error('Synthetic observations must stay labeled synthetic.')
  return {id:`analysis_${crypto.randomUUID()}`,sessionId:`session_${crypto.randomUUID()}`,startedAtIso:new Date().toISOString(),analysis:analysis.raw,parsed:analysis,captureProtocolId:protocolId,dataKind,saved:false,finished:false,reviews:[]}
}
export function recordingAssociation(analysis: RecordingAnalysis, expectedHash: string|null, actualHash: string|null, byteLength: number, durationMs: number): RecordingAssociation {
  if (!expectedHash || !actualHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) throw new Error('Load the original recording SHA-256 manifest before saving this analysis.')
  const error=recordingLinkError(analysis,byteLength,durationMs,expectedHash,actualHash)
  if (error) throw new Error(error)
  return {sourceSha256:actualHash.toLowerCase(),byteLength,durationMs,method:'sha256'}
}
export function reviewAction(analysis: StoredRecordingAnalysis,event: RecordingEvent,action:'confirm'|'reject',reviewer:string):RecordingHumanReview {
  if (!reviewer.trim()) throw new Error('Enter the reviewer name before recording a decision.')
  return {id:`review_${crypto.randomUUID()}`,type:'recording_review',analysisId:analysis.id,eventId:event.id,action,reviewer:reviewer.trim(),note:'Reviewed against the original recording; no automatic protocol completion.',observationTimestamp:event.startMs}
}
