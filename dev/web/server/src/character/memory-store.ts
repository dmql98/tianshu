import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { characterContentStore, characterDir } from './store.js'
import { characterMetaStore } from '../db/characterStore.js'

/**
 * 角色私有记忆（A 档）：结构化为「逐条条目」存于 <dataDir>/characters/<id>/memory.md。
 *
 * memory.md 格式（可读、可整份注入、可按行解析）：
 * ```
 * # 记忆
 *
 * - [2026-08-31 15:04] 内容一
 * - [2026-08-31 15:05] 内容二
 * ```
 *
 * - 记忆开关：`character.memory.enabled` 控制是否可写 / 是否被注入。
 * - 字数上限：`character.memory.charLimit`；写入后超限会自动从「最旧」开始丢弃
 *   直到低于上限（保留最新，确定性裁剪，A 档不做 LLM 摘要）。
 * - 条数上限：`character.memory.maxEntries`（可选）；超限同按最旧丢弃。
 */

/** 一段解析出的记忆条目。 */
export interface MemoryEntry {
  /** ISO 时间戳（'YYYY-MM-DD HH:mm'）。 */
  ts: string
  content: string
}

const HEADER = '# 记忆'

/** 取当前角色记忆配置（缺省视为关闭但兼容旧行为由调用方决定）。 */
export function memoryConfig(characterId: string): { enabled: boolean; charLimit: number; maxEntries?: number } {
  const m = characterMetaStore.getById(characterId)?.memory
  return {
    enabled: !!m?.enabled,
    charLimit: typeof m?.charLimit === 'number' && m.charLimit > 0 ? m.charLimit : 2200,
    maxEntries: typeof m?.maxEntries === 'number' && m.maxEntries > 0 ? m.maxEntries : undefined,
  }
}

/** 从 memory.md 原始文本解析条目。 */
export function parseMemory(content: string): MemoryEntry[] {
  const lines = content.split(/\r?\n/)
  const entries: MemoryEntry[] = []
  for (const raw of lines) {
    const line = raw.replace(/\uFEFF/g, '').trimEnd()
    if (!line.startsWith('- [')) continue
    const close = line.indexOf('] ')
    if (close < 0) continue
    const ts = line.slice(3, close).trim()
    const body = line.slice(close + 2).trim()
    if (!body) continue
    entries.push({ ts, content: body })
  }
  return entries
}

/** 渲染条目为 memory.md 文本。 */
export function renderMemory(entries: MemoryEntry[]): string {
  if (entries.length === 0) return `${HEADER}\n`
  return `${HEADER}\n\n${entries.map(e => `- [${e.ts}] ${e.content}`).join('\n')}\n`
}

/** 读取当前角色记忆（空即 []）。 */
export function readMemory(characterId: string): MemoryEntry[] {
  const raw = characterContentStore.get(characterId).memory
  if (!raw) return []
  return parseMemory(raw)
}

/** 当前记忆的总字符数（含格式开销）。 */
function memoryLength(entries: MemoryEntry[]): number {
  return renderMemory(entries).length
}

/**
 * 超限压缩：从最旧到最新丢弃，直到长度与条数都满足上限。
 * 返回被丢弃的条数。
 */
function compactIfOverflow(entries: MemoryEntry[], cfg: { charLimit: number; maxEntries?: number }): number {
  let dropped = 0
  while (entries.length > 0) {
    const overEntries = cfg.maxEntries !== undefined && entries.length > cfg.maxEntries
    const overChars = memoryLength(entries) > cfg.charLimit
    if (!overEntries && !overChars) break
    entries.shift()
    dropped++
  }
  return dropped
}

export interface RememberResult {
  /** 落盘后的条目总数。 */
  count: number
  /** 本次因超限被丢弃的旧条目数。 */
  dropped: number
  /** 当前是否符合上限。 */
  overflowing: boolean
  /** 是否因记忆未启用（enabled=false）而未写入。 */
  disabledFallback?: boolean
  /** 超限提示（供模型下一步决定是否主动精简）。 */
  hint?: string
}

/** 追加一条记忆；若记忆未启用则返回 disabledFallback 而不落盘。 */
export function remember(characterId: string, content: string): RememberResult {
  const cfg = memoryConfig(characterId)
  if (!cfg.enabled) {
    return { count: 0, dropped: 0, overflowing: false, disabledFallback: true }
  }
  const trimmed = content.replace(/\s+/g, ' ').trim()
  if (!trimmed) return { count: 0, dropped: 0, overflowing: false }

  const entries = readMemory(characterId)
  const now = new Date()
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  // 同内容去重：同一逻辑记忆只保留最新一次（避免重复膨胀）。
  const existing = entries.findIndex(e => e.content === trimmed)
  if (existing >= 0) entries.splice(existing, 1)
  entries.push({ ts, content: trimmed })

  const dropped = compactIfOverflow(entries, cfg)
  characterContentStore.save(characterId, { memory: renderMemory(entries) })

  const overflowing = memoryLength(entries) > cfg.charLimit
  const hint = overflowing
    ? '记忆已接近上限，建议合并或精简旧条目后才继续追加。'
    : dropped > 0
      ? `因超出上限自动丢弃了最旧的 ${dropped} 条记忆。`
      : undefined
  return { count: entries.length, dropped, overflowing, hint }
}

export interface ForgetResult {
  removed: number
  remaining: number
}

/** 按内容（子串匹配）删除记忆条目。 */
export function forget(characterId: string, content: string): ForgetResult {
  const needle = content.trim()
  if (!needle) return { removed: 0, remaining: readMemory(characterId).length }
  const before = readMemory(characterId)
  const after = before.filter(e => !e.content.includes(needle))
  if (after.length !== before.length) {
    characterContentStore.save(characterId, { memory: renderMemory(after) })
  }
  return { removed: before.length - after.length, remaining: after.length }
}

/** 记忆 md 文件完整路径（用于在提示中告知模型可否直接编辑）。 */
export function memoryFilePath(characterId: string): string {
  return resolve(characterDir(characterId), 'memory.md')
}
