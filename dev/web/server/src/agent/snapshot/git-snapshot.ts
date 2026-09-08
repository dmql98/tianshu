/**
 * git-snapshot.ts — 每项目全局 git 快照仓库（对齐 opencode snapshot/project.vcs）。
 *
 * 思路：每个 workspace 根对应一个独立快照仓库（`<dataDir>/.snapshots/<projectKey>`），
 * work-tree 指向真实工作区；run 开始 track() 记基线 commit，run 结束
 * diff(基线) 得到全工作区（含 bash 改动）的文件级 unified diff，写入 file_changes。
 *
 * 零 npm 依赖：全部走系统 git 命令行（spawnSync，`--git-dir` + `--work-tree`）。
 *
 * 命令形式：`git --git-dir=<快照仓库>/.git --work-tree=<workspace根> <cmd>`，
 *   cwd = workspace 根；windowsHide = true（桌面端无控制台窗口）。
 *
 * workTree 持久化在快照仓库自身的 config（`tianshu.worktree`），因此
 * track/diff/restore 只需 projectKey，跨会话/跨重启都能从仓库恢复工作区根。
 */
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync, rmSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { createHash } from 'crypto'
import { getDataDir, envInt } from '../../config.js'

/** patch 单文件上限：超过只给行数不给 patch，防大文件撑爆内存/传输。 */
export const MAX_PATCH_BYTES = 512 * 1024

/** untracked 单文件超过该字节数不进快照（对齐 opencode large 集合过滤）。 */
export const MAX_UNTRACKED_BYTES = 1 * 1024 * 1024

/** 首次 add -A 大目录可放宽到 120s，后续命令默认 30s（均可用环境变量覆盖）。 */
export const SNAPSHOT_INIT_TIMEOUT_MS = envInt('TIANSHU_SNAPSHOT_INIT_TIMEOUT_MS', 120_000)
export const SNAPSHOT_TIMEOUT_MS = envInt('TIANSHU_SNAPSHOT_TIMEOUT_MS', 30_000)

/** 快照仓库黑名单（core.excludesfile 兜底；工作区自带 .gitignore 自然生效）。 */
export const SNAPSHOT_EXCLUDES = [
  'node_modules/',
  'dist/',
  'build/',
  '*.tsbuildinfo',
  '*.db',
  '*.db-shm',
  '*.db-wal',
  '*.sqlite',
  '*.sqlite3',
  '.git/',
  '.codegraph/',
  '.snapshots/',
  '.cache/',
  '.venv/',
  '__pycache__/',
  '*.pyc',
  '.env',
  '.env.*',
]

export interface SnapshotFileDiff {
  /** 相对 workspace 根的路径（/ 分隔）。 */
  file: string
  /** unified diff 文本；超过 MAX_PATCH_BYTES 时为空字符串（只给行数）。 */
  patch: string
  additions: number
  deletions: number
  status: 'added' | 'deleted' | 'modified'
}

interface RepoLayout {
  projectKey: string
  workTree: string
  snapshotDir: string
  gitDir: string
  excludesFile: string
}

/** projectKey：workspace 根 → sha256 前 16 位（跨会话共享的稳定 id）。 */
export function projectKeyFor(workTree: string): string {
  const normalized = workTree.replace(/[\\/]+$/g, '')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

/** 快照仓库根目录：<dataDir>/.snapshots/<projectKey>/。 */
export function snapshotDirFor(projectKey: string): string {
  return resolve(getDataDir(), '.snapshots', projectKey)
}

/** 列出所有快照仓库 projectKey（<dataDir>/.snapshots 下的直接子目录）。 */
export function listSnapshotProjects(): string[] {
  const root = resolve(getDataDir(), '.snapshots')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(n => /^[0-9a-f]{16}$/.test(n))
}

/**
 * 清理策略（P1.7，对齐 data-retention 模式）：删除「最近 retentionDays 内
 * 没有任何活跃」的快照仓库。活跃判定由调用方传入（file_changes MAX(created_at)
 * 或 sessions.updated_at 取更近者）。目录删除失败只记日志不抛错。
 */
export function sweepSnapshotRepos(isActive: (projectKey: string) => boolean, retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const key of listSnapshotProjects()) {
    const active = isActive(key)
    if (active) continue
    const dir = snapshotDirFor(key)
    try {
      // 有活跃 file_changes 或活跃 sessions 都算活跃；否则检查目录 mtime
      const st = statSync(dir)
      if (st.mtimeMs < cutoff) {
        rmSync(dir, { recursive: true, force: true })
        removed++
      }
    } catch {
      // 删除失败/目录消失 → 跳过
    }
  }
  return removed
}

