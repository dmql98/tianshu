/**
 * dev-desktop.mjs
 *
 * Development orchestrator: keeps the dual-port hot-reload flow (Vite at 3457,
 * server via tsx at 3456) and drives an Electron window pointed at the Vite
 * dev server. Electron dev mode does NOT manage the server itself and the
 * updater is disabled.
 *
 *   server  → node <tsx cli> watch src/index.ts   (PORT 3456)
 *   client  → node <vite> --port 3457
 *   electron→ desktop/dist/desktop/src/main.js with TIANSHU_DEV_URL=:3457
 *
 * When the Electron window closes, Vite and the server are terminated.
 *
 * Note: `.cmd` shims cannot be spawned directly on Windows (EINVAL); we always
 * launch the JS entrypoints via process.execPath.
 */
import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const devRoot = resolve(__dirname, '..')
const serverDir = join(devRoot, 'web', 'server')
const clientDir = join(devRoot, 'web', 'client')
const desktopDir = join(devRoot, 'desktop')

const SERVER_PORT = Number(process.env.TIANSHU_SERVER_PORT || 3456)
const CLIENT_PORT = Number(process.env.TIANSHU_CLIENT_PORT || 3457)
const DEV_URL = `http://127.0.0.1:${CLIENT_PORT}`

const children = []

function log(msg) {
  console.log(`[dev-desktop] ${msg}`)
}

function runSync(cmd, args, opts) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts })
  if (res.status !== 0) {
    throw new Error(`command failed: ${res.stderr || res.stdout}`)
  }
}

// Ensure the desktop main/preload are compiled before launching Electron.
if (!existsSync(join(desktopDir, 'dist', 'desktop', 'src', 'main.js'))) {
  log('building desktop (tsc)…')
  // spawnSync cannot run .cmd directly on Windows; wrap through cmd.exe.
  const shellCmd = process.env.ComSpec || 'cmd.exe'
  const shellArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run build']
    : ['-c', 'npm run build']
  runSync(shellCmd, shellArgs, { cwd: desktopDir })
}

// Kill whatever is holding our dev ports so restarts are clean.
for (const port of [SERVER_PORT, CLIENT_PORT]) {
  const res = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
  const re = new RegExp(`:${port}\\s+.*LISTENING\\s+(\\d+)`, 'g')
  const pids = new Set()
  let m
  while ((m = re.exec(res.stdout)) !== null) pids.add(m[1])
  for (const pid of pids) {
    if (pid === '0') continue
    log(`killing pid ${pid} listening on ${port}`)
    spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { windowsHide: true })
  }
}

// Resolve the Electron userData dir via a short-lived Electron probe so the
// dev server shares the SAME config.json location and default data dir as the
// packaged app (BUILTIN_CONTENT_DEVELOPMENT_PLAN §3.1.1):
//   TIANSHU_CONFIG_DIR=<userData>
//   TIANSHU_DEFAULT_DATA_DIR=<userData>/data
const require2 = createRequire(import.meta.url)
const electronPath = require2(join(desktopDir, 'node_modules', 'electron'))
let userDataDir = process.env.TIANSHU_DEV_USERDATA
if (!userDataDir) {
  const probe = spawnSync(electronPath, [join(__dirname, 'get-userdata.cjs')], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  })
  if (probe.status !== 0 || !probe.stdout.trim()) {
    console.error('[dev-desktop] failed to resolve Electron userData; falling back to TIANSHU_DATA_DIR or TEMP')
    userDataDir = process.env.TIANSHU_DATA_DIR || join(process.env.TEMP || '.', 'tianshu-dev-userdata')
  } else {
    userDataDir = probe.stdout.trim()
  }
}
log(`userData dir: ${userDataDir}`)
const defaultDataDir = join(userDataDir, 'data')

function start(cmd, args, opts) {
  log(`${cmd} ${args.join(' ')}`)
  const child = spawn(cmd, args, { windowsHide: true, stdio: 'inherit', ...opts })
  children.push(child)
  return child
}

function killTree(pid) {
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

function killAll() {
  for (const child of children) {
    if (child.pid === undefined) continue
    killTree(child.pid)
  }
}

process.on('SIGINT', () => {
  killAll()
  process.exit(0)
})

// server — dev server shares the Electron userData config + default data dir
const tsxCli = join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const server = start(process.execPath, [tsxCli, 'watch', 'src/index.ts'], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(SERVER_PORT),
    // config.json 统一写在 server 程序路径（web/server/config.json），
    // 不再放在 userData；defaultDataDir 仍由外壳提供（dev 数据目录）。
    TIANSHU_DEFAULT_DATA_DIR: defaultDataDir,
    // Dev 内置内容定位仓库根 content/builtin（content/paths.ts 自带回退，
    // 这里显式注入以保证 dev/packaged 行为一致）。
    TIANSHU_BUILTIN_CONTENT_DIR: join(devRoot, 'content', 'builtin'),
  },
})

// client (vite) — bind 127.0.0.1 so the Electron window URL matches
const viteCli = join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js')
const vite = start(process.execPath, [viteCli, '--port', String(CLIENT_PORT), '--host', '127.0.0.1'], {
  cwd: clientDir,
})

// electron 在 dev servers 就绪后再启动（见下方 waitForPort 之后）。

async function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise((resolveCheck) => {
      const socket = new URL('http://127.0.0.1:' + port).port
      void socket
      const net = require2('net')
      const s = net.connect({ port, host: '127.0.0.1' })
      s.on('connect', () => {
        s.destroy()
        resolveCheck(true)
      })
      s.on('error', () => resolveCheck(false))
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

log('waiting for dev servers…')
const serverUp = await waitForPort(SERVER_PORT)
const viteUp = await waitForPort(CLIENT_PORT)
if (!serverUp || !viteUp) {
  console.error('[dev-desktop] dev servers did not come up in time')
  killAll()
  process.exit(1)
}
log(`dev servers up (${DEV_URL})`)

log(`electron: ${electronPath}`)
const electron = start(electronPath, [join(desktopDir, 'dist', 'desktop', 'src', 'main.js')], {
  env: { ...process.env, TIANSHU_DEV_URL: DEV_URL },
})

// When Electron closes, tear down Vite + server. A crashed dev child also
// stops the whole flow so the user can restart cleanly.
for (const child of [server, vite, electron]) {
  child.on('exit', () => {
    log('a child exited; stopping all')
    killAll()
    process.exit(0)
  })
}
