import {it,expect} from 'vitest'
import {liveCaption} from './caption'
import {newLiveState} from './model'
it('shows visible liquid colors without claiming physical cup identity',()=>{
 const s=newLiveState('mock','red-blue-then-green-red')
 s.events=[{id:'pour',source:'unknown',destination:'unknown',sourceLiquidColor:'red',destinationLiquidColor:'blue',startMs:100,endMs:900,evidence:[500],humanConfirmed:false,uncertain:true,windows:['w']}]
 expect(liveCaption(s)?.text).toBe('RED liquid → BLUE liquid')
 expect(liveCaption(s)?.concern).toBe(true)
 expect(s.events[0].source).toBe('unknown')
})
it('labels mixing by visible color when physical cup is unknown',()=>{
 const s=newLiveState('mock','red-blue-then-green-red')
 s.observations=[{id:'mix',category:'mixing',summary:'Mock stirring',startMs:100,endMs:900,evidence:[500],cups:['unknown'],liquidColor:'green',utensil:'fork',status:'observed',visibility:'mock',windows:['w']}]
 expect(liveCaption(s)?.text).toBe('GREEN liquid mixed')
})
