/**
 * prepare-desktop-runtime.mjs
 *
 * Builds the fully disposable packaging staging for the desktop installer:
 *   1. Rebuilds desktop/staging and desktop/runtime (deleting old contents,
 *      after asserting the targets live under dev/desktop).
 *   2. Downloads the fixed portable Node win-x64 ZIP from nodejs.org and
 *      verifies its SHA-256 against the official SHASUMS256.txt.
 *   3. Extracts it to desktop/runtime/node.
 *   4. Copies web/client/dist -> staging/client.
 *   5. Copies web/server dist + package.json + package-lock.json -> staging/server
 *      and runs `npm ci --omit=dev` there (never copies the dev node_modules).
 *   6. Runs the packaged smoke test with the bundled Node.
 *
 * Run from dev/: node scripts/prepare-desktop-runtime.mjs
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'fs'
import https from 'https'
import { dirname, join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const devRoot = resolve(__dirname, '..')
const desktopDir = join(devRoot, 'desktop')

// Must match dev/.node-version and the installed dev Node (better-sqlite3 ABI).
const NODE_VERSION = 'v24.14.0'
const ZIP_NAME = `node-${NODE_VERSION}-win-x64.zip`
const BASE_URL = `https://nodejs.org/dist/${NODE_VERSION}`
const ZIP_URL = `${BASE_URL}/${ZIP_NAME}`
const SHASUM_URL = `${BASE_URL}/SHASUMS256.txt`

const stagingDir = join(desktopDir, 'staging')
const runtimeDir = join(desktopDir, 'runtime')
const cacheDir = join(process.env.LOCALAPPDATA || process.env.TEMP, 'tianshu-build-cache')

function assertInsideDesktop(p) {
  if (p !== desktopDir && !p.startsWith(desktopDir + sep)) {
    throw new Error(`Refusing to operate outside dev/desktop: ${p}`)
  }
}

function log(msg) {
  console.log(`[prepare-desktop-runtime] ${msg}`)
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts })
  if (res.status !== 0) {
    throw new Error(`Command failed (${cmd} ${args.join(' ')}): ${res.stderr || res.stdout}`)
  }
  if (res.stdout) process.stdout.write(res.stdout)
  return res.stdout
}

function download(url, dest) {
  return new Promise((resolvePromise, reject) => {
    const follow = (u) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            follow(new URL(res.headers.location, u).toString())
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`))
            res.resume()
            return
          }
          mkdirSync(dirname(dest), { recursive: true })
          const ws = createWriteStream(`${dest}.part`)
          res.pipe(ws)
          ws.on('finish', () => {
            ws.close()
            renameSync(`${dest}.part`, dest)
            resolvePromise()
          })
          ws.on('error', reject)
        })
        .on('error', reject)
    }
    follow(url)
  })
}

async function ensureDownloaded(url, dest) {
  if (existsSync(dest)) {
    log(`cache hit: ${dest}`)
    return dest
  }
  log(`downloading ${url}`)
  await download(url, dest)
  return dest
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toLowerCase()
}

async function prepareRuntime() {
  // ── 1. rebuild clean staging/runtime ──────────────────────────────────────
  for (const dir of [stagingDir, runtimeDir]) {
    assertInsideDesktop(dir)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }

  // ── 2/3. fetch and verify portable Node ───────────────────────────────────
  mkdirSync(cacheDir, { recursive: true })
  const zipPath = join(cacheDir, ZIP_NAME)
  const shasumPath = join(cacheDir, 'SHASUMS256.txt')
  await ensureDownloaded(ZIP_URL, zipPath)
  await ensureDownloaded(SHASUM_URL, shasumPath)

  const shasums = readFileSync(shasumPath, 'utf8')
  const expectedLine = shasums.split(/\r?\n/).find((l) => l.includes(`  ${ZIP_NAME}`))
  if (!expectedLine) throw new Error(`No SHA-256 entry for ${ZIP_NAME} in SHASUMS256.txt`)
  const expected = expectedLine.split(/\s+/)[0].toLowerCase()
  const actual = sha256Of(zipPath)
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${ZIP_NAME}\n  expected ${expected}\n  actual   ${actual}`)
  }
  log(`verified SHA-256 ${actual}`)

  // ── 4. extract to runtime/node ────────────────────────────────────────────
  const extractTmp = join(runtimeDir, '_extract')
  mkdirSync(extractTmp, { recursive: true })
  run('tar', ['-xf', zipPath, '-C', extractTmp])
  const inner = join(extractTmp, `node-${NODE_VERSION}-win-x64`)
  if (!existsSync(join(inner, 'node.exe'))) throw new Error('node.exe missing after extraction')
  const nodeDir = join(runtimeDir, 'node')
  mkdirSync(nodeDir, { recursive: true })
  for (const entry of readdirSync(inner)) {
    renameSync(join(inner, entry), join(nodeDir, entry))
  }
  rmSync(extractTmp, { recursive: true, force: true })
  log(`portable Node extracted to ${nodeDir}`)

  // ── 5. stage client + server ──────────────────────────────────────────────
  const clientDist = join(devRoot, 'web', 'client', 'dist')
  if (!existsSync(clientDist)) throw new Error('web/client/dist missing — run npm run build:client first')
  cpSync(clientDist, join(stagingDir, 'client'), { recursive: true })

  // ── 5.1 stage builtin content (content/builtin → resources/content/builtin) ──
  const builtinContent = join(devRoot, 'content', 'builtin')
  if (!existsSync(join(builtinContent, 'manifest.json'))) {
    throw new Error('content/builtin/manifest.json missing — run the builtin content build/validation first')
  }
  cpSync(builtinContent, join(stagingDir, 'content', 'builtin'), { recursive: true })
  log('staged content/builtin -> staging/content/builtin')

  const serverDir = join(devRoot, 'web', 'server')
  const serverDist = join(serverDir, 'dist')
  if (!existsSync(serverDist)) throw new Error('web/server/dist missing — run npm run build:server first')
  const stagingServer = join(stagingDir, 'server')
  cpSync(serverDist, join(stagingServer, 'dist'), { recursive: true })
  cpSync(join(serverDir, 'package.json'), join(stagingServer, 'package.json'))
  cpSync(join(serverDir, 'package-lock.json'), join(stagingServer, 'package-lock.json'))

  // ── 6. production install in staging (never copy dev node_modules) ────────
  log('npm ci --omit=dev in staging/server')
  // spawnSync cannot run .cmd directly on Windows; wrap through cmd.exe.
  if (process.platform === 'win32') {
    run(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'npm ci --omit=dev --no-audit --no-fund'],
      { cwd: stagingServer },
    )
  } else {
    run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stagingServer })
  }

  // ── 7. smoke test with the bundled Node ───────────────────────────────────
  const nodeExe = join(nodeDir, 'node.exe')
  run(process.execPath, [
    'scripts/smoke-packaged.mjs',
    nodeExe,
    stagingServer,
    join(stagingDir, 'client'),
    join(stagingDir, 'content', 'builtin'),
  ], {
    cwd: devRoot,
  })

  log('staging ready:')
  log('  runtime/node -> resources/runtime/node')
  log('  staging/server -> resources/server')
  log('  staging/client -> resources/client')
}

prepareRuntime().catch((err) => {
  console.error('[prepare-desktop-runtime] FAILED:', err.message)
  process.exit(1)
})
