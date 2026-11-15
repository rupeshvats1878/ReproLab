import http from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, rm, rename, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec, normalize, mediaType, MAX_BYTES, hash } from './media.mjs'
const here = fileURLToPath(new URL('.', import.meta.url))
export const MAX_CALLS = 15
const int = (x,min,max) => Number.isSafeInteger(x) && x>=min && x<=max
const fail = (message, status=400) => Object.assign(new Error(message), {status})

export class LiveBridge {
  constructor({ processMedia=normalize, infer, recordEvidence=async()=>{}, implementation=null, reserve=async()=>{}, remaining=()=>MAX_CALLS, credentials=()=>Boolean(process.env.GEMINI_API_KEY), now=()=>Date.now() }={}) {
    Object.assign(this, {processMedia, recordEvidence, implementation, reserve, remaining, credentials, now})
    this.infer = infer || (async (path,s,window,start,captures) => {
      const {stdout} = await exec(process.env.PYTHON || 'python3', [join(here,'worker.py'),path,s.id,window,String(start),captures], {
        env:{...process.env, THREE_CUP_GEMINI_VIDEO_ENABLED:'1'}, timeout:35_000, maxBuffer:2*1024*1024,
      })
      return JSON.parse(stdout)
    })
    this.sessions=new Map(); this.busy=false; this.totalCalls=0
  }
  create({maxCalls=12, protocolId, enabled=false}) {
    if (!int(maxCalls,1,MAX_CALLS) || !['red-blue-then-green-red','blue-red-then-green-blue'].includes(protocolId) || typeof enabled!=='boolean') throw fail('Invalid session settings.')
    if (enabled && !this.credentials()) throw fail('GEMINI_API_KEY is not configured on the local bridge.',503)
    // A page reload can lose its session ID without delivering an unmount request.
    // Explicit Start supersedes that abandoned run, but never overlaps an API call.
    for(const previous of this.sessions.values())previous.stopped=true
    if(this.busy)throw fail('The previous live request is still finishing. Wait before starting again.',409)
    const s={id:randomUUID(),protocolId,maxCalls,callsUsed:0,enabled,stopped:false,next:0,lastStart:-1,created:this.now()}
    this.sessions.clear(); this.sessions.set(s.id,s)
    return {...s}
  }
  stop(id) { const s=this.sessions.get(id); if(s) s.stopped=true; return {stopped:true} }
  session(id) { const s=this.sessions.get(id); if(!s || s.stopped) throw fail('Session stopped or expired.',409); return s }
  async analyze(id, meta, bytes, type) {
    const s=this.session(id)
    if (!s.enabled) throw fail('Real Gemini analysis is disabled.',403)
    if (!this.credentials()) throw fail('Server credentials unavailable.',503)
    if (this.busy) throw fail('One clip is already being processed; this window was skipped.',409)
    if(s.callsUsed>=s.maxCalls || this.totalCalls>=MAX_CALLS || this.remaining()<=0) throw fail('Server call ceiling reached. No request sent.',429)
    if(!int(meta.index,0,100000) || meta.index!==s.next || !int(meta.startMs,0,3_600_000) || meta.startMs<=s.lastStart || !int(meta.durationMs,250,20_000) || meta.startMs+meta.durationMs > this.now()-s.created+3000) throw fail('Invalid, stale or out-of-order capture window.',409)
    const mime=mediaType(type,bytes)
    s.next++; s.lastStart=meta.startMs; this.busy=true
    const started=this.now(); let dir
    try {
      dir=await mkdtemp(join(tmpdir(),'reprolab-live-'))
      const input=join(dir,mime==='video/webm'?'camera.webm':'camera.mp4'), output=join(dir,'normalized.mp4')
      await writeFile(input,bytes,{mode:0o600})
      const media=await this.processMedia(input,output,meta.durationMs)
      this.session(id) // Stop during conversion cancels BEFORE any billable request.
      const window=`window-${meta.index}`
      await this.reserve() // Persist reservation BEFORE network. Failure is fail-closed.
      this.session(id)
      s.callsUsed++; this.totalCalls++
      const captures=join(here,'private','captures')
      const provenance={schemaVersion:'reprolab-live-provenance/v1',sessionId:id,windowId:window,sourceOffsetMs:meta.startMs,durationMs:media.durationMs,inputSha256:hash(bytes),clipSha256:media.clipSha256,model:'gemini-4-hydrogen',implementation:this.implementation,protocolId:s.protocolId,submittedAt:new Date(this.now()).toISOString(),sourceKind:'new-camera-upload',clipsRetained:false}
      await this.recordEvidence(id,window,'manifest',provenance)
      this.session(id)
      const observation=await this.infer(output,s,window,meta.startMs,captures)
      if(s.stopped) return {discarded:true,sessionId:id,callsUsed:s.callsUsed}
      if(!observation || observation.schemaVersion!=='three-cup-gemini-observation/v0.1' || observation.sessionId!==id || observation.videoId!==window || observation.sourceOffsetMs!==meta.startMs || !Array.isArray(observation.events) || !Number.isInteger(observation.videoDurationMs) || Math.abs(observation.videoDurationMs-media.durationMs)>2) throw fail('Invalid adapter response; human review required.',502)
      const evidenceRef=observation.capture?.rawResponsePath ? basename(observation.capture.rawResponsePath) : null
      const safe={...observation}; delete safe.capture
      const result={schemaVersion:'reprolab-live-window/v1',dataKind:'model',sessionId:id,windowId:window,index:meta.index,protocolId:s.protocolId,
        callsUsed:s.callsUsed,maxCalls:s.maxCalls,sourceOffsetMs:meta.startMs,durationMs:observation.videoDurationMs,
        inputSha256:hash(bytes),clipSha256:media.clipSha256,evidenceRef,receivedAtMs:this.now()-s.created,
        processingMs:this.now()-started,observation:safe,coverageComplete:false}
      await this.recordEvidence(id,window,'observation',result)
      return result
    } catch(error) {
      if(error.status) throw error
      throw fail(error.killed ? 'Processing timed out. No retry was made.' : 'Clip processing or model response failed. No retry was made.',502)
    } finally { this.busy=false; if(dir) await rm(dir,{recursive:true,force:true}) }
  }
}

