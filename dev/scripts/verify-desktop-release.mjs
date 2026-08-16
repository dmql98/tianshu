/**
 * verify-desktop-release.mjs — 发布资产清单与哈希校验（迁移指南 §10.5/§12.1/§13）。
 *
 * 用法：
 *   构建 job（在 dev/desktop/release 下）：
 *     node ../../../scripts/verify-desktop-release.mjs --platform win32
 *     node ../../../scripts/verify-desktop-release.mjs --platform mac
 *     node ../../../scripts/verify-desktop-release.mjs --platform linux
 *   汇总目录（assemble 输出）：
 *     node scripts/verify-desktop-release.mjs --dir <releaseDir>
 *   发布后远端校验：
 *     node scripts/verify-desktop-release.mjs --remote <tag> [--repo owner/name]
 *
 * 校验规则：
 *   - 版本号全部一致（desktop/package.json）；
 *   - 必需资产存在（§13 清单，Windows 三件套 / macOS dmg+zip+metadata / Linux AppImage）；
 *   - latest*.yml 的 url 与文件名一致、size/sha512 与磁盘文件一致；
 *   - 不手写/猜测元数据哈希，全部从 electron-builder 生成的文件读取后复算。
 */
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import YAML from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const devRoot = resolve(__dirname, '..')

function fail(msg) {
  console.error(`[verify] FAIL: ${msg}`)
  process.exit(1)
}

