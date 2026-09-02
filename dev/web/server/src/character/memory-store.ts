import { createHash } from 'crypto'
import { resolve } from 'path'
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { characterContentStore, characterDir } from './store.js'
import { characterMetaStore, resolveMemoryMode, type MemoryMode } from '../db/characterStore.js'

/**
 * 角色私有记忆（A 档）：结构化为「逐条条目」存于 <dataDir>/characters/<id>/memory.md（v2）。
 *
 * memory.md v2 格式（可读、可整份注入、可按行解析）：
 * ```
 * # 记忆
 *
 * - [2026-08-31 15:04] fact | 用户喜欢用 TypeScript 写前端
 * - [2026-08-31 15:05] decision | 项目采用 pnpm 而不是 npm
 * - [2026-08-31 15:06] note | 用户对单元测试态度积极
 * - [2026-08-31 15:07] [archived] preference | 以前用过 Webpack，后来迁移了
 * ```
 *
 * - 模式：`character.memory.mode`（off / read_only / editable）。老角色无 mode 时
 *   按 enabled 兼容：enabled=false→off，其余→editable。
 * - 条目类型：fact / preference / decision / note；无类型的历史行解析为 note。
 * - 归档：`archived` 标记的条目不进入默认 read 视图（可被恢复）；Agent 没有永久删除能力，
 *   永久删除只能由用户在前端记忆浏览器手动操作（知识库同路径）。
 * - 上限：`charLimit` 字符上限；超限时按优先级释放：先归档条目，再按时间从旧到新，
 *   保留最近 `minEntries`（默认 5）条。`maxEntries`（可选）为条数上限。
 * - 条目 id 由内容确定性推导（sha1(content) 前 12 位）：memory.md 不含 id 列（保持可读），
 *   同一逻辑条目在跨会话重解析后 id 保持稳定，可供 memory_update / memory_archive 精确引用。
 */

export type { MemoryMode }
export type MemoryType = 'fact' | 'preference' | 'decision' | 'note'
export type MemorySource = 'user' | 'snapshot' | 'assistant'

/** 一条解析出的记忆条目。 */
export interface MemoryEntry {
  /** 确定性 id（sha1(ts|content) 前 12 位）。不在 memory.md 中持久化。 */
  id: string
  /** 本地时间戳 'YYYY-MM-DD HH:mm'。 */
  ts: string
  type: MemoryType
  content: string
  /** 归档标记：归档条目不进入默认 read 视图。 */
  archived?: boolean
}

const HEADER = '# 记忆'
export const MEMORY_TYPES: readonly MemoryType[] = ['fact', 'preference', 'decision', 'note']

export interface MemoryConfig {
  /** 模式（off/read_only/editable，含老角色兼容推导）。 */
  mode: MemoryMode
  charLimit: number
  maxEntries?: number
  minEntries: number
}

/** 取当前角色记忆配置（缺省 charLimit 2200，minEntries 5）。 */
export function memoryConfig(characterId: string): MemoryConfig {
  const m = characterMetaStore.getById(characterId)?.memory
  return {
    mode: resolveMemoryMode(m),
    charLimit: typeof m?.charLimit === 'number' && m.charLimit > 0 ? m.charLimit : 2200,
    maxEntries: typeof m?.maxEntries === 'number' && m.maxEntries > 0 ? m.maxEntries : undefined,
    minEntries: typeof m?.minEntries === 'number' && m.minEntries > 0 ? m.minEntries : 5,
  }
}

/** 条目 id：仅由规范化内容推导 → 时间戳刷新不影响 id；内容变更才产生新 id（跨会话稳定，memory.md 不落 id 列）。 */
function entryId(content: string): string {
  return createHash('sha1').update(content).digest('hex').slice(0, 12)
}