/** 从快照仓库 config 读取持久化的 workTree；仓库不存在/未初始化时返回 undefined。 */
export function readWorkTree(projectKey: string): string | undefined {
  const snapshotDir = snapshotDirFor(projectKey)
  const gitDir = join(snapshotDir, '.git')
  if (!existsSync(gitDir)) return undefined
  const res = spawnSync(
    'git',
    ['--git-dir', gitDir, 'config', '--get', 'tianshu.worktree'],
    { windowsHide: true, encoding: 'utf-8', timeout: 5000 },
  )
  if (res.status !== 0) return undefined
  const out = (res.stdout || '').trim()
  return out || undefined
}

function layoutFromConfig(projectKey: string): RepoLayout | null {
  const workTree = readWorkTree(projectKey)
  if (!workTree) return null
  const snapshotDir = snapshotDirFor(projectKey)
  return {
    projectKey,
    workTree,
    snapshotDir,
    gitDir: join(snapshotDir, '.git'),
    excludesFile: join(snapshotDir, 'excludes'),
  }
}

/** 单次 git 调用：--git-dir + --work-tree，cwd=workTree，UTF-8 输出。 */
function git(args: string[], l: RepoLayout, timeoutMs = SNAPSHOT_TIMEOUT_MS): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('git', ['--git-dir', l.gitDir, '--work-tree', l.workTree, ...args], {
    cwd: l.workTree,
    windowsHide: true,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: MAX_PATCH_BYTES * 4,
  })
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error('git not found in PATH')
  }
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** 去掉 porcelain 输出的 C 风格引号包裹（路径含空格/特殊字符时 git 会加引号）。 */
function unquotePorcelainPath(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p) as string
    } catch {
      return p.slice(1, -1)
    }
  }
  return p
}

/**
 * 解析 `git diff --numstat` 输出：`adds\tdeletes\tpath`。
 * 二进制行（`-\t-`）按 0/0 处理。
 */
function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  for (const line of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!m) continue
    map.set(unquotePorcelainPath(m[3]), {
      additions: m[1] === '-' ? 0 : Number(m[1]),
      deletions: m[2] === '-' ? 0 : Number(m[2]),
    })
  }
  return map
}

/**
 * 把 `git diff` 的完整输出按 `diff --git ` 头切分为文件级块。
 * 返回 [{ file, patch }]；file 取 b 侧（删文件时 b 侧即被删路径）。
 */
function splitPatch(stdout: string): Array<{ file: string; patch: string }> {
  const blocks: Array<{ file: string; patch: string }> = []
  const lines = stdout.split('\n')
  let cur: { file: string; lines: string[] } | null = null
  const flush = () => {
    if (cur) {
      blocks.push({ file: cur.file, patch: cur.lines.join('\n') })
      cur = null
    }
  }
  for (const line of lines) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (m) {
      flush()
      cur = { file: unquotePorcelainPath(m[2]), lines: [line] }
      continue
    }
    if (cur) cur.lines.push(line)
  }
  flush()
  return blocks
}

/** 从 `git status --porcelain -uall` 抓 untracked（?? 行）的相对路径。 */
function untrackedPaths(stdout: string): string[] {
  const out: string[] = []
  for (const line of stdout.split('\n')) {
    const m = /^\?\? (.+)$/.exec(line)
    if (m) out.push(unquotePorcelainPath(m[1]))
  }
  return out
}

