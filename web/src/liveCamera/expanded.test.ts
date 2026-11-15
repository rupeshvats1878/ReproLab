import {it,expect} from 'vitest'
import {mergeHandling,handlingRisks,type WindowResult} from './model'
// Explicitly mocked expanded model data; no real model findings are fixtures.
const item=(category='mixing',start=1100,end=1500,cups=['RED'],utensil='fork')=>({eventId:'e1',category,summary:'Mock visible action',eventStartMs:start,eventEndMs:end,evidenceTimestampsMs:[start+100],cupIds:cups,utensil,observationStatus:'observed',visibilityNote:'Mock evidence'})
const window=(observations:unknown[],index=0):WindowResult=>({schemaVersion:'reprolab-live-window/v1',sessionId:'mock',windowId:`window-${index}`,index,sourceOffsetMs:1000,durationMs:8000,observation:{expanded:{schemaVersion:'three-cup-live-window/v0.1',sessionId:'mock',videoId:`window-${index}`,observations}}} as WindowResult)
it('accepts every expanded category with original timestamps unchanged',()=>{
 const categories=['liquid_transfer','spill_or_splash','utensil_contact','cleaning_or_rinse','appearance_change','mixing','obstruction','other_visible_handling']
 const observations=mergeHandling([],window(categories.map(c=>item(c))))
 expect(observations.map(x=>x.category)).toEqual(categories);expect(observations.every(x=>x.startMs===1100)).toBe(true)
})
it('merges overlapping action evidence across windows, retains distinct repeated actions',()=>{
 let items=mergeHandling([],window([item()]))
 items=mergeHandling(items,window([item('mixing',1300,1800)],1));expect(items).toHaveLength(1);expect(items[0].endMs).toBe(1800)
 items=mergeHandling(items,window([item('mixing',1900,2300)],2));expect(items).toHaveLength(2)
})
it('does not merge two actions in the same window',()=>expect(mergeHandling([],window([item(),{...item(),eventId:'e2'}]))).toHaveLength(2))
it('invalid timing and missing evidence stay unclear, without invented times',()=>{
 const items=mergeHandling([],window([{...item(),eventEndMs:1100},{...item(),eventId:'e2',evidenceTimestampsMs:[]}]))
 expect(items.every(x=>x.status==='unclear')).toBe(true);expect(items.find(x=>x.id.endsWith('e1'))?.startMs).toBeNull()
})
it('empty observation window establishes no compliance or risk',()=>{expect(mergeHandling([],window([]))).toEqual([]);expect(handlingRisks([])).toEqual([])})
it('rejects expanded session mismatch',()=>{const w=window([]);(w.observation as any).expanded.sessionId='other';expect(()=>mergeHandling([],w)).toThrow(/provenance/)})
it('spill risk stays a separate interpretation',()=>{const events=mergeHandling([],window([item('spill_or_splash')]));expect(handlingRisks(events)[0].text).toContain('chemical contents are not established');expect(events[0].category).toBe('spill_or_splash')})
it('possible tool reuse, intervening cleaning, and unknown cups are distinguished',()=>{
 const contact1=item('utensil_contact',1100,1400,['RED'])
 const contact2={...item('utensil_contact',2000,2400,['GREEN']),eventId:'e2'}
 expect(handlingRisks(mergeHandling([],window([contact1,contact2])))).toHaveLength(1)
 const cleaning={...item('cleaning_or_rinse',1500,1800),eventId:'clean'}
 expect(handlingRisks(mergeHandling([],window([contact1,cleaning,contact2])))).toHaveLength(0)
 expect(handlingRisks(mergeHandling([],window([{...contact1,cupIds:['unknown']},contact2])))).toHaveLength(0)
})