/** 规范化单行内容：压缩空白为单个空格并去首尾。 */
function normalizeContent(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** 本地时间戳 'YYYY-MM-DD HH:mm'。 */
export function nowTs(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

/**
 * 从 memory.md 原始文本解析条目（兼容 v1：`- [ts] 内容` → note；兼容 v2 的 type 与 [archived] 标记）。
 */
export function parseMemory(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\uFEFF/g, '').trimEnd()
    if (!line.startsWith('- [')) continue
    const m = /^- \[([^\]]*)\](.*)$/.exec(line)
    if (!m) continue
    const ts = m[1].trim()
    if (!ts) continue
    let body = m[2].trim()
    let archived = false
    if (body.startsWith('[archived]')) {
      archived = true
      body = body.slice('[archived]'.length).trim()
    }
    // v2: `type | content`；否则视为历史纯内容条目（note）。
    const typed = /^(fact|preference|decision|note)\s*\|\s*(.+)$/.exec(body)
    const type: MemoryType = typed ? (typed[1] as MemoryType) : 'note'
    const text = typed ? typed[2].trim() : body.trim()
    if (!text) continue
    entries.push({ id: entryId(text), ts, type, content: text, ...(archived ? { archived: true } : {}) })
  }
  return entries
}

/** 渲染条目为 memory.md v2 文本。 */
export function renderMemory(entries: MemoryEntry[]): string {
  if (entries.length === 0) return `${HEADER}\n`
  const lines = entries.map(e => {
    const flag = e.archived ? ' [archived]' : ''
    return `- [${e.ts}]${flag} ${e.type} | ${e.content}`
  })
  return `${HEADER}\n\n${lines.join('\n')}\n`
}

/** 读取当前角色全部条目（含归档；调用方按需过滤 archived）。 */
export function readMemory(characterId: string): MemoryEntry[] {
  const raw = characterContentStore.get(characterId).memory
  if (!raw) return []
  return parseMemory(raw)
}

/** 当前记忆文件的总字符数（含格式开销）。 */
export function memoryUsage(characterId: string): number {
  return renderMemory(readMemory(characterId)).length
}

export interface MemoryStats {
  mode: MemoryMode
  total: number
  active: number
  char_usage: number
  char_limit: number
}

/** 记忆概览（供 read 工具与前端参考）。 */
export function memoryStats(characterId: string): MemoryStats {
  const cfg = memoryConfig(characterId)
  const all = readMemory(characterId)
  return {
    mode: cfg.mode,
    total: all.length,
    active: all.filter(e => !e.archived).length,
    char_usage: renderMemory(all).length,
    char_limit: cfg.charLimit,
  }
}

/**
 * 超限压缩：按优先级从候选里释放空间，直到满足 charLimit 与 maxEntries。
 * 释放顺序（v2 压缩策略）：
 *   1) 归档条目最先移除（归档 = 已不重要，即使它在「最近 N」内）；
 *   2) 其余按从旧到新移除；
 *   3) 最近 minEntries 条非归档条目受保护（触底时允许保留超限，不越过保护线）；
 *   4) snapshot 写入的新条目在本轮 protect 列表内，天然优先保留。
 * 返回被丢弃的条数。注意：这是系统级容量清理，agent 无显式永久删除工具。
 */
function compactIfOverflow(entries: MemoryEntry[], cfg: MemoryConfig): number {
  let dropped = 0
  const over = () => {
    if (cfg.maxEntries !== undefined && entries.length > cfg.maxEntries) return true
    return renderMemory(entries).length > cfg.charLimit
  }
  const protectStart = Math.max(0, entries.length - cfg.minEntries)
  while (entries.length > 0 && over()) {
    let dropIdx = -1
    // 1) 归档条目最先移除（最旧归档优先，即使处于最近 N 内）。
    const archIdx = entries.findIndex(e => e.archived)
    if (archIdx >= 0) {
      dropIdx = archIdx
    } else if (cfg.maxEntries !== undefined && entries.length > cfg.maxEntries) {
      // 2a) 条数硬上限：minEntries 让位于 maxEntries，直接丢最旧。
      dropIdx = 0
    } else if (0 < protectStart) {
      // 2b) 字符超限：仅当保护区外还有非归档条目时才允许丢。
      dropIdx = 0
    } else {
      // 3) 已到保护线（最近 minEntries 均为新/非归档）→ 停止（允许轻微超限并提示）。
      break
    }
    entries.splice(dropIdx, 1)
    dropped++
  }
  return dropped
}

