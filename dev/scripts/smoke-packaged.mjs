/**
 * smoke-packaged.mjs <nodeExe> <stagingServer> <clientDist>
 *
 * Verifies the packaged runtime with the bundled portable Node:
 *   1. Node version is the pinned runtime.
 *   2. better-sqlite3 loads under the bundled Node (native ABI check).
 *   3. The compiled server starts, serves /health, serves the SPA index, and
 *      shuts down cleanly via the shutdown IPC message.
 *
 * Exits non-zero on any failure.
 */
import { spawnSync, fork } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const [nodeExe, stagingServer, clientDist] = process.argv.slice(2)
if (!nodeExe || !stagingServer || !clientDist) {
  console.error('usage: node smoke-packaged.mjs <nodeExe> <stagingServer> <clientDist>')
  process.exit(1)
}

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

// 1. Node version
const ver = spawnSync(nodeExe, ['--version'], { encoding: 'utf8' })
if (ver.status !== 0) fail(`bundled node --version failed: ${ver.stderr}`)
console.log(`[smoke] bundled node ${ver.stdout.trim()}`)
if (!/^v24\.\d+\.\d+$/.test(ver.stdout.trim())) fail(`unexpected node version: ${ver.stdout.trim()}`)

// 2. better-sqlite3 native binding under bundled node
const sqlite = spawnSync(nodeExe, ['-e', "import('better-sqlite3').then(m => { const db = new m.default(':memory:'); db.exec('CREATE TABLE t(a)'); console.log('better-sqlite3 OK'); })"], {
  cwd: stagingServer,
  encoding: 'utf8',
})
if (sqlite.status !== 0) fail(`better-sqlite3 load failed: ${sqlite.stderr || sqlite.stdout}`)
console.log(`[smoke] ${sqlite.stdout.trim()}`)

// 3. fork the server exactly like Electron does
const dataDir = mkdtempSync(join(tmpdir(), 'tianshu-smoke-pkg-'))
const child = fork(join(stagingServer, 'dist', 'index.js'), [], {
  execPath: nodeExe,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    NODE_ENV: 'production',
    TIANSHU_CLIENT_DIST: clientDist,
    TIANSHU_CONFIG_DIR: dataDir,
    TIANSHU_DEFAULT_DATA_DIR: join(dataDir, 'data'),
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})

const timeout = setTimeout(() => {
  child.kill('SIGKILL')
  fail('server did not become ready within 30s')
}, 30000)

let port = 0
child.on('message', async (msg) => {
  if (msg && msg.type === 'ready') {
    clearTimeout(timeout)
    port = msg.port
    console.log(`[smoke] server ready on 127.0.0.1:${port}`)
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`)
      if (health.status !== 200) fail(`/health returned ${health.status}`)
      console.log('[smoke] /health 200')

      const index = await fetch(`http://127.0.0.1:${port}/`)
      if (index.status !== 200) fail(`/ returned ${index.status}`)
      console.log('[smoke] SPA index 200')

      const shutdown = await new Promise((resolveExit) => {
        child.send({ type: 'shutdown' })
        child.once('exit', (code) => resolveExit(code))
      })
      if (shutdown !== 0) fail(`server exit code ${shutdown}`)
      console.log('[smoke] graceful shutdown OK (exit 0)')
    } catch (err) {
      fail(err.message)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
})
child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
child.on('error', (err) => fail(err.message))
child.on('exit', (code) => {
  if (port === 0) {
    clearTimeout(timeout)
    fail(`server exited before ready (code ${code})`)
  }
})
