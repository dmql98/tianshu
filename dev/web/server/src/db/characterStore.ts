import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs'
import { resolve } from 'path'
import { getSystemRunPolicy } from '../config.js'
import { charactersRoot } from '../data-paths.js'
import { builtinCharactersRoot } from '../content/paths.js'
import { readSourceTag, markSourceAsUser } from '../content/copy-on-write.js'
import { mergeById, type ContentOriginFields } from '../content/catalog.js'
import { readContentState } from '../content/state.js'
import { materializeCharacter, userCharacterDirExists } from '../content/copy-on-write.js'
import { builtinContentVersion } from '../agent/skill-catalog.js'
import { normalizeStrategy, type Strategy, type StrategyInput } from '../agent/strategy.js'
import { normalizeCharacterRunPolicy, migrateCharacterRunPolicy, type CharacterRunPolicy } from '../agent/loop/run-policy.js'

function ensureCharDir() {
  const dir = charactersRoot()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export interface CharacterMemory {
  enabled: boolean
  selfEvolution?: boolean
  charLimit?: number
  maxEntries?: number
}

import type { ToolBinding, ToolConstraint } from '../tools/types.js'

export type { ToolBinding, ToolConstraint }

export interface SkillBinding {
  packageId: string
  enabled?: boolean
  preloadSkills?: string[]
  disabledSkills?: string[]
}

export interface CharacterRecord {
  id: string
  name: string
  /** 来源标签：builtin（内置出厂/未编辑物化副本）/ user（用户创建或编辑过）。 */
  source?: 'builtin' | 'user'
  description?: string
  avatar?: string
  color?: string
  memory?: CharacterMemory
  model?: string
  provider?: string
  tools?: ToolBinding[]
  maxSteps?: number
  runPolicy?: CharacterRunPolicy
  role?: 'main' | 'sub' | 'both'
  groups?: string[]
  default_strategy?: Strategy
  skills?: string[]
  skillBindings?: SkillBinding[]
  /** 绑定的皮肤 id（SKIN_DECOUPLE_PLAN）。 */
  skinId?: string
  enabled?: boolean
  hidden?: boolean
  createdAt?: number
  updatedAt?: number
}

/** API 响应派生来源字段（不写入 character.json）。 */
export type CharacterOriginFields = ContentOriginFields

function pathFor(id: string): string {
  const dir = ensureCharDir()
  return resolve(dir, id, 'character.json')
}

/**
 * Normalize a character record on load. `runPolicy` is normalized when present;
 * legacy `maxSteps` is migrated into `runPolicy` (read-time, phase 1). `maxSteps`
 * itself is retained as a read-only compatibility field during the transition.
 */
function normalizeRecord(record: CharacterRecord & { default_strategy?: StrategyInput }): CharacterRecord {
  const skillBindings = record.skillBindings || []
  const systemAbs = getSystemRunPolicy().maxAbsoluteTurnsPerRun
  const runPolicy = normalizeCharacterRunPolicy(record.runPolicy)
    ?? migrateCharacterRunPolicy(record.maxSteps, systemAbs)
  return {
    ...record,
    skills: skillBindings.map(binding => binding.packageId),
    skillBindings,
    runPolicy,
    ...(record.default_strategy
      ? { default_strategy: normalizeStrategy(record.default_strategy, 'Ask Risky') }
      : {}),
  }
}

/** 扫描单个角色根，返回已规范化的记录（不含来源字段）。 */
export function scanCharacters(root: string): CharacterRecord[] {
  const items: CharacterRecord[] = []
  if (!existsSync(root)) return items
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const f = resolve(root, entry.name, 'character.json')
      if (!existsSync(f)) continue
      try { items.push(normalizeRecord(JSON.parse(readFileSync(f, 'utf-8')))) } catch { /* skip corrupt */ }
    }
  } catch { /* dir not found */ }
  return items
}

/** 扫描用户层角色，排除"未编辑的物化副本"（source 标签为 builtin，仍由 builtin 层提供）。 */
function scanUserCharacters(): CharacterRecord[] {
  return scanCharacters(charactersRoot()).filter(c => readSourceTag(resolve(charactersRoot(), c.id), 'character') !== 'builtin')
}

/** 双层角色合并（builtin + userdata），返回带来源字段的稳定排序列表。 */
export function listMergedCharacters(includeHidden = false): Array<CharacterRecord & CharacterOriginFields> {
  const builtin = scanCharacters(builtinCharactersRoot())
  const user = scanUserCharacters()
  const state = readContentState()
  const hiddenIds = new Set<string>()
  if (!includeHidden) for (const id of state.hidden.characters) hiddenIds.add(id)

  return mergeById<CharacterRecord>({
    builtin,
    user,
    hiddenIds,
    builtinVersion: builtinContentVersion(),
  })
}

