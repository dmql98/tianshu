/**
 * diff-utils.ts — 文件修改追踪的统一 schema 与行级 diff 工具。
 *
 * 用途：
 * 1. write/edit 工具在 metadata 里计算 additions/deletions（source='tool' 实时行）；
 * 2. git 缺失时的降级主路径（P1.6）：无快照层也能按 write/edit 行数展示；
 * 3. 统一 FileChange/FileDiff 类型，供 fileChangeStore 与前端共享。
 *
 * 行级 diff 用「公共前缀/后缀剥离 + 中间段计数」的简化算法：
 * 对追加/局部修改/全量重写等真实编辑场景足够准确，且 O(n) 线性（不做 LCS，
 * 避免大文件 O(n*m) 卡主线程）。
 */

/** 文件改动状态（对外统一口径，含 noop 供实时行使用）。 */
export type FileChangeStatus = 'created' | 'updated' | 'deleted' | 'noop'

/** 数据来源：tool = write/edit 实时行；snapshot = run 结束 git 全量校准行。 */
export type FileChangeSource = 'tool' | 'snapshot'

/** file_changes 聚合后的一行（侧边栏直接渲染的最小单元）。 */
export interface FileChange {
  path: string
  status: FileChangeStatus
  additions: number
  deletions: number
  /** 胜出行（最新一条）的来源：snapshot 表示已由 git 快照校准，tool 为实时行。 */
  source?: FileChangeSource
  updatedAt?: number
}

/** git 快照 diff 结果（git-snapshot.ts 的 SnapshotFileDiff 的对外映射）。 */
export interface FileDiff extends FileChange {
  patch: string
}

/** patch 单文件上限：超过只给行数不给 patch，防 1MB 文件撑爆内存/传输。 */
export const MAX_PATCH_BYTES = 512 * 1024

/** 行数统计（Unicode 安全，\n 切分；末尾换行不计空行）。 */
export function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

/**
 * 行级 diff：oldText → newText 的增删行数。
 * 算法：先剥公共前缀、再剥公共后缀，剩余中间段按「行集合差」近似——
 * new 中在 old 出现过的行不算新增，old 中在 new 出现过的行不算删除。
 * 相比纯前后缀剥离，对「中间插入/中间修改」更接近 git numstat 语义；
 * 仍是 O(n) 线性（不做 LCS，避免大文件 O(n*m) 卡主线程）。
 */
export function diffLines(oldText: string, newText: string): { additions: number; deletions: number } {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  // 剥末尾空串（结尾换行产生的空元素），避免污染公共前后缀比对。
  if (a.length > 0 && a[a.length - 1] === '') a.pop()
  if (b.length > 0 && b[b.length - 1] === '') b.pop()

  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++

  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++

  const oldMid = a.slice(prefix, a.length - suffix)
  const newMid = b.slice(prefix, b.length - suffix)

  const oldSet = new Set(oldMid)
  const newSet = new Set(newMid)
  let additions = 0
  for (const line of newMid) if (!oldSet.has(line)) additions++
  let deletions = 0
  for (const line of oldMid) if (!newSet.has(line)) deletions++
  return { additions, deletions }
}

/** patch 是否达到上限（按 UTF-8 字节计）；达到或超过时只给行数不给 patch。 */
export function isPatchTooLarge(patch: string): boolean {
  return Buffer.byteLength(patch, 'utf-8') >= MAX_PATCH_BYTES
}

/** 把 SnapshotFileDiff 映射为对外 FileDiff（status 统一到 created/updated/deleted）。 */
export function toFileDiff(file: string, status: 'added' | 'deleted' | 'modified', additions: number, deletions: number, patch: string): FileDiff {
  const outStatus: FileChangeStatus = status === 'added' ? 'created' : status === 'deleted' ? 'deleted' : 'updated'
  return {
    path: file,
    status: outStatus,
    additions,
    deletions,
    patch: isPatchTooLarge(patch) ? '' : patch,
  }
}