export interface WriteOutcome {
  /** 写入/更新的条目（重复写入时返回既有条目的最新 ts）。 */
  entry?: MemoryEntry
  /** 是否产生了新条目（内容此前不存在）。 */
  created: boolean
  total: number
  char_usage: number
  char_limit: number
  /** 本次因超限自动丢弃的条目数。 */
  dropped: number
  hint?: string
  /** 模式不允许写入时返回（read_only/off）。 */
  denied?: boolean
}

function persist(characterId: string, entries: MemoryEntry[], cfg: MemoryConfig, newlyAdded: MemoryEntry[]): { dropped: number; hint?: string } {
  const dropped = compactIfOverflow(entries, cfg)
  characterContentStore.save(characterId, { memory: renderMemory(entries) })
  const overflowing = renderMemory(entries).length > cfg.charLimit
  const hint = dropped > 0
    ? `记忆超限，自动移除了 ${dropped} 条（归档优先，其次最旧）。`
    : overflowing
      ? '记忆已达到上限但未触发移除（触底保护），建议尽快合并或归档旧条目。'
      : undefined
  return { dropped, hint }
}

/** 把多条记忆逐条写入（memory_snapshot / memory_write 共用）。 */
export function writeEntries(
  characterId: string,
  items: Array<{ content: string; type?: MemoryType; source?: MemorySource }>,
  opts: { source?: MemorySource } = {},
): WriteOutcome[] {
  const cfg = memoryConfig(characterId)
  if (cfg.mode !== 'editable') return items.map(() => ({ created: false, total: 0, char_usage: 0, char_limit: cfg.charLimit, dropped: 0, denied: true }))

  const entries = readMemory(characterId)
  const source = opts.source ?? 'user'
  const results: WriteOutcome[] = []
  const added: MemoryEntry[] = []

  for (const item of items) {
    const text = normalizeContent(item.content)
    if (!text) {
      results.push({ created: false, total: 0, char_usage: renderMemory(entries).length, char_limit: cfg.charLimit, dropped: 0 })
      continue
    }
    const type = item.type && MEMORY_TYPES.includes(item.type) ? item.type : 'note'
    const ts = nowTs()
    const next: MemoryEntry = { id: entryId(text), ts, type, content: text }

    // 同内容去重：活动条目同内容 → 刷新时间戳并移到末尾（保持最新）；归档同内容 → 重新激活为新条目。
    const activeSame = entries.findIndex(e => !e.archived && e.content === text)
    if (activeSame >= 0) {
      const refreshed: MemoryEntry = { ...entries[activeSame], ts }
      entries.splice(activeSame, 1)
      entries.push(refreshed)
      results.push({ entry: refreshed, created: false, total: entries.length, char_usage: 0, char_limit: cfg.charLimit, dropped: 0 })
      continue
    }
    const archivedSame = entries.findIndex(e => e.archived && e.content === text)
    if (archivedSame >= 0) entries.splice(archivedSame, 1)

    entries.push(next)
    added.push(next)
    results.push({ entry: next, created: true, total: entries.length, char_usage: 0, char_limit: cfg.charLimit, dropped: 0 })
  }

  const { dropped, hint } = persist(characterId, entries, cfg, added)
  const usage = renderMemory(entries).length
  for (const r of results) {
    r.char_usage = usage
    r.total = entries.length
    r.dropped = dropped
    if (hint) r.hint = hint
  }
  const created = results.filter(r => r.created).length
  if (created > 0) {
    const first = results.find(r => r.entry)?.entry
    appendMemoryAudit(characterId, {
      actor: 'Agent',
      action: source === 'snapshot' ? 'snapshot' : 'write',
      target: first ? `${first.type}|${clip(first.content)}` : undefined,
      detail: `写入 ${created} 条${results.length > created ? `（去重 ${results.length - created}）` : ''}，共 ${entries.length} 条`,
    })
  }
  return results
}