/** 解析单个角色：用户层完整覆盖内置层；不存在的 ID 返回 null。 */
export function resolveCharacterRecord(id: string): (CharacterRecord & CharacterOriginFields) | null {
  const builtin = scanCharacters(builtinCharactersRoot()).find(c => c.id === id)
  const user = scanCharacters(charactersRoot())
    .filter(c => readSourceTag(resolve(charactersRoot(), c.id), 'character') !== 'builtin')
    .find(c => c.id === id)
  if (!builtin && !user) return null
  const [merged] = mergeById<CharacterRecord>({
    builtin: builtin ? [builtin] : [],
    user: user ? [user] : [],
    hiddenIds: new Set(),
    builtinVersion: builtinContentVersion(),
  })
  return merged || null
}

function writeSingle(record: CharacterRecord) {
  const dir = resolve(charactersRoot(), record.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'character.json'), JSON.stringify(record, null, 2), 'utf-8')
}

function removeDir(id: string) {
  const dir = resolve(charactersRoot(), id)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function nextId(items: CharacterRecord[]): string {
  const max = items.reduce((m, c) => Math.max(m, parseInt(c.id) || 0), 0)
  return String(max + 1)
}

/**
 * 写入口保护：对内置角色执行 copy-on-write，确保后续写入落在用户副本。
 * 用户副本已存在（含损坏目录）时不覆盖。
 */
function ensureWritable(id: string): void {
  const builtin = scanCharacters(builtinCharactersRoot()).some(c => c.id === id)
  if (!builtin) return
  if (!userCharacterDirExists(id)) {
    materializeCharacter(id, builtinContentVersion())
  }
}

export const characterMetaStore = {
  /** 双层合并列表（普通列表不含隐藏项）。 */
  getAll: (): Array<CharacterRecord & CharacterOriginFields> => listMergedCharacters(false),

  /** 双层合并列表（含隐藏项，管理接口 all=true 使用）。 */
  getAllIncludingHidden: (): Array<CharacterRecord & CharacterOriginFields> => listMergedCharacters(true),

  /** 双层解析；用户层完整覆盖内置层。 */
  getById: (id: string): (CharacterRecord & CharacterOriginFields) | null => resolveCharacterRecord(id),

  /** 仅读取用户层原始记录（写路径内部使用，避免 builtin 伪装成用户副本）。 */
  getUserRecord: (id: string): CharacterRecord | null => {
    const f = pathFor(id)
    if (!existsSync(f)) return null
    try { return normalizeRecord(JSON.parse(readFileSync(f, 'utf-8'))) } catch { return null }
  },

  create: (data: Omit<CharacterRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
    const all = scanCharacters(charactersRoot())
    const now = Date.now()
    const id = data.id?.trim() || nextId(all)
    if (all.some(c => c.id === id)) {
      throw new Error(`Character ID "${id}" already exists`)
    }
    const { id: _, ...rest } = data
    // 用户新建的角色 → source 标签置 user（默认覆盖任何同名内置项）。
    const record: CharacterRecord = normalizeRecord({ source: 'user', ...rest, id, createdAt: now, updatedAt: now })
    writeSingle(record)
    return record
  },

  update: (id: string, data: Partial<CharacterRecord>) => {
    // 编辑内置角色：先物化用户副本，再改副本（copy-on-write）。
    ensureWritable(id)
    const record = characterMetaStore.getUserRecord(id)
    if (!record) return null
    // 用户编辑了内置角色副本 → source 标签置 user（合并时覆盖 builtin）。
    // 注意 source 要放在 record 展开之后，避免被副本里的 builtin 标签覆盖。
    markSourceAsUser(resolve(charactersRoot(), id), 'character')
    const updated: CharacterRecord = normalizeRecord({ ...record, ...data, id, source: 'user', updatedAt: Date.now() })
    writeSingle(updated)
    return updated
  },

  rename: (oldId: string, newId: string): CharacterRecord | null => {
    if (oldId === newId) return characterMetaStore.getUserRecord(oldId)
    const all = scanCharacters(charactersRoot())
    if (!all.some(c => c.id === oldId)) return null
    if (all.some(c => c.id === newId)) throw new Error(`ID "${newId}" already exists`)
    const oldDir = resolve(charactersRoot(), oldId)
    const newDir = resolve(charactersRoot(), newId)
    renameSync(oldDir, newDir)
    const record: CharacterRecord = JSON.parse(readFileSync(resolve(newDir, 'character.json'), 'utf-8'))
    record.id = newId
    record.updatedAt = Date.now()
    writeFileSync(resolve(newDir, 'character.json'), JSON.stringify(record, null, 2), 'utf-8')
    return record
  },

  delete: (id: string) => {
    if (!characterMetaStore.getUserRecord(id)) return false
    removeDir(id)
    return true
  },
}
