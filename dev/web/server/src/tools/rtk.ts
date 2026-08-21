import { execSync, spawnSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { getRtkConfig } from '../config.js'

/**
 * RTK（Rust Token Killer）集成辅助。
 *
 * rtk 是一个命令行代理：把 `git status` 变成 `rtk git status`，在输出回给
 * LLM 前压缩/过滤，节省 60–90% token。本项目在 bash/pwsh 工具执行命令前，
 * 若 RTK 已启用且 rtk 二进制可用，就给命令加 `rtk ` 前缀（rtk 对未识别命令
 * 有 passthrough，不会把命令跑挂）。
 *
 * 另提供一键安装 / 更新能力：按平台执行官方安装方式，并探测 GitHub 最新版本
 * 以判断是否需要更新。
 */

// ── 可用性 / 二进制解析 ──

let availabilityCache: { ok: boolean; at: number } | null = null
const AVAIL_TTL_MS = 30_000

/** 已知安装目录兜底（PATH 找不到时使用），覆盖 brew/cargo/官方脚本/Windows 常见位置。 */
function rtkBinCandidates(): string[] {
  const home = homedir()
  const candidates = [
    join(home, '.local', 'bin', 'rtk'),
    join(home, '.cargo', 'bin', 'rtk'),
  ]
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) candidates.push(join(local, 'rtk', 'rtk.exe'))
    candidates.push(join(home, '.local', 'bin', 'rtk.exe'))
  }
  return candidates
}

/** 解析 rtk 二进制绝对路径：先看 PATH，再看已知安装目录；都找不到返回 null。 */
export function resolveRtkBinary(): string | null {
  try {
    const probe = process.platform === 'win32' ? 'where rtk' : 'command -v rtk'
    const out = execSync(probe, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
      .toString()
      .trim()
    if (out) return out.split(/\r?\n/)[0].trim()
  } catch { /* not on PATH */ }
  for (const c of rtkBinCandidates()) {
    if (existsSync(c)) return c
  }
  return null
}

/** rtk 是否可用（结果缓存 30s，避免每条命令都探测）。 */
export function isRtkAvailable(): boolean {
  const now = Date.now()
  if (availabilityCache && now - availabilityCache.at < AVAIL_TTL_MS) {
    return availabilityCache.ok
  }
  const ok = resolveRtkBinary() !== null
  availabilityCache = { ok, at: now }
  return ok
}

/** 安装/更新后使缓存失效，便于立即反映新状态。 */
export function invalidateRtkAvailability(): void {
  availabilityCache = null
}

/** rtk 版本号；不可用时返回空串。 */
export function getRtkVersion(): string {
  const bin = resolveRtkBinary()
  if (!bin) return ''
  try {
    return execSync(`"${bin}" --version`, { encoding: 'utf8', timeout: 2000 }).trim()
  } catch {
    return ''
  }
}

// ── 命令包装 ──

/**
 * 以 shell 控制符或参数开头的命令不加前缀，避免与 rtk 的全局参数
 *（-v/-u）冲突或破坏 shell 语法（如 `|`、`&&`、`<` 开头）。
 */
const UNSAFE_LEAD = /^\s*([|&;()<>`]|--?[A-Za-z])/

/**
 * 若 RTK 已启用且 rtk 可用且命令语法安全，返回加 rtk 绝对路径前缀的命令；
 * 否则原样返回。调用方无需关心启用/可用状态。
 */
export function maybeRtkWrap(cmd: string): string {
  if (!getRtkConfig().enabled) return cmd
  if (UNSAFE_LEAD.test(cmd)) return cmd
  const bin = resolveRtkBinary()
  if (!bin) return cmd
  return `"${bin}" ${cmd}`
}

// ── 最新版本探测 ──

let latestCache: { version: string; at: number } | null = null
const LATEST_TTL_MS = 60 * 60 * 1000

/** 从 GitHub Releases 取最新版本号（如 v0.45.0），缓存 1h 避免触发 API 限流。 */
export async function getRtkLatestVersion(force = false): Promise<string> {
  const now = Date.now()
  if (!force && latestCache && now - latestCache.at < LATEST_TTL_MS) {
    return latestCache.version
  }
  let version = ''
  try {
    const res = await fetch('https://api.github.com/repos/rtk-ai/rtk/releases/latest', {
      headers: { 'User-Agent': 'tianshu' },
    })
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string }
      version = data.tag_name ?? ''
    }
  } catch {
    version = ''
  }
  latestCache = { version, at: now }
  return version
}

/** 去掉前缀（v / rtk / 空白），按数字段比较。a>b 返回 1，a<b 返回 -1，相等返回 0。 */
export function compareRtkVersion(a: string, b: string): number {
  const norm = (v: string): number[] =>
    v.replace(/^[^0-9]*/, '').replace(/[^0-9.].*$/, '').split('.').map(n => parseInt(n, 10) || 0)
  const pa = norm(a)
  const pb = norm(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** 当前已安装版本是否落后于最新版。 */
export async function isRtkUpdateAvailable(): Promise<boolean> {
  const cur = getRtkVersion()
  if (!cur) return false
  const latest = await getRtkLatestVersion()
  if (!latest) return false
  return compareRtkVersion(latest, cur) > 0
}

// ── 安装 / 更新 ──

const UNIX_INSTALL_SH = `if command -v brew >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
  brew install rtk
else
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
fi`

const WINDOWS_INSTALL_PS1 = `$ErrorActionPreference = 'Stop'
$repo = 'rtk-ai/rtk'
$api = "https://api.github.com/repos/$repo/releases/latest"
$tag = (Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'tianshu' }).tag_name
if (-not $tag) { throw 'Failed to resolve latest rtk version from GitHub' }
$dir = Join-Path $env:LOCALAPPDATA 'rtk'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$url = "https://github.com/$repo/releases/download/$tag/rtk-x86_64-pc-windows-msvc.zip"
$zip = Join-Path $env:TEMP ('rtk-install-' + [guid]::NewGuid().ToString('N') + '.zip')
Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{ 'User-Agent' = 'tianshu' }
Expand-Archive -Path $zip -DestinationPath $dir -Force
$exe = Join-Path $dir 'rtk.exe'
if (-not (Test-Path $exe)) { throw 'rtk.exe not found after extraction' }
$cur = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($cur -and $cur -notlike ('*' + $dir + '*')) {
  [Environment]::SetEnvironmentVariable('Path', ($cur + ';' + $dir), 'User')
}
Write-Output ("rtk installed to " + $exe)`

function commandExists(name: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`
    execSync(probe, { stdio: 'ignore', timeout: 2000 })
    return true
  } catch {
    return false
  }
}