async function body(req,max) {
  const length=Number(req.headers['content-length'])
  if(length>max) throw fail('Request too large.',413)
  const chunks=[]; let size=0
  for await (const chunk of req) { size+=chunk.length; if(size>max) throw fail('Request too large.',413); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
export function createServer(bridge,{uiOrigin='http://127.0.0.1:5184',token=randomBytes(32).toString('hex')}={}) {
  return http.createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
    try {
      if(!/^((127\.0\.0\.1|localhost)(:\d+)?|\[::1\](:\d+)?)$/.test(req.headers.host||'') || (req.headers.origin && req.headers.origin!==uiOrigin)) throw fail('Local same-origin access only.',403)
      if(req.method==='GET' && req.url==='/config') return send(200,{token,model:'gemini-4-hydrogen',maxCalls:MAX_CALLS,remainingCalls:bridge.remaining(),credentialsConfigured:bridge.credentials(),providerEnabled:false})
      if(req.headers['x-live-token']!==token) throw fail('Missing local session token.',403)
      if(req.method!=='POST') throw fail('Not found.',404)
      if(req.url==='/sessions') return send(200,bridge.create(JSON.parse((await body(req,4096)).toString())))
      const match=req.url?.match(/^\/sessions\/([a-f0-9-]+)\/(stop|clips)$/)
      if(!match) throw fail('Not found.',404)
      if(match[2]==='stop') return send(200,bridge.stop(match[1]))
      const meta=JSON.parse(String(req.headers['x-live-window']||'null'))
      if(!meta || typeof meta!=='object') throw fail('Missing capture window.')
      return send(200,await bridge.analyze(match[1],meta,await body(req,MAX_BYTES),String(req.headers['content-type']||'')))
    } catch(error) {send(error.status||400,{error:error.status ? error.message : 'Invalid request.',callsUsed:[...bridge.sessions.values()].at(-1)?.callsUsed||0})}
  })
}
export async function budgetLedger(path) {
  await mkdir(resolve(path,'..'),{recursive:true,mode:0o700})
  let used=0
  try {used=JSON.parse(await readFile(path,'utf8')).reservedCalls; if(!int(used,0,MAX_CALLS)) throw Error('Invalid budget ledger.')} catch(e) {if(e.code!=='ENOENT') throw e}
  return {remaining:()=>MAX_CALLS-used,reserve:async()=>{
    let lock
    try {
      lock=await open(path+'.lock','wx',0o600)
      // Re-read under the lock so another bridge cannot reset or race reservations.
      try { used=JSON.parse(await readFile(path,'utf8')).reservedCalls } catch(e) {if(e.code!=='ENOENT')throw e}
      if(!int(used,0,MAX_CALLS))throw fail('Invalid persistent budget ledger.',503)
      if(used>=MAX_CALLS) throw fail('Persistent 15-call budget ceiling reached.',429)
      used++
      await writeFile(path+'.tmp',JSON.stringify({reservedCalls:used,reservedUsd:used*0.25,policy:'15 calls total; $0.25 conservative reserve per bounded Hydrogen request'}),{mode:0o600})
      await rename(path+'.tmp',path)
    } finally {if(lock){await lock.close();await rm(path+'.lock',{force:true})}}
  }}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.LIVE_BRIDGE_PORT||8791)
  const budget=await budgetLedger(join(here,'private','budget.json'))
  const revision=(await exec('git',['rev-parse','HEAD'],{cwd:here})).stdout.trim()
  const dirty=Boolean((await exec('git',['status','--porcelain'],{cwd:here})).stdout.trim())
  const recordEvidence=async(id,window,kind,data)=>{
    const folder=join(here,'private','captures');await mkdir(folder,{recursive:true,mode:0o700})
    await writeFile(join(folder,`${id}-${window}-${kind}.json`),JSON.stringify(data,null,2),{mode:0o600,flag:'wx'})
  }
  const bridge=new LiveBridge({...budget,recordEvidence,implementation:{gitCommit:revision,gitDirty:dirty}})
  const server=createServer(bridge,{uiOrigin:process.env.LIVE_UI_ORIGIN||'http://127.0.0.1:5184'})
  server.requestTimeout=50_000; server.headersTimeout=10_000
  server.on('error',()=>{console.error('Live bridge cannot bind its port. No existing process was stopped.');process.exitCode=1})
  server.listen(port,'127.0.0.1',()=>console.log(`Live camera bridge at 127.0.0.1:${port}; provider OFF until explicitly enabled; ${budget.remaining()} calls remain.`))
}
