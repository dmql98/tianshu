/**
 * prepare-desktop-runtime.mjs — 平台化内置 Node 准备脚本（迁移指南 §8）。
 *
 * 命令契约（§8.1）：
 *   node scripts/prepare-desktop-runtime.mjs --platform win32 --arch x64
 *   node scripts/prepare-desktop-runtime.mjs --platform darwin --arch arm64
 *   node scripts/prepare-desktop-runtime.mjs --platform darwin --arch x64
 *   node scripts/prepare-desktop-runtime.mjs --platform linux --arch x64
 *
 * 省略参数时本地开发默认 process.platform / process.arch；CI 必须显式传入。
 * 拒绝不在支持矩阵中的平台/架构组合（§2.1：win32-x64 / darwin-x64 /
 * darwin-arm64 / linux-x64），不支持 Windows ia32。
 *
 * 流程：
 *   1. 清理并重建 desktop/staging 与 desktop/runtime（仅限 dev/desktop 内）。
 *   2. 从 dev/.node-version 读取唯一版本源（§6.1）。
 *   3. 按平台/架构映射下载 Node 归档，校验官方 SHASUMS256.txt 的 SHA-256；
 *      缓存命中也要重算（§8.3）；校验失败删除该缓存文件重下一次，再失败终止。
 *   4. 解压到 runtime/node（win32 → node.exe，POSIX → bin/node）。
 *   5. 生成 runtime/runtime-manifest.json（§8.4）。
 *   6. 复制 client/content/server 到 staging，staging/server 内 npm ci --omit=dev。
 *   7. 用将要打进安装包的内置 Node 运行 packaged smoke（§7.6/§12.2）。
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
  writeFileSync,
} from 'fs'
import https from 'https'
import { tmpdir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const devRoot = resolve(__dirname, '..')
const desktopDir = join(devRoot, 'desktop')

// ── 支持矩阵（§2.1）─────────────────────────────────────────────
const SUPPORTED_TARGETS = new Set(['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64'])

// ── Node 归档映射（§8.2）─────────────────────────────────────────
// archive: 归档文件名模板；root: 归档内根目录；exe: 可执行文件相对路径。
const NODE_ARCHIVE_MAP = {
  win32: {
    x64: {
      archive: (v) => `node-${v}-win-x64.zip`,
      root: (v) => `node-${v}-win-x64`,
      exe: 'node.exe',
    },
  },
  darwin: {
    x64: {
      archive: (v) => `node-${v}-darwin-x64.tar.gz`,
      root: (v) => `node-${v}-darwin-x64`,
      exe: 'bin/node',
    },
    arm64: {
      archive: (v) => `node-${v}-darwin-arm64.tar.gz`,
      root: (v) => `node-${v}-darwin-arm64`,
      exe: 'bin/node',
    },
  },
  linux: {
    x64: {
      archive: (v) => `node-${v}-linux-x64.tar.xz`,
      root: (v) => `node-${v}-linux-x64`,
      exe: 'bin/node',
    },
  },
}

const stagingDir = join(desktopDir, 'staging')
const runtimeDir = join(desktopDir, 'runtime')

/** Windows 上优先用系统 bsdtar（System32\tar.exe），避免 Git Bash 的 GNU tar
 *  把 `C:\...` 路径误解析为远程主机。macOS/Linux 直接用 PATH 中的 tar。 */
function findTar() {
  if (process.platform !== 'win32') return 'tar'
  const systemTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(systemTar) ? systemTar : 'tar'
}

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

function parseArgs(argv) {
  const args = { platform: undefined, arch: undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform') args.platform = argv[++i]
    else if (argv[i] === '--arch') args.arch = argv[++i]
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  return args
}

/** 解析平台/架构：省略时默认本机（本地开发）；CI 必须显式传入（§8.1）。 */
function resolveTarget(args) {
  const platform = args.platform || process.platform
  const arch = args.arch || process.arch
  const key = `${platform}-${arch}`
  if (!SUPPORTED_TARGETS.has(key)) {
    throw new Error(
      `Unsupported target "${key}". Supported: ${[...SUPPORTED_TARGETS].join(', ')} ` +
      `(Windows ia32 / Linux ia32 / armv7l 不支持，§2.1)。CI 必须显式传入 --platform/--arch。`,
    )
  }
  return { platform, arch, key }
}

/** 缓存根目录优先级（§8.3）：TIANSHU_BUILD_CACHE > LOCALAPPDATA > XDG_CACHE_HOME > tmpdir。 */
function cacheRoot() {
  if (process.env.TIANSHU_BUILD_CACHE) return process.env.TIANSHU_BUILD_CACHE
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'tianshu-build-cache')
  }
  if (process.env.XDG_CACHE_HOME) return join(process.env.XDG_CACHE_HOME, 'tianshu-build-cache')
  return join(tmpdir(), 'tianshu-build-cache')
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