export interface UpdateResult {
  updated: boolean
  entry?: MemoryEntry
  total: number
  char_usage: number
  char_limit: number
}

/** 更新一条已有记忆：按 id 精确匹配，未命中则按 match（内容子串）回退；只作用于非归档条目。 */
export function updateEntry(
  characterId: string,
  selector: { id?: string; match?: string },
  patch: { content: string; type?: MemoryType },
): UpdateResult {
  const cfg = memoryConfig(characterId)
  const stat = memoryStats(characterId)
  if (cfg.mode !== 'editable') return { updated: false, total: stat.active, char_usage: stat.char_usage, char_limit: stat.char_limit }

  const entries = readMemory(characterId)
  const activeIdx = entries.map((e, i) => ({ e, i })).filter(x => !x.e.archived)
  const wantId = selector.id?.trim()
  const wantMatch = selector.match?.trim()
  let target = wantId ? activeIdx.find(x => x.e.id === wantId) : undefined
  if (!target && wantMatch) target = activeIdx.find(x => x.e.content.includes(wantMatch))
  if (!target) return { updated: false, total: stat.active, char_usage: stat.char_usage, char_limit: stat.char_limit }

  const text = normalizeContent(patch.content)
  if (!text) return { updated: false, total: stat.active, char_usage: stat.char_usage, char_limit: stat.char_limit }

  const prev = entries[target.i]
  const type = patch.type && MEMORY_TYPES.includes(patch.type) ? patch.type : prev.type
  // 内容不变 → 视为成功但无变化（幂等）。
  if (prev.content === text && prev.type === type) {
    return { updated: true, entry: prev, total: stat.active, char_usage: stat.char_usage, char_limit: stat.char_limit }
  }
  entries[target.i] = { ...prev, type, content: text, id: entryId(text) }
  const { dropped } = persist(characterId, entries, cfg, [])
  const usage = renderMemory(entries).length
  void dropped
  appendMemoryAudit(characterId, {
    actor: 'Agent',
    action: 'update',
    target: entries[target.i].id,
    detail: `更新记忆：${clip(entries[target.i].content)}`,
  })
  return {
    updated: true,
    entry: entries[target.i],
    total: entries.filter(e => !e.archived).length,
    char_usage: usage,
    char_limit: cfg.charLimit,
  }
}

export interface ArchiveResult {
  archived: boolean
  remaining: number
  total: number
  char_usage: number
  char_limit: number
}

/** 归档一条记忆（标记 [archived]）。Agent 无永久删除能力；永久删除仅用户在前端可做。 */
export function archiveEntry(characterId: string, selector: { id?: string; match?: string }): ArchiveResult {
  const cfg = memoryConfig(characterId)
  const stat = memoryStats(characterId)
  if (cfg.mode !== 'editable') return { archived: false, remaining: stat.active, total: stat.total, char_usage: stat.char_usage, char_limit: stat.char_limit }

  const entries = readMemory(characterId)
  const activeIdx = entries.map((e, i) => ({ e, i })).filter(x => !x.e.archived)
  const wantId = selector.id?.trim()
  const wantMatch = selector.match?.trim()
  let target = wantId ? activeIdx.find(x => x.e.id === wantId) : undefined
  if (!target && wantMatch) target = activeIdx.find(x => x.e.content.includes(wantMatch))
  if (!target) return { archived: false, remaining: stat.active, total: stat.total, char_usage: stat.char_usage, char_limit: stat.char_limit }

  entries[target.i] = { ...entries[target.i], archived: true }
  characterContentStore.save(characterId, { memory: renderMemory(entries) })
  return {
    archived: true,
    remaining: entries.filter(e => !e.archived).length,
    total: entries.length,
    char_usage: renderMemory(entries).length,
    char_limit: cfg.charLimit,
  }
}

