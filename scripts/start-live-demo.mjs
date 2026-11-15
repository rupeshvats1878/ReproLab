#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import net from 'node:net'
const root=fileURLToPath(new URL('..',import.meta.url))
// Explicit env-file override supports an existing key without copying or printing it.
const envFile=process.env.LIVE_ENV_FILE || join(root,'server/live-camera/.env')
if(existsSync(envFile)) process.loadEnvFile(envFile)
const ui=Number(process.env.LIVE_UI_PORT||5184),bridge=Number(process.env.LIVE_BRIDGE_PORT||8791)
if(![ui,bridge].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||ui===bridge) throw Error('Choose two different local ports between 1024 and 65535.')
for(const [tool,args,hint] of [[process.env.PYTHON||'python3',['-c','import sys; assert sys.version_info >= (3,10)'],'Install Python 3.10+: brew install python'],[process.env.FFMPEG||'ffmpeg',['-version'],'Install FFmpeg: brew install ffmpeg'],[process.env.FFPROBE||'ffprobe',['-version'],'Install FFmpeg: brew install ffmpeg']]) {
  if(spawnSync(tool,args,{stdio:'ignore'}).status!==0){console.error(hint);process.exit(1)}
}
for(const port of [ui,bridge]) {
  const available=await new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)))})
  if(!available){console.error(`Port ${port} is occupied. No process was stopped. Set LIVE_UI_PORT and LIVE_BRIDGE_PORT to unused ports.`);process.exit(1)}
}
if(!existsSync(join(root,'web/node_modules/vite'))) {console.error('Install frontend dependencies first: npm ci --prefix web');process.exit(1)}
const env={...process.env,LIVE_BRIDGE_PORT:String(bridge),LIVE_UI_ORIGIN:`http://127.0.0.1:${ui}`,LIVE_BRIDGE_URL:`http://127.0.0.1:${bridge}`}
let stopping=false
const children=[spawn(process.execPath,['server/live-camera/bridge.mjs'],{cwd:root,env,stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(ui),'--strictPort'],{cwd:join(root,'web'),env,stdio:'inherit'})]
function stop(code=0){if(stopping)return;stopping=true;children.forEach(c=>c.kill('SIGTERM'));setTimeout(()=>process.exit(code),500).unref()}
children.forEach(c=>{c.on('error',()=>stop(1));c.on('exit',code=>{if(!stopping)stop(code||0)})})
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop())
console.log(`Live demo: http://127.0.0.1:${ui} — Monitor → Three-cup capture. Real inference starts OFF.`)
console.log(process.env.GEMINI_API_KEY?'Server-side Gemini key is configured.':'Preview works without a key. Set GEMINI_API_KEY or LIVE_ENV_FILE for real inference.')
console.log('12 calls total across restarts; no retries. Ctrl+C stops only these child services. Existing Library/text services are not changed.')