async function downloadOnce(url, dest) {
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

/** 下载归档并校验官方 SHA-256（§6.2/§8.3）：缓存命中也要重算；失败删缓存重下一次，再失败终止。 */
async function fetchVerifiedArchive(cacheDir, version, archiveName, baseUrl) {
  const archivePath = join(cacheDir, archiveName)
  const shasumPath = join(cacheDir, 'SHASUMS256.txt')
  await downloadOnce(`${baseUrl}/SHASUMS256.txt`, shasumPath)
  const shasums = readFileSync(shasumPath, 'utf8')
  const expectedLine = shasums.split(/\r?\n/).find((l) => l.includes(`  ${archiveName}`))
  if (!expectedLine) {
    throw new Error(`No SHA-256 entry for ${archiveName} in SHASUMS256.txt（不支持的目标不会出现在官方 SHASUM 中）`)
  }
  const expected = expectedLine.split(/\s+/)[0].toLowerCase()

  for (let attempt = 0; ; attempt++) {
    await downloadOnce(`${baseUrl}/${archiveName}`, archivePath)
    const actual = sha256Of(archivePath)
    if (actual === expected) {
      log(`verified SHA-256 ${actual} (${archiveName})`)
      return archivePath
    }
    // 校验失败：删除该单个缓存文件并重新下载一次；第二次仍失败则终止（§8.3）。
    if (attempt >= 1) {
      throw new Error(`SHA-256 mismatch for ${archiveName} after re-download\n  expected ${expected}\n  actual   ${actual}`)
    }
    log(`SHA-256 mismatch for ${archiveName}; deleting cached file and re-downloading`)
    rmSync(archivePath, { force: true })
  }
}

async function prepareRuntime() {
  const { platform, arch, key } = resolveTarget(parseArgs(process.argv.slice(2)))
  const versionRaw = readFileSync(join(devRoot, '.node-version'), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(versionRaw)) {
    throw new Error(`dev/.node-version 内容无效: "${versionRaw}"（应为 x.y.z）`)
  }
  const version = `v${versionRaw}`
  const mapping = NODE_ARCHIVE_MAP[platform][arch]
  const archiveName = mapping.archive(version)
  const baseUrl = `https://nodejs.org/dist/${version}`

  log(`target ${key}, node ${versionRaw}, archive ${archiveName}`)

  // ── 1. 重建 clean staging/runtime ─────────────────────────────
  for (const dir of [stagingDir, runtimeDir]) {
    assertInsideDesktop(dir)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }

  // ── 2/3. 下载并校验官方归档（缓存键含版本/平台/架构/文件名，§8.3）──
  const cacheDir = join(cacheRoot(), `${versionRaw}-${platform}-${arch}`)
  mkdirSync(cacheDir, { recursive: true })
  const archivePath = await fetchVerifiedArchive(cacheDir, version, archiveName, baseUrl)

  // ── 4. 解压到 runtime/node ────────────────────────────────────
  const extractTmp = join(runtimeDir, '_extract')
  mkdirSync(extractTmp, { recursive: true })
  run(findTar(), ['-xf', archivePath, '-C', extractTmp])
  const inner = join(extractTmp, mapping.root(version))
  const nodeExeRel = mapping.exe
  if (!existsSync(join(inner, nodeExeRel))) {
    throw new Error(`${nodeExeRel} missing after extraction (${archiveName})`)
  }
  const nodeDir = join(runtimeDir, 'node')
  mkdirSync(nodeDir, { recursive: true })
  for (const entry of readdirSync(inner)) {
    renameSync(join(inner, entry), join(nodeDir, entry))
  }
  rmSync(extractTmp, { recursive: true, force: true })
  log(`portable Node extracted to ${nodeDir} (${nodeExeRel})`)

  // ── 5. runtime manifest（§8.4）────────────────────────────────
  const manifest = {
    schemaVersion: 1,
    nodeVersion: versionRaw,
    platform,
    arch,
    archive: archiveName,
    sha256: sha256Of(archivePath),
  }
  writeFileSync(join(runtimeDir, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  log(`runtime-manifest.json written (${key})`)

  // ── 6. stage client + builtin content + server ────────────────
  const clientDist = join(devRoot, 'web', 'client', 'dist')
  if (!existsSync(clientDist)) throw new Error('web/client/dist missing — run npm run build:client first')
  cpSync(clientDist, join(stagingDir, 'client'), { recursive: true })

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

  // ── 7. production install in staging (never copy dev node_modules) ──
  log('npm ci --omit=dev in staging/server')
  if (process.platform === 'win32') {
    run(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'npm ci --omit=dev --no-audit --no-fund'],
      { cwd: stagingServer },
    )
  } else {
    run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stagingServer })
  }

  // ── 8. smoke test with the bundled Node ───────────────────────
  const nodeExe = join(nodeDir, nodeExeRel)
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
  log(`  runtime/node -> resources/runtime/node (${platform}/${arch})`)
  log('  runtime/runtime-manifest.json -> resources/runtime-manifest.json')
  log('  staging/server -> resources/server')
  log('  staging/client -> resources/client')
}

prepareRuntime().catch((err) => {
  console.error('[prepare-desktop-runtime] FAILED:', err.message)
  process.exit(1)
})