/** 行数统计（Unicode 安全，\n 切分；末尾换行不计空行）。 */
export function countLines(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

/** 为 untracked 新增文件生成 unified diff（--no-index 语义的 + 块）。 */
export function createAddedPatch(relPath: string, text: string): string {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const count = lines.length
  const body = count > 0 ? lines.map(l => `+${l}`).join('\n') : ''
  const hunk = count > 0
    ? `@@ -0,0 +1,${count} @@\n${body}\n`
    : `@@ -0,0 +0,0 @@\n`
  return `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${relPath}\n${hunk}`
}

/** 判断 diff 块是否为删除：patch 含 `+++ /dev/null` 头（b 侧为空）。 */
export function looksDeleted(patch: string): boolean {
  return /^\+\+\+ \/dev\/null$/m.test(patch)
}

/** 判断 diff 块是否为新增：patch 含 `--- /dev/null` 头（a 侧为空）。 */
export function looksAdded(patch: string): boolean {
  return /^--- \/dev\/null$/m.test(patch)
}

/** git 可用性探测（首次调用后缓存，服务进程生命周期内有效）。 */
let gitAvailableCache: boolean | null = null
export function gitAvailable(): boolean {
  if (gitAvailableCache !== null) return gitAvailableCache
  try {
    const res = spawnSync('git', ['--version'], { windowsHide: true, encoding: 'utf-8', timeout: 5000 })
    gitAvailableCache = res.status === 0 && /^git version /.test(res.stdout || '')
  } catch {
    gitAvailableCache = false
  }
  return gitAvailableCache
}

/** 测试辅助：重置可用性缓存（vitest 模拟 git 缺失时用）。 */
export function _resetGitAvailableCache(): void {
  gitAvailableCache = null
}

export const gitSnapshot = {
  /**
   * 探测 git 可用性（结果缓存，服务进程生命周期内只探一次）。
   */
  available(): boolean {
    return gitAvailable()
  },

  /**
   * 快照仓库就绪。不存在则 init + 写黑名单 excludes + 配 core.autocrlf/
   * quotepath=false + 持久化 workTree。幂等：已就绪直接返回。
   */
  async ensure(projectKey: string, workTree: string): Promise<void> {
    if (existsSync(join(snapshotDirFor(projectKey), '.git'))) return
    if (!gitAvailable()) throw new Error('git not available')
    if (!existsSync(workTree)) throw new Error(`workTree not found: ${workTree}`)

    const snapshotDir = snapshotDirFor(projectKey)
    mkdirSync(snapshotDir, { recursive: true })
    const l: RepoLayout = {
      projectKey,
      workTree,
      snapshotDir,
      gitDir: join(snapshotDir, '.git'),
      excludesFile: join(snapshotDir, 'excludes'),
    }
    // 普通仓库 init：gitDir = snapshotDir/.git，work-tree 外部指向真实工作区。
    git(['init', snapshotDir], l, SNAPSHOT_INIT_TIMEOUT_MS)
    git(['config', 'core.autocrlf', 'false'], l)
    git(['config', 'core.quotepath', 'false'], l)
    git(['config', 'user.name', 'tianshu'], l)
    git(['config', 'user.email', 'tianshu@local'], l)
    git(['config', 'tianshu.worktree', workTree], l)
    writeFileSync(l.excludesFile, SNAPSHOT_EXCLUDES.join('\n') + '\n', 'utf-8')
    git(['config', 'core.excludesfile', l.excludesFile], l)
  },

  /**
   * 记基线：git add -A + commit。无任何改动（含 untracked 全被过滤）时返回
   * undefined（不产生空 commit）。返回基线 commit hash。
   */
  async track(projectKey: string): Promise<string | undefined> {
    const l = layoutFromConfig(projectKey)
    if (!l) throw new Error(`snapshot repo not ensured for ${projectKey}`)

    // untracked 大文件保护：先扫 untracked，>MAX_UNTRACKED_BYTES 的文件写入
    // 快照仓库本地的 .git/info/exclude（只在快照仓库内生效，不影响工作区）。
    this._excludeLargeUntracked(l)

    git(['add', '-A'], l, SNAPSHOT_INIT_TIMEOUT_MS)
    const status = git(['status', '--porcelain'], l)
    if (status.code !== 0 || status.stdout.trim() === '') return undefined

    const commit = git(['commit', '-m', 'snapshot'], l, SNAPSHOT_INIT_TIMEOUT_MS)
    if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`)
    const rev = git(['rev-parse', 'HEAD'], l)
    const hash = rev.stdout.trim()
    return hash || undefined
  },

  /**
   * diff 基线 commit → 当前工作区（run 结束校准路径）：
   * - git diff <base>（unified patch）+ git diff <base> --numstat（tracked 行数）
   * - git status --porcelain -uall 抓 untracked（新增文件，手工补 patch）
   */
  async diff(projectKey: string, base: string): Promise<SnapshotFileDiff[]> {
    const l = layoutFromConfig(projectKey)
    if (!l) return []
    return this._diffFor(l, base)
  },

  /**
   * diff 最新 commit → 当前工作区（项目全局视图：所有未提交改动）。
   */
  async diffWorking(projectKey: string): Promise<SnapshotFileDiff[]> {
    const l = layoutFromConfig(projectKey)
    if (!l) return []
    const head = git(['rev-parse', 'HEAD'], l)
    if (head.code !== 0 || !head.stdout.trim()) return []
    return this._diffFor(l, head.stdout.trim())
  },

  /**
   * 回滚：git read-tree <base> + checkout-index 还原工作区（对齐 opencode
   * restore；危险操作，仅在用户显式请求时调用）。
   */
  async restore(projectKey: string, base: string): Promise<void> {
    const l = layoutFromConfig(projectKey)
    if (!l) throw new Error(`snapshot repo not ensured for ${projectKey}`)
    git(['read-tree', base], l, SNAPSHOT_INIT_TIMEOUT_MS)
    git(['checkout-index', '-a', '-f'], l, SNAPSHOT_INIT_TIMEOUT_MS)
  },

  /**
   * 单文件 unified diff：优先用给定基线 diff；无基线（该项目从未 track 过）
   * 时回退 diffWorking 单文件（相对 HEAD）。返回 patch 文本；超上限置空。
   * 用于 REST `/:path/diff` 接口。
   */
  async diffFile(projectKey: string, base: string | undefined, file: string): Promise<string> {
    const l = layoutFromConfig(projectKey)
    if (!l) return ''
    let patchRes: { code: number; stdout: string; stderr: string }
    if (base) {
      patchRes = git(['diff', base, '--no-ext-diff', '--', file], l)
    } else {
      const head = git(['rev-parse', 'HEAD'], l)
      if (head.code !== 0 || !head.stdout.trim()) return ''
      patchRes = git(['diff', head.stdout.trim(), '--no-ext-diff', '--', file], l)
    }
    if (patchRes.code !== 0) return ''
    if (Buffer.byteLength(patchRes.stdout, 'utf-8') >= MAX_PATCH_BYTES) return ''
    return patchRes.stdout
  },

  /** 内部：给定仓库布局，diff 基线 commit → 当前工作区。 */
  async _diffFor(l: RepoLayout, base: string): Promise<SnapshotFileDiff[]> {
    if (!existsSync(l.gitDir)) return []
    const out: SnapshotFileDiff[] = []

    const patchRes = git(['diff', base, '--no-ext-diff'], l)
    if (patchRes.code !== 0) return []
    const statRes = git(['diff', base, '--numstat'], l)
    const trackedStat = parseNumstat(statRes.stdout)

    for (const block of splitPatch(patchRes.stdout)) {
      const st = trackedStat.get(block.file)
      if (!st) continue
      let status: SnapshotFileDiff['status'] = 'modified'
      if (looksDeleted(block.patch)) status = 'deleted'
      else if (looksAdded(block.patch)) status = 'added'
      out.push({
        file: block.file,
        patch: block.patch.length > MAX_PATCH_BYTES ? '' : block.patch,
        additions: st.additions,
        deletions: st.deletions,
        status,
      })
    }

    // untracked 新增文件（git diff 不覆盖）。
    const statusRes = git(['status', '--porcelain', '-uall'], l)
    for (const rel of untrackedPaths(statusRes.stdout)) {
      const fullPath = resolve(l.workTree, rel)
      let st: ReturnType<typeof statSync> | null = null
      try {
        st = statSync(fullPath)
      } catch {
        continue
      }
      if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) continue
      let patch = ''
      let additions = 0
      try {
        const text = readFileSync(fullPath, 'utf-8')
        additions = countLines(text)
        if (st.size <= MAX_PATCH_BYTES) patch = createAddedPatch(rel, text)
      } catch {
        additions = 0
      }
      out.push({ file: rel, patch, additions, deletions: 0, status: 'added' })
    }

    return out
  },

  _excludeLargeUntracked(l: RepoLayout): void {
    const status = git(['status', '--porcelain', '-uall'], l)
    if (status.code !== 0) return
    const big: string[] = []
    for (const rel of untrackedPaths(status.stdout)) {
      const fullPath = resolve(l.workTree, rel)
      try {
        if (statSync(fullPath).size > MAX_UNTRACKED_BYTES) big.push(rel)
      } catch { /* ignore */ }
    }
    if (big.length === 0) return
    const infoExclude = join(l.gitDir, 'info', 'exclude')
    try {
      mkdirSync(dirname(infoExclude), { recursive: true })
      const existing = existsSync(infoExclude) ? readFileSync(infoExclude, 'utf-8') : ''
      const lines = new Set(existing.split('\n').filter(Boolean))
      for (const b of big) lines.add(b)
      writeFileSync(infoExclude, [...lines].join('\n') + '\n', 'utf-8')
    } catch { /* best-effort */ }
  },
}