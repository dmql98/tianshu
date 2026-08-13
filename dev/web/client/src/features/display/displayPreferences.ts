import { contrastRatio } from '../theme/contrast'

export type FontFamilyId = 'wenkai' | 'system-sans' | 'system-serif' | 'monospace'

export type TextColorMode = 'theme' | 'custom'

export interface DisplayPreferences {
  fontFamily: FontFamilyId
  fontScale: number
  /**
   * 'theme'：文字颜色由当前主题控制（深色主题下自动使用浅色文字），不写 --ink-*；
   * 'custom'：用户显式自定义文字颜色，覆盖主题文字层级。
   */
  textColorMode: TextColorMode
  /** custom 模式下的文字颜色；theme 模式下保留但不生效。 */
  textColor: string
}

interface StoredDisplayPreferences extends DisplayPreferences {
  version: 2
}

export const DISPLAY_PREFERENCES_STORAGE_KEY = 'tianshu:displayPreferences'

export const FONT_FAMILIES: Record<FontFamilyId, string> = {
  wenkai: '"霞鹜文楷","LXGW WenKai","Kaiti SC","STKaiti",serif',
  'system-sans': 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
  'system-serif': '"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif',
  monospace: 'Consolas,"Cascadia Code","SFMono-Regular","Courier New",monospace',
}

/** v1 默认文字色（浅色棕）。v1 -> v2 迁移时：等于该值视为未自定义 -> theme 模式。 */
export const LEGACY_DEFAULT_TEXT_COLOR = '#2c2418'

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  fontFamily: 'wenkai',
  fontScale: 100,
  textColorMode: 'theme',
  textColor: '#2c2418',
}

const FONT_FAMILY_IDS = new Set<FontFamilyId>(Object.keys(FONT_FAMILIES) as FontFamilyId[])
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

export function normalizeDisplayPreferences(value: unknown): DisplayPreferences {
  const candidate = value && typeof value === 'object'
    ? value as Partial<DisplayPreferences>
    : {}
  const fontScale = typeof candidate.fontScale === 'number' && Number.isFinite(candidate.fontScale)
    ? Math.round(candidate.fontScale)
    : DEFAULT_DISPLAY_PREFERENCES.fontScale
  // v1 存储没有 textColorMode：textColor 为有效非默认值视为用户自定义过
  const legacyCustom = candidate.textColorMode === undefined
    && isValidHexColor(candidate.textColor)
    && candidate.textColor.toLowerCase() !== LEGACY_DEFAULT_TEXT_COLOR
  const textColorMode: TextColorMode = legacyCustom || candidate.textColorMode === 'custom'
    ? 'custom'
    : 'theme'

  return {
    fontFamily: typeof candidate.fontFamily === 'string' && FONT_FAMILY_IDS.has(candidate.fontFamily as FontFamilyId)
      ? candidate.fontFamily as FontFamilyId
      : DEFAULT_DISPLAY_PREFERENCES.fontFamily,
    fontScale: Math.min(140, Math.max(80, fontScale)),
    textColorMode,
    textColor: isValidHexColor(candidate.textColor)
      ? candidate.textColor.toLowerCase()
      : DEFAULT_DISPLAY_PREFERENCES.textColor,
  }
}

function getDefaultStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function loadDisplayPreferences(storage: Storage | null = getDefaultStorage()): DisplayPreferences {
  if (!storage) return { ...DEFAULT_DISPLAY_PREFERENCES }
  try {
    const raw = storage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)
    return raw ? normalizeDisplayPreferences(JSON.parse(raw)) : { ...DEFAULT_DISPLAY_PREFERENCES }
  } catch {
    return { ...DEFAULT_DISPLAY_PREFERENCES }
  }
}

export function saveDisplayPreferences(
  preferences: DisplayPreferences,
  storage: Storage | null = getDefaultStorage(),
): DisplayPreferences {
  const normalized = normalizeDisplayPreferences(preferences)
  if (storage) {
    const stored: StoredDisplayPreferences = { version: 2, ...normalized }
    storage.setItem(DISPLAY_PREFERENCES_STORAGE_KEY, JSON.stringify(stored))
  }
  return normalized
}

function offsetColor(hex: string, offset: [number, number, number]): string {
  const channels = [1, 3, 5].map((start, index) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) + offset[index]
    return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}

export function deriveTextColors(textColor: string): Record<'deep' | 'mid' | 'light' | 'faint', string> {
  const normalized = isValidHexColor(textColor)
    ? textColor.toLowerCase()
    : DEFAULT_DISPLAY_PREFERENCES.textColor
  return {
    deep: normalized,
    mid: offsetColor(normalized, [48, 44, 40]),
    light: offsetColor(normalized, [94, 89, 80]),
    faint: offsetColor(normalized, [140, 132, 120]),
  }
}

/**
 * 自定义文字颜色与给定背景的 WCAG 对比度（用于设置页提示）。
 * 只接受 #RRGGBB；非法输入返回 0。
 */
export function textColorContrastOn(textColor: string, background: string): number {
  if (!isValidHexColor(textColor) || !/^#[0-9a-f]{6}$/i.test(background)) return 0
  return contrastRatio(textColor.toLowerCase(), background.toLowerCase())
}

export function applyDisplayPreferences(
  preferences: DisplayPreferences,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): DisplayPreferences {
  const normalized = normalizeDisplayPreferences(preferences)
  if (!root) return normalized

  const style = root.style
  style.setProperty('--ui-font-family', FONT_FAMILIES[normalized.fontFamily])
  style.setProperty('--ui-font-scale', String(normalized.fontScale / 100))
  style.setProperty('--ui-text-color', normalized.textColor)

  if (normalized.textColorMode === 'custom') {
    const colors = deriveTextColors(normalized.textColor)
    style.setProperty('--ink-deep', colors.deep)
    style.setProperty('--ink-mid', colors.mid)
    style.setProperty('--ink-light', colors.light)
    style.setProperty('--ink-faint', colors.faint)
  } else {
    // theme 模式：移除内联覆盖，由当前主题的 CSS 变量控制文字层级
    style.removeProperty('--ink-deep')
    style.removeProperty('--ink-mid')
    style.removeProperty('--ink-light')
    style.removeProperty('--ink-faint')
  }
  return normalized
}

export function resetDisplayPreferences(storage: Storage | null = getDefaultStorage()): DisplayPreferences {
  const defaults = { ...DEFAULT_DISPLAY_PREFERENCES }
  saveDisplayPreferences(defaults, storage)
  applyDisplayPreferences(defaults)
  return defaults
}

export function initializeDisplayPreferences(): () => void {
  applyDisplayPreferences(loadDisplayPreferences())
  if (typeof window === 'undefined') return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (event.key === DISPLAY_PREFERENCES_STORAGE_KEY) {
      applyDisplayPreferences(loadDisplayPreferences())
    }
  }
  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}
