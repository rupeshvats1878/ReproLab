import { describe, it, expect } from 'vitest'
import { DEMO_COMPLETE } from '../shared/exampleRun.ts'
import { PROTOCOL_ORDER } from '../shared/types.ts'
import { validateRunRecord } from '../shared/protocol.ts'
import { createReviewState, reduceReview, runRecordFromState } from './engine.ts'
import { compareRuns } from './compare.ts'
import { memoryRunStore, saveRun } from './store.ts'
import { rememberVisionBlob } from '../vision/media.ts'

describe('integration regressions', () => {
 it('does not report unknown final wells as empty or invent a missing final image', () => {
   const r = structuredClone(DEMO_COMPLETE)
   r.finalAssessment!.wells = r.finalAssessment!.wells.map(w => ({ ...w, state: 'unknown', matchesExpectedFilled: false }))
   const comparison = compareRuns([r])
   expect(comparison.runs[0]!.finalEmpty).toEqual([])
   expect(comparison.summary).toContain('unknown')
   delete r.finalAssessment
   expect(compareRuns([r]).summary).toContain('No final image assessment')
 })
 it('flags a trailing empty well at completion and accepts a later final assessment', () => {
   let s = reduceReview(createReviewState(), {type:'startRun', draft:{source:'live',title:'Trailing skip'}})
   s = reduceReview(s,{type:'recordObservation',draft:{elapsedMs:1000,wells:PROTOCOL_ORDER.map(wellId=>({wellId,state:wellId==='B3'?'empty':'filled'}))}})
   expect(s.protocol.alerts).toHaveLength(0)
   s=reduceReview(s,{type:'completeRun',completion:{elapsedMs:2000}})
   expect(s.protocol.alerts[0]!.wellId).toBe('B3')
   expect(validateRunRecord(runRecordFromState(s)!)).toEqual([])
   s=reduceReview(s,{type:'completeRun',completion:{elapsedMs:2000,finalAssessment:{elapsedMs:2000,wells:PROTOCOL_ORDER.map(wellId=>({wellId,state:'unknown',matchesExpectedFilled:false}))}}})
   expect(s.protocol.finalAssessment).toBeDefined()
 })
 it('copies captured vision bytes into the run store and deletes both copies', async () => {
   const store=memoryRunStore(); const record=structuredClone(DEMO_COMPLETE)
   const id=record.media[0]!.mediaId
   record.media = [{...record.media[0]!,available:true}]
   rememberVisionBlob(id,new Blob(['captured bytes']))
   await saveRun(store,record)
   expect(await (await store.getBlob(id))!.text()).toBe('captured bytes')
   await store.delete(record.metadata.id)
   expect(await store.getBlob(id)).toBeUndefined()
 })
})
