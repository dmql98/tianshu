export type FontFamilyId = 'wenkai' | 'system-sans' | 'system-serif' | 'monospace'

export interface DisplayPreferences {
  fontFamily: FontFamilyId
  fontScale: number
  textColor: string
}

interface StoredDisplayPreferences extends DisplayPreferences {
  version: 1
}

export const DISPLAY_PREFERENCES_STORAGE_KEY = 'tianshu:displayPreferences'

export const FONT_FAMILIES: Record<FontFamilyId, string> = {
  wenkai: '"霞鹜文楷","LXGW WenKai","Kaiti SC","STKaiti",serif',
  'system-sans': 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
  'system-serif': '"Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif',
  monospace: 'Consolas,"Cascadia Code","SFMono-Regular","Courier New",monospace',
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  fontFamily: 'wenkai',
  fontScale: 100,
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

  return {
    fontFamily: typeof candidate.fontFamily === 'string' && FONT_FAMILY_IDS.has(candidate.fontFamily as FontFamilyId)
      ? candidate.fontFamily as FontFamilyId
      : DEFAULT_DISPLAY_PREFERENCES.fontFamily,
    fontScale: Math.min(140, Math.max(80, fontScale)),
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
    const stored: StoredDisplayPreferences = { version: 1, ...normalized }
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

export function applyDisplayPreferences(
  preferences: DisplayPreferences,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): DisplayPreferences {
  const normalized = normalizeDisplayPreferences(preferences)
  if (!root) return normalized

  const colors = deriveTextColors(normalized.textColor)
  root.style.setProperty('--ui-font-family', FONT_FAMILIES[normalized.fontFamily])
  root.style.setProperty('--ui-font-scale', String(normalized.fontScale / 100))
  root.style.setProperty('--ui-text-color', normalized.textColor)
  root.style.setProperty('--ink-deep', colors.deep)
  root.style.setProperty('--ink-mid', colors.mid)
  root.style.setProperty('--ink-light', colors.light)
  root.style.setProperty('--ink-faint', colors.faint)
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