function runHostScript(script: string, win: boolean): { ok: boolean; output: string } {
  try {
    let r: ReturnType<typeof spawnSync>
    if (win) {
      const tmp = join(tmpdir(), `rtk-install-${Date.now()}.ps1`)
      writeFileSync(tmp, script, 'utf-8')
      r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], {
        timeout: 600_000,
        maxBuffer: 20 * 1024 * 1024,
      })
      try { unlinkSync(tmp) } catch { /* ignore */ }
    } else {
      r = spawnSync('sh', ['-c', script], { timeout: 600_000, maxBuffer: 20 * 1024 * 1024 })
    }
    const out = `${r.stdout?.toString() ?? ''}${r.stderr?.toString() ?? ''}`.trim()
    return { ok: r.status === 0, output: out || (r.status === 0 ? '(ok)' : 'no output') }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, output: msg }
  }
}

/** 一键安装 rtk：按平台执行官方安装方式（macOS 用 brew，其余下载官方预编译二进制）。 */
export function installRtk(): { ok: boolean; output: string } {
  const win = process.platform === 'win32'
  const result = runHostScript(win ? WINDOWS_INSTALL_PS1 : UNIX_INSTALL_SH, win)
  invalidateRtkAvailability()
  return result
}

/** 更新 rtk：macOS+brew 用 `brew upgrade`，其余重跑安装（拉取最新版）。 */
export function updateRtk(): { ok: boolean; output: string } {
  const win = process.platform === 'win32'
  let script: string
  if (win) script = WINDOWS_INSTALL_PS1
  else if (process.platform === 'darwin' && commandExists('brew')) script = 'brew upgrade rtk'
  else script = UNIX_INSTALL_SH
  const result = runHostScript(script, win)
  invalidateRtkAvailability()
  return result
}
