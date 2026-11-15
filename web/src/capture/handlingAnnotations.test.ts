import { describe, expect, it } from 'vitest'
import { handlingAnnotations, activeHandling } from './handlingAnnotations.ts'
describe('team handling annotations',()=>{
 const item={timestampMs:42000,message:'Synthetic handling concern',source:'team-annotation'}
 it('requires explicit provenance and valid recording time',()=>{
  expect(handlingAnnotations({teamAnnotations:[item,{...item,source:'model'},{...item,timestampMs:100001},null]},100000)).toEqual([item])
 })
 it('does not show future flags and clears captions after four seconds',()=>{
  const items=handlingAnnotations({teamAnnotations:[item]},100000)
  expect(activeHandling(items,41999)).toBeUndefined()
  expect(activeHandling(items,42000)).toEqual(item)
  expect(activeHandling(items,46000)).toBeUndefined()
  expect(activeHandling(items,0)).toBeUndefined()
 })
})
