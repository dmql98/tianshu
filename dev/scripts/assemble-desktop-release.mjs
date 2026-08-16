/**
 * assemble-desktop-release.mjs — 汇总各平台构建产物并合并/校验 updater 元数据。
 *
 * 用法：node scripts/assemble-desktop-release.mjs <artifactsDir> [--out <dir>]
 *
 * artifactsDir 结构（GitHub Actions download-artifact@v4，path=<artifactsDir>）：
 *   <artifactsDir>/release-win32-x64/    Windows x64 构建产物
 *   <artifactsDir>/release-macos-x64/    macOS x64 构建产物
 *   <artifactsDir>/release-macos-arm64/  macOS arm64 构建产物
 *   <artifactsDir>/release-linux-x64/    Linux x64 构建产物
 *
 * 职责（迁移指南 §10.5/§10.6）：
 *   1. 把各平台产物收集到 out 目录，检测同名冲突。
 *   2. 用 YAML 解析库读取每个平台生成的 latest*.yml（不手写/猜测哈希）。
 *   3. 确定性校验：版本一致、资产名唯一、安装包存在、metadata URL 与文件名一致、
 *      size/sha512 与文件一致、macOS x64/arm64 ZIP 都出现在最终 latest-mac.yml、
 *      不存在指向临时路径或 Actions artifact URL 的条目。
 *   4. 合并两个架构的 latest-mac.yml（files 合并，按 url 确定性排序；
 *      顶层 path/sha512 兼容字段取 x64，releaseDate 取较新者）。
 *   5. 写出 out/ 目录与 manifest.json（供 publish job 使用）。
 *
 * 失败即退出非 0，publish job 不会运行（§14.1）。
 */
import { createHash } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import YAML from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const devRoot = resolve(__dirname, '..')

function fail(msg) {
  console.error(`[assemble] FAIL: ${msg}`)
  process.exit(1)
}

function log(msg) {
  console.log(`[assemble] ${msg}`)
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function parseArgs(argv) {
  let artifactsDir = null
  let outDir = join(devRoot, 'release-assets')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outDir = argv[++i]
    else if (!artifactsDir) artifactsDir = argv[i]
    else fail(`Unknown argument: ${argv[i]}`)
  }
  if (!artifactsDir) fail('usage: assemble-desktop-release.mjs <artifactsDir> [--out <dir>]')
  return { artifactsDir: resolve(artifactsDir), outDir: resolve(outDir) }
}

/** 递归收集目录内所有文件（相对路径）。 */
function collectFiles(root) {
  const results = []
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else results.push({ rel, abs: join(dir, entry.name) })
    }
  }
  walk(root, '')
  return results
}

