/**
 * 主题偏好：存储、迁移、校验、解析、应用与跨窗口同步。
 *
 * 存储键 `tianshu:themePreferences`（versioned JSON），兼容旧键 `tianshu:theme`
 * （light/dark/system）。损坏、未知版本、未知 themeId 一律安全回退 system。
 *
 * 应用规则：
 * - `<html>` 写 data-theme-selection / data-theme-id / data-color-scheme / data-has-backdrop。
 * - 主题装饰参数（背景图、暗化、面板透明度、焦点、强调色）写为 CSS 变量，
 *   基础 light/dark token 由 index.css 按 data-color-scheme 提供。
 */
import {
  BUILTIN_THEME_NIGHT,
  BUILTIN_THEME_PAPER,
  BUILTIN_THEMES,
  normalizeThemeDefinition,
  type ThemeDefinition,
} from './themeDefinitions'

export type ThemeSelection = { mode: 'system' } | { mode: 'fixed'; themeId: string }

export interface ThemePreferences {
  version: 1
  selection: ThemeSelection
  customThemes: ThemeDefinition[]
}

export const THEME_PREFERENCES_STORAGE_KEY = 'tianshu:themePreferences'
export const LEGACY_THEME_STORAGE_KEY = 'tianshu:theme'
export const THEME_CHANGED_EVENT = 'tianshu:theme-changed'

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  version: 1,
  selection: { mode: 'system' },
  customThemes: [],
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value)
}

function getDefaultStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function getDefaultRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

// ── 颜色工具 ──

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = isValidHexColor(hex) ? hex : '#c8960a'
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

/** 与白色混合（percent 0-1），用于衍生浅色强调色。 */
export function mixWithWhite(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * percent)
  const toHex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── 规范化 ──

export function normalizeThemeSelection(value: unknown): ThemeSelection {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<ThemeSelection>
    if (candidate.mode === 'fixed' && typeof candidate.themeId === 'string' && candidate.themeId) {
      return { mode: 'fixed', themeId: candidate.themeId }
    }
  }
  return { mode: 'system' }
}

export function normalizeThemePreferences(value: unknown): ThemePreferences {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<ThemePreferences>
    const customThemes = Array.isArray(candidate.customThemes)
      ? candidate.customThemes
          .map(normalizeThemeDefinition)
          .filter((t): t is ThemeDefinition => t !== null && !t.builtin)
      : []
    return {
      version: 1,
      selection: normalizeThemeSelection(candidate.selection),
      customThemes,
    }
  }
  return { ...DEFAULT_THEME_PREFERENCES, customThemes: [] }
}

// ── 存储 ──

export function loadThemePreferences(storage: Storage | null = getDefaultStorage()): ThemePreferences {
  if (!storage) return { ...DEFAULT_THEME_PREFERENCES, customThemes: [] }
  try {
    const raw = storage.getItem(THEME_PREFERENCES_STORAGE_KEY)
    if (raw) return normalizeThemePreferences(JSON.parse(raw))
  } catch {
    /* 损坏数据回退默认 */
  }
  const migrated = migrateLegacyThemeSelection(storage)
  if (migrated) return migrated
  return { ...DEFAULT_THEME_PREFERENCES, customThemes: [] }
}

export function saveThemePreferences(
  preferences: ThemePreferences,
  storage: Storage | null = getDefaultStorage(),
): ThemePreferences {
  const normalized = normalizeThemePreferences(preferences)
  if (storage) storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

/** 旧键 `tianshu:theme`（light/dark/system）迁移为 versioned JSON；不删除旧键以便回滚。 */
export function migrateLegacyThemeSelection(storage: Storage | null = getDefaultStorage()): ThemePreferences | null {
  if (!storage) return null
  const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY)
  if (legacy === null) return null
  const selection: ThemeSelection =
    legacy === 'light'
      ? { mode: 'fixed', themeId: BUILTIN_THEME_PAPER.id }
      : legacy === 'dark'
        ? { mode: 'fixed', themeId: BUILTIN_THEME_NIGHT.id }
        : { mode: 'system' }
  const migrated: ThemePreferences = { version: 1, selection, customThemes: [] }
  return saveThemePreferences(migrated, storage)
}

// ── 解析与查找 ──

export function getThemeDefinition(preferences: ThemePreferences, themeId: string): ThemeDefinition | null {
  if (themeId.startsWith('custom:')) {
    return preferences.customThemes.find(t => t.id === themeId) ?? null
  }
  return BUILTIN_THEMES.find(t => t.id === themeId) ?? null
}

/** 将用户选择解析为实际主题：system 跟随 prefersDark。 */
export function resolveTheme(
  preferences: ThemePreferences,
  prefersDark: boolean,
): ThemeDefinition {
  if (preferences.selection.mode === 'fixed') {
    const fixed = getThemeDefinition(preferences, preferences.selection.themeId)
    if (fixed) return fixed
  }
  return prefersDark ? BUILTIN_THEME_NIGHT : BUILTIN_THEME_PAPER
}

export function resolvedAppearance(theme: ThemeDefinition): 'light' | 'dark' {
  return theme.appearance
}

// ── 自定义主题管理 ──

