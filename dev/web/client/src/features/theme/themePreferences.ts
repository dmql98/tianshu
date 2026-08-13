/**
 * 主题偏好 v2：轻量选择存储、迁移、校验与跨窗口同步。
 *
 * 存储键 `tianshu:themePreferences`（versioned JSON）。**只保存轻量 selection**；
 * 自定义主题完整定义与图片事实来源在服务端 <dataDir>/themes，绝不写入 localStorage
 * （TIANSHU_THEME_SWITCHING_PLAN §6 / 产品目标 5）。
 *
 * 迁移：
 * - 旧键 `tianshu:theme`（light/dark/system）→ v2 selection。
 * - 旧内置 ID `tianshu-paper` → `tianshu-light`；`tianshu-night` → `tianshu-dark`。
 * - `tianshu-starry` 不再是内置主题：builtin 选择回退 system，custom 由 resolve 阶段回退。
 * - JSON 损坏、版本未知、未知 themeId 一律安全回退 `{ mode: 'system' }`。
 */
import {
  DEFAULT_THEME_SELECTION,
  isBuiltinThemeId,
  isThemeSelection,
  migrateLegacyBuiltinId,
  type ThemeSelection,
} from './themeDefinitions'

export interface ThemePreferences {
  version: 2
  selection: ThemeSelection
}

export const THEME_PREFERENCES_STORAGE_KEY = 'tianshu:themePreferences'
export const LEGACY_THEME_STORAGE_KEY = 'tianshu:theme'
export const THEME_CHANGED_EVENT = 'tianshu:theme-changed'

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  version: 2,
  selection: DEFAULT_THEME_SELECTION,
}

export function getDefaultStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

// ── 规范化 ──

/**
 * 校验并规范化 selection。未知内置 ID 迁移旧名；无法识别的值回退 system。
 */
export function normalizeThemeSelection(value: unknown): ThemeSelection {
  if (!value || typeof value !== 'object') return { mode: 'system' }
  const candidate = value as { mode?: unknown; themeId?: unknown }

  if (candidate.mode === 'system') return { mode: 'system' }

  if (candidate.mode === 'builtin') {
    if (typeof candidate.themeId === 'string') {
      const migrated = migrateLegacyBuiltinId(candidate.themeId)
      if (migrated) return { mode: 'builtin', themeId: migrated }
    }
    return { mode: 'system' }
  }

  if (candidate.mode === 'custom') {
    if (typeof candidate.themeId === 'string' && candidate.themeId.length > 0 && candidate.themeId.length <= 128) {
      // 只允许安全的 ID 形状，防止把路径/URL 当主题 ID 持久化
      if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(candidate.themeId)) {
        return { mode: 'custom', themeId: candidate.themeId }
      }
    }
    return { mode: 'system' }
  }

  return { mode: 'system' }
}

export function normalizeThemePreferences(value: unknown): ThemePreferences {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<ThemePreferences>
    // 版本已知且不是 v2：视为未来/未知格式，安全回退 system
    if (candidate.version !== undefined && candidate.version !== 2) {
      return { ...DEFAULT_THEME_PREFERENCES }
    }
    return {
      version: 2,
      selection: normalizeThemeSelection(candidate.selection),
    }
  }
  return { ...DEFAULT_THEME_PREFERENCES }
}

// ── 存储 ──

export function loadThemePreferences(storage: Storage | null = getDefaultStorage()): ThemePreferences {
  if (!storage) return { ...DEFAULT_THEME_PREFERENCES }
  try {
    const raw = storage.getItem(THEME_PREFERENCES_STORAGE_KEY)
    if (raw) return normalizeThemePreferences(JSON.parse(raw))
  } catch {
    /* 损坏数据回退迁移/默认 */
  }
  const migrated = migrateLegacyThemeSelection(storage)
  if (migrated) return migrated
  return { ...DEFAULT_THEME_PREFERENCES }
}

export function saveThemePreferences(
  preferences: ThemePreferences,
  storage: Storage | null = getDefaultStorage(),
): ThemePreferences {
  const normalized = normalizeThemePreferences(preferences)
  if (storage) storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

/**
 * 旧键 `tianshu:theme`（light/dark/system）迁移为 v2 JSON。
 * 不删除旧键，便于回滚与审计。
 */
export function migrateLegacyThemeSelection(storage: Storage | null = getDefaultStorage()): ThemePreferences | null {
  if (!storage) return null
  const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY)
  if (legacy === null) return null
  let selection: ThemeSelection
  if (legacy === 'light') selection = { mode: 'builtin', themeId: 'tianshu-light' }
  else if (legacy === 'dark') selection = { mode: 'builtin', themeId: 'tianshu-dark' }
  else if (legacy === 'system') selection = { mode: 'system' }
  else {
    // 旧计划主题 ID（tianshu-paper / tianshu-night / tianshu-starry）
    const migrated = migrateLegacyBuiltinId(legacy)
    selection = migrated ? { mode: 'builtin', themeId: migrated } : { mode: 'system' }
  }
  const migratedPrefs: ThemePreferences = { version: 2, selection }
  return saveThemePreferences(migratedPrefs, storage)
}

/** 兼容旧调用：旧版本曾直接保存自定义主题定义数组；v2 丢弃该字段（只留选择）。 */
export function normalizeLegacyPreferencesWithCustomThemes(value: unknown): ThemePreferences {
  return normalizeThemePreferences(value)
}

export function isThemePreferences(value: unknown): value is ThemePreferences {
  return isThemeSelection(value && typeof value === 'object' ? (value as ThemePreferences).selection : null)
}

// ── 校验 helper ──

/** 校验 builtin 选择的目标主题是否仍然存在（防御性：内置 ID 永不失效）。 */
export function isKnownBuiltinSelection(selection: ThemeSelection): boolean {
  return selection.mode !== 'builtin' || isBuiltinThemeId(selection.themeId)
}