/** 读取并校验单个平台 latest.yml 的基本字段。 */
function readMetadata(file) {
  if (!existsSync(file)) fail(`missing updater metadata: ${file}`)
  let parsed
  try {
    parsed = YAML.load(readFileSync(file, 'utf8'))
  } catch (err) {
    fail(`invalid YAML in ${file}: ${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object') fail(`metadata is not an object: ${file}`)
  if (typeof parsed.version !== 'string') fail(`metadata missing version: ${file}`)
  if (!Array.isArray(parsed.files)) fail(`metadata missing files list: ${file}`)
  return parsed
}

/** 校验元数据条目与磁盘文件一致（url 存在、size/sha512 匹配）。 */
function verifyFilesAgainstDisk(outDir, parsed, label) {
  for (const entry of parsed.files) {
    if (typeof entry.url !== 'string') fail(`${label}: entry missing url`)
    if (entry.url.includes('://') || entry.url.startsWith('/') || entry.url.includes('..')) {
      fail(`${label}: suspicious url in metadata: ${entry.url}`)
    }
    const file = join(outDir, entry.url)
    if (!existsSync(file)) fail(`${label}: metadata url not on disk: ${entry.url}`)
    const size = statSync(file).size
    if (typeof entry.size === 'number' && entry.size !== size) {
      fail(`${label}: size mismatch for ${entry.url} (metadata ${entry.size}, disk ${size})`)
    }
    if (typeof entry.sha512 === 'string') {
      const actual = sha512Base64(file)
      if (actual !== entry.sha512) {
        fail(`${label}: sha512 mismatch for ${entry.url}\n  metadata ${entry.sha512}\n  actual   ${actual}`)
      }
    }
  }
}

function main() {
  const { artifactsDir, outDir } = parseArgs(process.argv.slice(2))
  const platforms = ['release-win32-x64', 'release-macos-x64', 'release-macos-arm64', 'release-linux-x64']
  for (const name of platforms) {
    if (!existsSync(join(artifactsDir, name))) fail(`missing artifact group: ${name}`)
  }

  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // ── 1. 收集 + 复制（冲突检测）───────────────────────────────────
  const seen = new Map() // rel -> source group
  for (const group of platforms) {
    for (const { rel, abs } of collectFiles(join(artifactsDir, group))) {
      if (seen.has(rel)) {
        // 允许的冲突：latest-mac.yml（两个 macOS 架构都会生成）稍后合并处理。
        if (rel !== 'latest-mac.yml') {
          fail(`duplicate artifact name "${rel}" (${seen.get(rel)} and ${group})`)
        }
        continue
      }
      seen.set(rel, group)
      copyFileSync(abs, join(outDir, rel))
      log(`collected ${group}/${rel}`)
    }
  }

  // ── 2. 读取各平台元数据 ─────────────────────────────────────────
  const winMeta = readMetadata(join(outDir, 'latest.yml'))
  const macX64Meta = readMetadata(join(outDir, 'latest-mac.yml'))
  const linuxMeta = readMetadata(join(outDir, 'latest-linux.yml'))

  const desktopVersion = JSON.parse(readFileSync(join(devRoot, 'desktop', 'package.json'), 'utf8')).version
  for (const [label, meta] of [['win', winMeta], ['mac-x64', macX64Meta], ['linux', linuxMeta]]) {
    if (meta.version !== desktopVersion) {
      fail(`${label} metadata version ${meta.version} !== desktop version ${desktopVersion}`)
    }
    verifyFilesAgainstDisk(outDir, meta, label)
  }

  // ── 3. 合并 latest-mac.yml：需要 arm64 的 files ─────────────────
  // electron-builder 每个架构生成同名 latest-mac.yml；arm64 的副本在
  // release-macos-arm64 组内（上面收集时被跳过），这里单独读取并合并 files。
  const macArm64Meta = readMetadata(join(artifactsDir, 'release-macos-arm64', 'latest-mac.yml'))
  if (macArm64Meta.version !== desktopVersion) {
    fail(`mac-arm64 metadata version ${macArm64Meta.version} !== desktop version ${desktopVersion}`)
  }
  // arm64 文件也要落到 outDir 供上传；上面收集循环里 latest-mac.yml 被跳过，
  // 但 zip/dmg 已复制。这里校验 arm64 元数据的文件都在磁盘上。
  verifyFilesAgainstDisk(outDir, macArm64Meta, 'mac-arm64')

  const x64Zips = macX64Meta.files.filter((f) => f.url.endsWith('.zip') && f.url.includes('-mac-x64.'))
  const arm64Zips = macArm64Meta.files.filter((f) => f.url.endsWith('.zip') && f.url.includes('-mac-arm64.'))
  if (x64Zips.length === 0) fail('mac-x64 metadata has no mac-x64 zip entry')
  if (arm64Zips.length === 0) fail('mac-arm64 metadata has no mac-arm64 zip entry')

  const mergedFiles = [...arm64Zips, ...x64Zips].sort((a, b) => a.url.localeCompare(b.url))
  const pathEntry = x64Zips[0]
  const mergedMac = {
    version: desktopVersion,
    files: mergedFiles,
    path: pathEntry.url,
    sha512: pathEntry.sha512,
    releaseDate: [macX64Meta.releaseDate, macArm64Meta.releaseDate]
      .filter(Boolean)
      .sort()
      .pop() ?? new Date().toISOString(),
  }
  writeFileSync(join(outDir, 'latest-mac.yml'), YAML.dump(mergedMac, { lineWidth: 200 }), 'utf8')
  log(`merged latest-mac.yml with ${mergedFiles.length} files (x64 + arm64)`)

  // ── 4. 最终清单 ────────────────────────────────────────────────
  const required = [
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
    `TianShu-Setup-${desktopVersion}-x64.exe`,
    `TianShu-Setup-${desktopVersion}-x64.exe.blockmap`,
    `TianShu-${desktopVersion}-mac-x64.dmg`,
    `TianShu-${desktopVersion}-mac-x64.zip`,
    `TianShu-${desktopVersion}-mac-arm64.dmg`,
    `TianShu-${desktopVersion}-mac-arm64.zip`,
    `TianShu-${desktopVersion}-linux-x64.AppImage`,
  ]
  for (const name of required) {
    if (!existsSync(join(outDir, name))) fail(`missing required release asset: ${name}`)
  }

  const manifest = {
    version: desktopVersion,
    generatedAt: new Date().toISOString(),
    files: collectFiles(outDir).map(({ rel }) => {
      const file = join(outDir, rel)
      return { name: rel, size: statSync(file).size, sha512: sha512Base64(file) }
    }),
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  log(`release-assets ready (${manifest.files.length} files) at ${outDir}`)
  for (const f of manifest.files) log(`  ${f.name}`)
}

main()