export interface CustomThemeInput {
  name: string
  appearance: 'light' | 'dark'
  accent: string
  background?: ThemeDefinition['background']
  panelOpacity: number
  dim: number
  focusX: number
  focusY: number
}

export function createCustomTheme(input: CustomThemeInput): ThemeDefinition {
  const suffix = Math.random().toString(36).slice(2, 10)
  const id = `custom:${Date.now().toString(36)}-${suffix}`
  return {
    id,
    name: input.name.trim() || '自定义主题',
    appearance: input.appearance,
    accent: isValidHexColor(input.accent) ? input.accent.toLowerCase() : '#c8960a',
    background: input.background,
    panelOpacity: input.panelOpacity,
    dim: input.dim,
    focusX: input.focusX,
    focusY: input.focusY,
    builtin: false,
  }
}

export function upsertCustomTheme(preferences: ThemePreferences, theme: ThemeDefinition): ThemePreferences {
  const index = preferences.customThemes.findIndex(t => t.id === theme.id)
  const customThemes = [...preferences.customThemes]
  if (index >= 0) customThemes[index] = theme
  else customThemes.push(theme)
  return { ...preferences, customThemes }
}

export function deleteCustomTheme(preferences: ThemePreferences, themeId: string): ThemePreferences {
  const customThemes = preferences.customThemes.filter(t => t.id !== themeId)
  const selection: ThemeSelection =
    preferences.selection.mode === 'fixed' && preferences.selection.themeId === themeId
      ? { mode: 'system' }
      : preferences.selection
  return { ...preferences, customThemes, selection }
}

// ── 应用 ──

export interface ResolvedThemeState {
  theme: ThemeDefinition
  selection: ThemeSelection
}

export function applyResolvedTheme(
  theme: ThemeDefinition,
  selection: ThemeSelection,
  root: HTMLElement | null = getDefaultRoot(),
): void {
  if (!root) return

  root.setAttribute('data-theme-selection', selection.mode)
  root.setAttribute('data-theme-id', theme.id)
  root.setAttribute('data-color-scheme', theme.appearance)
  root.setAttribute('data-has-backdrop', theme.background ? 'true' : 'false')
  root.style.colorScheme = theme.appearance

  const style = root.style
  style.setProperty('--theme-accent', theme.accent)
  style.setProperty('--gold', theme.accent)
  style.setProperty('--gold-light', mixWithWhite(theme.accent, 0.55))
  style.setProperty('--gold-soft', rgba(theme.accent, 0.1))
  style.setProperty('--gold-mist', rgba(theme.accent, 0.06))
  style.setProperty('--star-changgeng', theme.accent)
  style.setProperty('--theme-panel-opacity', String(theme.panelOpacity))
  style.setProperty('--theme-backdrop-dim', String(theme.dim))
  style.setProperty('--theme-backdrop-focus-x', `${theme.focusX * 100}%`)
  style.setProperty('--theme-backdrop-focus-y', `${theme.focusY * 100}%`)
  style.setProperty(
    '--theme-backdrop-image',
    theme.background ? `url("${theme.background.url}")` : 'none',
  )
}

/** 应用用户选择：resolve → apply → 持久化 → dispatch。失败回退默认。 */
export function setThemeSelection(
  preferences: ThemePreferences,
  selection: ThemeSelection,
  storage: Storage | null = getDefaultStorage(),
  prefersDark: boolean = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
): ThemePreferences {
  const normalized = normalizeThemePreferences({ ...preferences, selection })
  const theme = resolveTheme(normalized, prefersDark)
  applyResolvedTheme(theme, normalized.selection)
  saveThemePreferences(normalized, storage)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { themeId: theme.id } }))
  }
  return normalized
}

export function resetThemePreferences(storage: Storage | null = getDefaultStorage()): ThemePreferences {
  const defaults = { ...DEFAULT_THEME_PREFERENCES, customThemes: [] }
  saveThemePreferences(defaults, storage)
  const theme = resolveTheme(defaults, matchPrefersDark())
  applyResolvedTheme(theme, defaults.selection)
  return defaults
}

function matchPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 启动前初始化：load → migrate → resolve → apply，并监听系统主题变化与跨窗口 storage。
 * 返回 cleanup，供测试与 HMR 使用。
 */
export function initializeThemePreferences(): () => void {
  const storage = getDefaultStorage()
  const preferences = loadThemePreferences(storage)
  const prefersDark = matchPrefersDark()
  const theme = resolveTheme(preferences, prefersDark)
  applyResolvedTheme(theme, preferences.selection)

  if (typeof window === 'undefined' || !window.matchMedia) return () => {}

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onMediaChange = (event: MediaQueryListEvent) => {
    const current = loadThemePreferences(storage)
    if (current.selection.mode === 'system') {
      const resolved = resolveTheme(current, event.matches)
      applyResolvedTheme(resolved, current.selection)
    }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_PREFERENCES_STORAGE_KEY) {
      const current = loadThemePreferences(storage)
      const resolved = resolveTheme(current, matchPrefersDark())
      applyResolvedTheme(resolved, current.selection)
    }
  }
  media.addEventListener('change', onMediaChange)
  window.addEventListener('storage', onStorage)
  return () => {
    media.removeEventListener('change', onMediaChange)
    window.removeEventListener('storage', onStorage)
  }
}
