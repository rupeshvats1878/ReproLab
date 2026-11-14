import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLibraryServer } from './http.mjs'
import { createStoreFromEnv } from './store.mjs'

export const LISTEN_HOST = '127.0.0.1'

loadEnv(join(dirname(fileURLToPath(import.meta.url)), '.env'))

export function start(store = createStoreFromEnv(), port = Number(process.env.PORT || 8788)) {
  const server = createServer(createLibraryServer({ store }))
  server.listen(port, LISTEN_HOST)
  return server
}

const entry = process.argv[1]
if (entry && resolve(entry) === fileURLToPath(import.meta.url)) {
  const server = start()
  server.on('listening', () => {
    const configured = Boolean(process.env.MONGODB_URI && process.env.MONGODB_DB)
    console.log(`Experiment library on http://${LISTEN_HOST}:${server.address().port} (database ${configured ? 'configured' : 'not configured'})`)
  })
}

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] == null) process.env[key] = trimmed.slice(eq + 1).trim()
  }
}
