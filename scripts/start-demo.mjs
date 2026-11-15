import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const SERVICES = [
  {
    name: 'Gemini',
    cwd: join(root, 'server'),
    args: ['start'],
    port: 8787,
    envFile: join(root, 'server', '.env'),
  },
  {
    name: 'Atlas library',
    cwd: join(root, 'server', 'library'),
    args: ['start'],
    port: 8788,
    envFile: join(root, 'server', 'library', '.env'),
  },
  {
    name: 'Vite',
    cwd: join(root, 'web'),
    args: ['run', 'dev'],
    port: 5173,
    envFile: null,
  },
]

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

export function readListenPort(envFile, fallback) {
  if (!envFile || !existsSync(envFile)) return fallback
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    if (trimmed.slice(0, eq).trim() !== 'PORT') continue
    const value = Number(trimmed.slice(eq + 1).trim())
    if (Number.isInteger(value) && value > 0 && value < 65536) return value
  }
  return fallback
}

export function redact(text) {
  return String(text)
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, 'mongodb://[redacted]')
    .replace(/(GEMINI_API_KEY|MONGODB_URI|MONGODB_PASSWORD|PASSWORD)\s*[:=]\s*\S+/gi, '$1=[redacted]')
}

function connectPort(port, host) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host, port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePort(open)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(400, () => finish(false))
  })
}

export async function portOpen(port) {
  if (await connectPort(port, '127.0.0.1')) return true
  return connectPort(port, '::1')
}

export function occupiedMessage(occupied) {
  return [
    ...occupied.map((item) => `Port ${item.port} is already in use (${item.name}).`),
    'This command did not stop the existing process.',
    'Free that port, then run: node scripts/start-demo.mjs',
  ].join('\n')
}

export function stopChild(child) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* The child has already exited. */
    }
  }
}

export function spawnService(service, extra = {}) {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand()
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...service.args] : service.args
  return spawn(command, args, {
    cwd: service.cwd,
    env: extra.env,
    stdio: extra.stdio ?? ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
}

function pipe(service, stream) {
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) console.log(`[${service.name}] ${redact(line)}`)
    }
  })
}

async function main() {
  const planned = SERVICES.map((service) => ({ ...service, port: readListenPort(service.envFile, service.port) }))
  const occupied = []
  for (const service of planned) {
    if (await portOpen(service.port)) occupied.push(service)
  }
  if (occupied.length > 0) {
    console.error(occupiedMessage(occupied))
    process.exitCode = 1
    return
  }

  const children = planned.map((service) => {
    const child = spawnService(service)
    pipe(service, child.stdout)
    pipe(service, child.stderr)
    child.on('error', (error) => {
      console.error(`[${service.name}] ${redact(error.message)}`)
    })
    child.on('exit', (code, signal) => {
      if (stopping) return
      console.error(`[${service.name}] exited (${signal ?? code ?? 'unknown'}). Stopping the other demo processes.`)
      shutdown(1)
    })
    return child
  })

  let stopping = false
  function shutdown(code = 0) {
    if (stopping) return
    stopping = true
    for (const child of children) stopChild(child)
    setTimeout(() => process.exit(code), 600).unref()
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  console.log('Demo processes started. Press Ctrl+C to stop Gemini, the Atlas library, and Vite.')
}

const calledDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (calledDirectly) {
  main()
}
