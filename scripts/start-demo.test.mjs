import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { occupiedMessage, portOpen, readListenPort, redact, stopChild } from './start-demo.mjs'

test('reads only a listen port and redacts credential-shaped text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reprolab-start-'))
  const file = join(dir, '.env')
  writeFileSync(file, 'GEMINI_API_KEY=secret-value\nPORT=8791\nMONGODB_URI=mongodb+srv://user:secret@cluster.example.net/db\n')
  assert.equal(readListenPort(file, 8788), 8791)
  assert.equal(readListenPort(join(dir, 'missing.env'), 8787), 8787)
  const hidden = redact('connect mongodb+srv://user:secret@cluster.example.net/db GEMINI_API_KEY=secret-value')
  assert.equal(hidden.includes('secret'), false)
  assert.match(hidden, /mongodb:\/\/\[redacted\]/)
  assert.match(hidden, /GEMINI_API_KEY=\[redacted\]/)
})

test('reports an occupied port without claiming the process was stopped', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    assert.equal(await portOpen(port), true)
    assert.equal(await portOpen(port + 1), false)
    const message = occupiedMessage([{ name: 'Vite', port }])
    assert.match(message, new RegExp(`Port ${port} is already in use \\(Vite\\)`))
    assert.match(message, /did not stop/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('stops its spawned child on request', { timeout: 10_000 }, async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  t.after(() => stopChild(child))
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve) => child.once('spawn', resolve))
  stopChild(child)
  const { code, signal } = await exited
  // A signal-terminated child correctly reports code=null and signal=SIGTERM.
  if (process.platform === 'win32') assert.equal(Number.isInteger(code), true)
  else assert.equal(signal, 'SIGTERM')
})