/** 记忆 md 文件完整路径（供前端记忆浏览器定位，或提示中告知模型可否直接编辑）。 */
export function memoryFilePath(characterId: string): string {
  return resolve(characterDir(characterId), 'memory.md')
}

// ─────────────────────────────────────────────────────────────────────────────
// 前端记忆浏览器 API（用户操作层：浏览 / 编辑 / 归档恢复 / 永久删除 + 审计日志）
// 说明：这些能力只暴露给前端 REST（用户），Agent 工具不暴露 memory_delete；
// 永久删除是 agent 能力上限之外的路径，由用户在 UI 手动执行。
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryEntryView {
  id: string
  ts: string
  type: MemoryType
  content: string
  archived: boolean
}

export interface MemoryView {
  entries: MemoryEntryView[]
  stats: MemoryStats & { archived: number }
  /** 概览摘要块：由活跃条目从真实 memory.md 渲染生成（预览右面板使用）。 */
  overview: {
    blocks: string[]
    /** 全部活跃条目渲染总字符（与注入口径一致）。 */
    used: number
    /** 生效预算（角色真实配置或后端缺省）。 */
    budget: number
    /** 当前已超预算（触底保护期常见）。 */
    overBudget: boolean
  }
}

/** 前端记忆浏览器视图：全部条目（含归档）按最新在前 + 统计 + 概览摘要块。 */
export function listMemoryForView(characterId: string): MemoryView {
  const all = readMemory(characterId)
  const st = memoryStats(characterId)
  const entries = all.slice().reverse().map(e => ({
    id: e.id,
    ts: e.ts,
    type: e.type,
    content: e.content,
    archived: !!e.archived,
  }))
  // 概览摘要块 = 活跃条目渲染（展示用，不落盘、不做删除；条目内容为单行规范化文本）。
  const active = all.filter(e => !e.archived)
  const blocks = active.map(e => `${e.type}｜${e.content}`)
  const used = blocks.join('\n').length
  return {
    entries,
    stats: { ...st, archived: all.length - st.active },
    overview: { blocks, used, budget: st.char_limit, overBudget: used > st.char_limit },
  }
}

export interface MemoryMutationResult {
  ok: boolean
  error?: string
  entry?: MemoryEntryView
  view: MemoryView
}

function toView(characterId: string): MemoryView {
  return listMemoryForView(characterId)
}

/** 编辑一条记忆（任意状态条目，按 id 精确定位）。内容变化 → 重算 id。 */
export function updateMemoryEntryById(
  characterId: string,
  id: string,
  patch: { content?: string; type?: MemoryType },
): MemoryMutationResult {
  const view = () => toView(characterId)
  if (!id) return { ok: false, error: '缺少条目 id', view: view() }
  const entries = readMemory(characterId)
  const idx = entries.findIndex(e => e.id === id)
  if (idx < 0) return { ok: false, error: `条目 ${id} 不存在（可能已被删除）`, view: view() }

  const prev = entries[idx]
  const text = patch.content !== undefined ? normalizeContent(patch.content) : prev.content
  if (!text) return { ok: false, error: '内容不能为空', view: view() }
  const type = patch.type && MEMORY_TYPES.includes(patch.type) ? patch.type : prev.type
  if (prev.content === text && prev.type === type) {
    return { ok: true, entry: { id: prev.id, ts: prev.ts, type: prev.type, content: prev.content, archived: !!prev.archived }, view: view() }
  }
  entries[idx] = { ...prev, type, content: text, id: entryId(text) }
  const cfg = memoryConfig(characterId)
  persist(characterId, entries, cfg, [])
  const e = entries[idx]
  appendMemoryAudit(characterId, { actor: '用户', action: 'update', target: id, detail: `编辑记忆：${clip(e.content)}` })
  return { ok: true, entry: { id: e.id, ts: e.ts, type: e.type, content: e.content, archived: !!e.archived }, view: view() }
}

