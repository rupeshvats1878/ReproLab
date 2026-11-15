// @vitest-environment jsdom
// All media and Gemini responses below are explicit mocks, never real predictions.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { LiveCamera } from './LiveCamera.tsx'
const mocks=vi.hoisted(()=>({onClip:null as null|((clip:{blob:Blob;startMs:number;durationMs:number;sent:boolean})=>void),cancel:vi.fn()}))
vi.mock('./capture.ts',()=>({recordClip:(_stream:unknown,_start:number,_duration:number,done:typeof mocks.onClip)=>{mocks.onClip=done;return {cancel:mocks.cancel}}}))
let container:HTMLDivElement,root:Root,trackStop:ReturnType<typeof vi.fn>,fetchMock:ReturnType<typeof vi.fn>
let pendingResponse:Promise<Response>|null=null
function button(text:string){return [...container.querySelectorAll('button')].find(x=>x.textContent===text)!}
function checkbox(text:string){return [...container.querySelectorAll('label')].find(x=>x.textContent?.includes(text))!.querySelector('input')!}
async function click(element:HTMLElement){await act(async()=>element.click())}
async function emit(){await act(async()=>mocks.onClip?.({blob:new Blob(['synthetic media'],{type:'video/webm'}),startMs:1000,durationMs:2000,sent:false}))}
function result(){return {schemaVersion:'reprolab-live-window/v1',dataKind:'model',sessionId:'mock-session',windowId:'window-0',index:0,protocolId:'blue-red-then-green-blue',sourceOffsetMs:1000,durationMs:2000,callsUsed:1,maxCalls:12,processingMs:100,receivedAtMs:3100,inputSha256:'a'.repeat(64),clipSha256:'b'.repeat(64),evidenceRef:null,coverageComplete:false,observation:{remoteCallMade:true,schemaVersion:'three-cup-gemini-observation/v0.1',sessionId:'mock-session',videoId:'window-0',sourceOffsetMs:1000,videoDurationMs:2000,observationStatus:'observed',latencyMs:100,error:null,events:[{sourceCupId:'GREEN',destinationCupId:'BLUE',eventStartMs:1200,eventEndMs:1500,evidenceTimestampsMs:[1300],observationStatus:'observed',needsHumanVerification:true}]}}}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);pendingResponse=null;mocks.cancel.mockClear();mocks.onClip=null
 trackStop=vi.fn();const track={stop:trackStop,onended:null};vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]}))}})
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue()
 fetchMock=vi.fn(async(url:string)=>{
   if(url.endsWith('/config'))return Response.json({token:'mock-token',credentialsConfigured:true,remainingCalls:12})
   if(url.endsWith('/sessions'))return Response.json({id:'mock-session'})
   if(url.endsWith('/stop'))return Response.json({stopped:true})
   if(url.endsWith('/clips'))return pendingResponse??Response.json(result())
   throw Error('Unexpected request')
 });vi.stubGlobal('fetch',fetchMock)
 container=document.createElement('div');document.body.append(container);root=createRoot(container)
 await act(async()=>root.render(createElement(LiveCamera,{beforeStart:()=>{}})))
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('default offline capture cannot send a clip; stop disposes camera',async()=>{
 await click(button('Start Live AI Monitoring'));await emit();expect(button('Analyze recent clip').disabled).toBe(true)
 expect(fetchMock.mock.calls.some(c=>String(c[0]).endsWith('/clips'))).toBe(false)
 await click(button('Stop Live AI Monitoring'));expect(trackStop).toHaveBeenCalled();expect(button('Start Live AI Monitoring').disabled).toBe(false)
})
it('manual mocked flow produces wrong-order finding and independent human review',async()=>{
 await click(checkbox('Enable Real Gemini Analysis'));await click(button('Start Live AI Monitoring'));await emit();await click(button('Analyze recent clip'))
 expect(container.textContent).toContain('Possible wrong order');expect(container.textContent).toContain('1.20–1.50 s')
 await click(button('Confirm observation'));expect(container.textContent).toContain('Human verification: confirmed')
 await click(button('Reject observation'));expect(container.textContent).toContain('Human verification: rejected')
 expect(container.textContent).toContain('MODEL HYPOTHESIS');expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(1)
})
it('automatic mode bounds its queue, reports overflow and stop ignores delayed response',async()=>{
 let release!:(r:Response)=>void;pendingResponse=new Promise(r=>release=r)
 await click(checkbox('Enable Real Gemini Analysis'));await click(button('Start Live AI Monitoring'));await emit();await emit();await emit();await emit()
 expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(1)
 expect(container.textContent).toContain('1 windows not analyzed')
 await click(button('Stop Live AI Monitoring'));await act(async()=>release(Response.json(result())))
 expect(container.textContent).not.toContain('Possible wrong order');await emit();expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(1)
})
it('failed model call stops automatic analysis without retry',async()=>{
 pendingResponse=Promise.resolve(Response.json({error:'Synthetic timeout',callsUsed:1},{status:502}))
 await click(checkbox('Enable Real Gemini Analysis'));await click(button('Start Live AI Monitoring'));await emit()
 expect(container.textContent).toContain('Synthetic timeout');expect(button('Start Live AI Monitoring').disabled).toBe(false)
 await emit();expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(1)
})

it('new findings appear beside camera without a camera-covering notification',async()=>{
 await click(checkbox('Enable Real Gemini Analysis'));await click(button('Start Live AI Monitoring'));await emit()
 expect(container.querySelector('.live-ai-toast')).toBeNull()
 const panel=container.querySelector('.live-ai-summary .live-ai-events')!
 expect(panel.textContent).toContain('GREEN → BLUE')
 expect(panel.textContent).toContain('Possible wrong order')
 expect(panel.textContent).toContain('Human verification: required')
})
it('stopping during capture cancels the active recorder without an upload',async()=>{
 await click(button('Start Live AI Monitoring'));await click(button('Stop Live AI Monitoring'))
 expect(mocks.cancel).toHaveBeenCalled();expect(trackStop).toHaveBeenCalled()
 expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(0)
})
it('bounded queue drains serially after an in-flight result',async()=>{
 let release!:(r:Response)=>void;pendingResponse=new Promise(r=>release=r)
 await click(checkbox('Enable Real Gemini Analysis'));await click(button('Start Live AI Monitoring'))
 await emit();await emit();await emit();await emit()
 expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(1)
 pendingResponse=null;await act(async()=>release(Response.json(result())))
 expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/clips'))).toHaveLength(3)
 expect(container.textContent).toContain('Coverage gaps (1)')
})
it('expanded mocked spill produces separate observation and risk cards with human controls',async()=>{
 const response=result() as ReturnType<typeof result>&{observation:Record<string,unknown>}
 response.observation.expanded={schemaVersion:'three-cup-live-window/v0.1',sessionId:'mock-session',videoId:'window-0',observations:[{eventId:'spill',category:'spill_or_splash',summary:'Mock visible droplets',eventStartMs:1800,eventEndMs:2000,evidenceTimestampsMs:[1900],cupIds:['BLUE'],utensil:'none',observationStatus:'observed',visibilityNote:'Mock clear view'}]}
 pendingResponse=Promise.resolve(Response.json(response))
 await click(checkbox('Enable Real Gemini Analysis'));await click(button('Start Live AI Monitoring'));await emit()
 expect(container.textContent).toContain('Mock visible droplets')
 expect(container.textContent).toContain('Visible liquid outside a vessel reported')
 expect(container.textContent).toContain('Derived risks · interpretations')
 expect(container.querySelectorAll('.live-ai-events article')).toHaveLength(3)
})
