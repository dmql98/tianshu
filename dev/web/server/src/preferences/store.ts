/**
 * 用户偏好持久层（USER_PREFERENCES_PLAN）。
 *
 * <dataDir>/user-preferences.json 记录主题/图标包等轻量偏好，是跨重启的权威
 * 事实来源。桌面客户端内置服务每次启动绑定随机端口，渲染进程 origin 随之变化，
 * localStorage（按 origin 隔离）会在重启后清空——所以主题/图标这类需要跨重启
 * 保留的偏好必须落到磁盘文件，客户端只是把它当作快速缓存 + 跨窗口同步层。
 *
 * 设计（与 content-state.json 同构）：
 * - 只存轻量选择，不存主题/图标内容本身（内容在 <dataDir>/themes、<dataDir>/iconpacks）。
 * - 损坏/版本未知/非法值一律安全回退为空状态，不允许抛错阻塞启动。
 * - 写操作原子替换（先写临时文件再 rename），避免半写文件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { userPreferencesFile } from '../data-paths.js'

export const USER_PREFERENCES_SCHEMA_VERSION = 1

/** 与客户端 themeDefinitions / iconPreferences 对齐的安全 ID 形状（防路径/URL 注入）。 */
export const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

/** 主题选择：只存轻量 selection（与客户端 ThemeSelection 同语义）。 */
export type UserThemeSelection =
  | { mode: 'system' }
  | { mode: 'builtin'; themeId: string }
  | { mode: 'custom'; themeId: string }

export interface UserPreferences {
  schemaVersion: 1
  theme?: UserThemeSelection
  iconPack?: { packId: string }
}

const EMPTY: UserPreferences = { schemaVersion: 1 }

let cached: UserPreferences | null = null

// ── 校验/规范化（服务端防御性校验；客户端保存前已规范化，这里只拦明显非法值） ──

export function normalizeThemeSelection(value: unknown): UserThemeSelection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { mode?: unknown; themeId?: unknown }

  if (candidate.mode === 'system') return { mode: 'system' }

  if (candidate.mode === 'builtin' || candidate.mode === 'custom') {
    if (
      typeof candidate.themeId === 'string' &&
      candidate.themeId.length > 0 &&
      candidate.themeId.length <= 128 &&
      SAFE_ID_RE.test(candidate.themeId)
    ) {
      return { mode: candidate.mode, themeId: candidate.themeId }
    }
  }

  return null
}

export function normalizeIconPackSelection(value: unknown): { packId: string } | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { packId?: unknown }
  if (
    typeof candidate.packId === 'string' &&
    candidate.packId.length > 0 &&
    candidate.packId.length <= 128 &&
    SAFE_ID_RE.test(candidate.packId)
  ) {
    return { packId: candidate.packId }
  }
  return null
}

function normalizePreferences(value: unknown): UserPreferences {
  if (!value || typeof value !== 'object') return { ...EMPTY }
  const candidate = value as Partial<UserPreferences>
  // 版本已知且不是 v1：视为未来/未知格式，安全回退空状态
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== USER_PREFERENCES_SCHEMA_VERSION) {
    return { ...EMPTY }
  }
  const next: UserPreferences = { schemaVersion: 1 }
  const theme = normalizeThemeSelection(candidate.theme)
  if (theme) next.theme = theme
  const iconPack = normalizeIconPackSelection(candidate.iconPack)
  if (iconPack) next.iconPack = iconPack
  return next
}

// ── 读写 ──

export function readUserPreferences(): UserPreferences {
  if (cached) return cached
  const file = userPreferencesFile()
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8'))
      cached = normalizePreferences(raw)
      return cached
    } catch {
      /* corrupt state → safe empty state */
    }
  }
  cached = { ...EMPTY }
  return cached
}

function persist(preferences: UserPreferences): void {
  const file = userPreferencesFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(preferences, null, 2), 'utf-8')
  renameSync(temp, file)
  cached = preferences
}

/**
 * 部分更新并合并：body 里出现 `theme`/`iconPack` 键即替换对应字段，`null` 清除。
 * 其余字段保留（主题与图标包各自推进，互不覆盖）。
 */
export function setUserPreferences(body: unknown): UserPreferences {
  const current = readUserPreferences()
  if (body && typeof body === 'object') {
    const input = body as Record<string, unknown>
    if ('theme' in input) {
      const theme = normalizeThemeSelection(input.theme)
      if (theme) current.theme = theme
      else delete current.theme
    }
    if ('iconPack' in input) {
      const iconPack = normalizeIconPackSelection(input.iconPack)
      if (iconPack) current.iconPack = iconPack
      else delete current.iconPack
    }
  }
  persist(current)
  return current
}

export function resetUserPreferencesCache(): void {
  cached = null
}