/** 归档或恢复一条记忆（用户在前端手动操作）。 */
export function setMemoryEntryArchived(characterId: string, id: string, archived: boolean): MemoryMutationResult {
  const view = () => toView(characterId)
  const entries = readMemory(characterId)
  const idx = entries.findIndex(e => e.id === id)
  if (idx < 0) return { ok: false, error: `条目 ${id} 不存在`, view: view() }
  const target = entries[idx]
  if (!!target.archived === archived) {
    return { ok: true, entry: { ...target, archived }, view: view() }
  }
  entries[idx] = { ...target, archived }
  characterContentStore.save(characterId, { memory: renderMemory(entries) })
  appendMemoryAudit(characterId, { actor: '用户', action: archived ? 'archive' : 'restore', target: id, detail: `${archived ? '归档' : '恢复'}记忆：${clip(target.content)}` })
  const e = entries[idx]
  return { ok: true, entry: { id: e.id, ts: e.ts, type: e.type, content: e.content, archived: !!e.archived }, view: view() }
}

/** 永久删除一条记忆（唯一允许删除的路径：用户在前端手动操作）。 */
export function permanentlyDeleteEntry(characterId: string, id: string): MemoryMutationResult {
  const view = () => toView(characterId)
  if (!id) return { ok: false, error: '缺少条目 id', view: view() }
  const entries = readMemory(characterId)
  const idx = entries.findIndex(e => e.id === id)
  if (idx < 0) return { ok: false, error: `条目 ${id} 不存在`, view: view() }
  const removed = entries.splice(idx, 1)[0]
  characterContentStore.save(characterId, { memory: renderMemory(entries) })
  appendMemoryAudit(characterId, { actor: '用户', action: 'delete', target: id, detail: `永久删除记忆：${clip(removed.content)}` })
  return { ok: true, view: view() }
}

// ── 审计日志（memory-audit.jsonl，与 memory.md 同目录，独立 bounded context） ──
export interface MemoryAuditRow {
  ts: string
  actor: 'Agent' | '用户'
  action: string
  target?: string
  detail?: string
}

const AUDIT_MAX_LINES = 500
function memoryAuditFilePath(characterId: string): string {
  return resolve(characterDir(characterId), 'memory-audit.jsonl')
}

function clip(s: string, max = 60): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 追加一条审计记录（Agent 工具写操作与用户前端操作统一入账）。 */
export function appendMemoryAudit(characterId: string, row: Omit<MemoryAuditRow, 'ts'>): void {
  try {
    const file = memoryAuditFilePath(characterId)
    appendFileSync(file, `${JSON.stringify({ ts: nowTs(), ...row })}\n`, 'utf-8')
    // 简单滚动：行数超上限时裁剪为最近 AUDIT_MAX_LINES 行。
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean)
    if (lines.length > AUDIT_MAX_LINES) {
      writeFileSync(file, lines.slice(-AUDIT_MAX_LINES).join('\n') + '\n', 'utf-8')
    }
  } catch { /* 审计是尽力而为，失败不阻断记忆写操作 */ }
}

/** 读取审计记录（最新在前）。 */
export function readMemoryAudit(characterId: string, limit = 200): MemoryAuditRow[] {
  try {
    const file = memoryAuditFilePath(characterId)
    if (!existsSync(file)) return []
    const rows: MemoryAuditRow[] = []
    for (const line of readFileSync(file, 'utf-8').split(/\r?\n/).reverse()) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line) as MemoryAuditRow
        if (r && r.ts) rows.push({ ts: r.ts, actor: r.actor, action: r.action, target: r.target, detail: r.detail })
      } catch { /* skip malformed */ }
      if (rows.length >= limit) break
    }
    return rows
  } catch {
    return []
  }
}

