import {it,expect,vi,afterEach} from 'vitest'
import {recordClip} from './capture.ts'
class Recorder {
 static isTypeSupported=(type:string)=>type==='video/webm'
 static instance:Recorder
 mimeType='video/webm';state='inactive'
 onstart:(()=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null
 constructor(){Recorder.instance=this}
 start(){this.state='recording';this.onstart?.()}
 stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['final trailer'])});this.onstop?.()}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
it('finalizes MediaRecorder before returning a standalone window',async()=>{
 vi.useFakeTimers();vi.stubGlobal('MediaRecorder',Recorder);const done=vi.fn(),error=vi.fn()
 recordClip({} as MediaStream,performance.now(),2000,done,error)
 Recorder.instance.ondataavailable?.({data:new Blob(['header'])})
 expect(done).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(2000)
 expect(done).toHaveBeenCalledOnce();expect(Recorder.instance.state).toBe('inactive');expect(await done.mock.calls[0][0].blob.text()).toBe('headerfinal trailer');expect(error).not.toHaveBeenCalled()
})
it('stop cancels a pending clip and no upload callback runs',async()=>{
 vi.useFakeTimers();vi.stubGlobal('MediaRecorder',Recorder);const done=vi.fn();const clip=recordClip({} as MediaStream,0,2000,done,vi.fn());clip.cancel();await vi.advanceTimersByTimeAsync(3000);expect(done).not.toHaveBeenCalled();expect(Recorder.instance.state).toBe('inactive')
})
it('unsupported recorder MIME is explicit',()=>{vi.stubGlobal('MediaRecorder',{isTypeSupported:()=>false});expect(()=>recordClip({} as MediaStream,0,2000,vi.fn(),vi.fn())).toThrow(/browser/)})
