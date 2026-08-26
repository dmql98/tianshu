import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs'
import { resolve } from 'path'
import { getSystemRunPolicy } from '../config.js'
import { charactersRoot } from '../data-paths.js'
import { builtinCharactersRoot } from '../content/paths.js'
import { readSourceTag } from '../content/copy-on-write.js'
import { mergeById, type ContentOriginFields } from '../content/catalog.js'
import { readContentState } from '../content/state.js'
import { materializeCharacter } from '../content/copy-on-write.js'
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
  /** 单层化：该项是否覆盖/派生自一个出厂内置项（用户编辑过内置项时置 true）。 */
  overridesBuiltin?: boolean
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
  /** 工作帮手：该角色新会话默认可委托的角色白名单（含自己/其他角色/worker）。未配置 = 空（不默认 worker）。 */
  helpers?: string[]
  /** 绑定的皮肤 id（SKIN_DECOUPLE_PLAN）。null = 未激活，回退展示角色同名的默认皮肤。 */
  skinId?: string | null
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

/** 单层角色合并（所有角色都在 <dataDir>/characters，按 source 标签拆 builtin/user），返回带来源字段的稳定排序列表。 */
export function listMergedCharacters(includeHidden = false): Array<CharacterRecord & CharacterOriginFields> {
  const all = scanCharacters(charactersRoot())
  const builtin = all.filter(c => readSourceTag(resolve(charactersRoot(), c.id), 'character') === 'builtin')
  const user = all.filter(c => readSourceTag(resolve(charactersRoot(), c.id), 'character') !== 'builtin')
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

/** 解析单个角色：用户层（source=user）完整覆盖内置层（source=builtin）；不存在的 ID 返回 null。 */
export function resolveCharacterRecord(id: string): (CharacterRecord & CharacterOriginFields) | null {
  const all = scanCharacters(charactersRoot()).filter(c => c.id === id)
  const builtin = all.find(c => readSourceTag(resolve(charactersRoot(), c.id), 'character') === 'builtin')
  const user = all.find(c => readSourceTag(resolve(charactersRoot(), c.id), 'character') !== 'builtin')
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
  // 单层化：seed 保证 <dataDir>/characters/<id> 已存在；若缺失则尝试从出厂源物化兜底。
  const dir = resolve(charactersRoot(), id)
  if (existsSync(dir)) return
  if (existsSync(resolve(builtinCharactersRoot(), id))) {
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
    // 编辑内置角色（copy-on-write）：确保 dataDir 副本存在，写回时来源标签置 user。
    // 若副本原本是出厂内置项，附加 overridesBuiltin 标记供合并层识别"已自定义"。
    ensureWritable(id)
    const record = characterMetaStore.getUserRecord(id)
    if (!record) return null
    const isBuiltin = record.source === 'builtin'
    const updated: CharacterRecord = normalizeRecord({
      ...record,
      ...data,
      id,
      source: 'user',
      updatedAt: Date.now(),
      ...(isBuiltin ? { overridesBuiltin: true } : {}),
    })
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