function log(msg) {
  console.log(`[verify] ${msg}`)
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function desktopVersion() {
  return JSON.parse(readFileSync(join(devRoot, 'desktop', 'package.json'), 'utf8')).version
}

/** 校验 latest.yml 的 url/size/sha512 与磁盘文件一致。 */
function verifyMetadataFile(dir, metaFile, label) {
  if (!existsSync(metaFile)) fail(`missing updater metadata: ${metaFile}`)
  let parsed
  try {
    parsed = YAML.load(readFileSync(metaFile, 'utf8'))
  } catch (err) {
    fail(`invalid YAML in ${metaFile}: ${err.message}`)
  }
  const version = desktopVersion()
  if (parsed.version !== version) {
    fail(`${label}: metadata version ${parsed.version} !== ${version}`)
  }
  for (const entry of parsed.files || []) {
    if (typeof entry.url !== 'string' || entry.url.includes('://') || entry.url.startsWith('/')) {
      fail(`${label}: suspicious url in metadata: ${entry.url}`)
    }
    const file = join(dir, entry.url)
    if (!existsSync(file)) fail(`${label}: metadata url not on disk: ${entry.url}`)
    if (typeof entry.size === 'number' && entry.size !== statSync(file).size) {
      fail(`${label}: size mismatch for ${entry.url}`)
    }
    if (typeof entry.sha512 === 'string' && entry.sha512 !== sha512Base64(file)) {
      fail(`${label}: sha512 mismatch for ${entry.url}`)
    }
  }
  log(`${label} metadata OK (${(parsed.files || []).length} entries)`)
}

function verifyPlatform(cwd, platform) {
  const version = desktopVersion()
  const required = {
    win32: [
      `TianShu-Setup-${version}-x64.exe`,
      `TianShu-Setup-${version}-x64.exe.blockmap`,
      'latest.yml',
    ],
    'mac-x64': [
      `TianShu-${version}-mac-x64.dmg`,
      `TianShu-${version}-mac-x64.zip`,
      'latest-mac.yml',
    ],
    'mac-arm64': [
      `TianShu-${version}-mac-arm64.dmg`,
      `TianShu-${version}-mac-arm64.zip`,
      'latest-mac.yml',
    ],
    linux: [`TianShu-${version}-linux-x64.AppImage`, 'latest-linux.yml'],
  }[platform]
  if (!required) fail(`unknown platform: ${platform}`)
  for (const name of required) {
    if (!existsSync(join(cwd, name))) fail(`missing required artifact: ${name}`)
    log(`present: ${name}`)
  }
  if (platform === 'win32') verifyMetadataFile(cwd, join(cwd, 'latest.yml'), 'win')
  if (platform === 'mac-x64' || platform === 'mac-arm64') {
    verifyMetadataFile(cwd, join(cwd, 'latest-mac.yml'), platform)
  }
  if (platform === 'linux') verifyMetadataFile(cwd, join(cwd, 'latest-linux.yml'), 'linux')
  log(`platform ${platform} artifacts OK`)
}

function verifyDir(dir) {
  const manifestFile = join(dir, 'manifest.json')
  if (!existsSync(manifestFile)) fail(`manifest.json missing in ${dir}`)
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  for (const entry of manifest.files) {
    const file = join(dir, entry.name)
    if (!existsSync(file)) fail(`manifest entry missing on disk: ${entry.name}`)
    if (entry.size !== statSync(file).size) fail(`size mismatch for ${entry.name}`)
    if (entry.sha512 !== sha512Base64(file)) fail(`sha512 mismatch for ${entry.name}`)
  }
  // §13 必需资产（含可选 deb 不强制）
  const version = desktopVersion()
  const required = [
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
    `TianShu-Setup-${version}-x64.exe`,
    `TianShu-Setup-${version}-x64.exe.blockmap`,
    `TianShu-${version}-mac-x64.dmg`,
    `TianShu-${version}-mac-x64.zip`,
    `TianShu-${version}-mac-arm64.dmg`,
    `TianShu-${version}-mac-arm64.zip`,
    `TianShu-${version}-linux-x64.AppImage`,
  ]
  for (const name of required) {
    if (!existsSync(join(dir, name))) fail(`missing required release asset: ${name}`)
  }
  // macOS 合并后的 latest-mac.yml 必须同时包含 x64 和 arm64 zip（§10.6）
  const macMeta = YAML.load(readFileSync(join(dir, 'latest-mac.yml'), 'utf8'))
  const urls = (macMeta.files || []).map((f) => f.url)
  if (!urls.some((u) => u.includes('-mac-x64.zip'))) fail('latest-mac.yml missing mac-x64 zip')
  if (!urls.some((u) => u.includes('-mac-arm64.zip'))) fail('latest-mac.yml missing mac-arm64 zip')
  verifyMetadataFile(dir, join(dir, 'latest.yml'), 'win')
  verifyMetadataFile(dir, join(dir, 'latest-mac.yml'), 'mac(merged)')
  verifyMetadataFile(dir, join(dir, 'latest-linux.yml'), 'linux')
  log(`release dir ${dir} OK (${manifest.files.length} files)`)
}

async function verifyRemote(tag, repo) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
  const res = await fetch(url, { headers: { 'User-Agent': 'tianshu-verify', Accept: 'application/vnd.github+json' } })
  if (!res.ok) fail(`release ${tag} not found (HTTP ${res.status})`)
  const release = await res.json()
  const names = new Set((release.assets || []).map((a) => a.name))
  const version = tag.replace(/^v/, '')
  const required = [
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
    `TianShu-Setup-${version}-x64.exe`,
    `TianShu-Setup-${version}-x64.exe.blockmap`,
    `TianShu-${version}-mac-x64.dmg`,
    `TianShu-${version}-mac-x64.zip`,
    `TianShu-${version}-mac-arm64.dmg`,
    `TianShu-${version}-mac-arm64.zip`,
    `TianShu-${version}-linux-x64.AppImage`,
  ]
  const missing = required.filter((n) => !names.has(n))
  if (missing.length > 0) fail(`missing published assets: ${missing.join(', ')}`)
  log(`remote release ${tag} OK (${release.assets.length} assets)`)
}

async function main() {
  const argv = process.argv.slice(2)
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform') args.platform = argv[++i]
    else if (argv[i] === '--dir') args.dir = argv[++i]
    else if (argv[i] === '--remote') args.remote = argv[++i]
    else if (argv[i] === '--repo') args.repo = argv[++i]
    else fail(`Unknown argument: ${argv[i]}`)
  }
  if (args.platform) verifyPlatform(process.cwd(), args.platform)
  else if (args.dir) verifyDir(resolve(args.dir))
  else if (args.remote) await verifyRemote(args.remote, args.repo || 'dmql98/tianshu')
  else fail('usage: verify-desktop-release.mjs --platform win32|mac-x64|mac-arm64|linux | --dir <dir> | --remote <tag>')
}

main().catch((err) => {
  console.error('[verify] FAIL:', err.message)
  process.exit(1)
})
