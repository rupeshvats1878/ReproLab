import { chooseRecorderMime } from './model.ts'
export interface FinalizedClip { blob:Blob;startMs:number;durationMs:number;sent:boolean }
/** No timeslice uploads: collect chunks, stop encoder, then return one complete file. */
export function recordClip(stream:MediaStream,sessionStart:number,windowMs:number,onClip:(clip:FinalizedClip)=>void,onError:()=>void) {
  const mime=chooseRecorderMime(type=>MediaRecorder.isTypeSupported(type))
  if(!mime)throw Error('This browser cannot record MP4 or WebM. Try Chrome.')
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:600_000})
  const chunks:BlobPart[]=[]
  let started=0,timer:ReturnType<typeof setTimeout>|undefined,cancelled=false
  recorder.onstart=()=>{started=performance.now();timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},windowMs)}
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
  recorder.onerror=()=>{clearTimeout(timer);if(!cancelled)onError()}
  recorder.onstop=()=>{
    clearTimeout(timer)
    if(cancelled)return
    const durationMs=Math.round(performance.now()-started)
    if(durationMs<250 || durationMs>20500 || !chunks.length){onError();return}
    onClip({blob:new Blob(chunks,{type:recorder.mimeType}),startMs:Math.round(started-sessionStart),durationMs:Math.min(20_000,durationMs),sent:false})
  }
  recorder.start()
  return {cancel(){cancelled=true;clearTimeout(timer);if(recorder.state==='recording')recorder.stop()}}
}
