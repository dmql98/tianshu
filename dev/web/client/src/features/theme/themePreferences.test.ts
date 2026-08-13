import { describe, expect, it } from 'vitest'
import { BUILTIN_THEME_DARK_ID, BUILTIN_THEME_LIGHT_ID } from './themeDefinitions'
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_PREFERENCES_STORAGE_KEY,
  loadThemePreferences,
  migrateLegacyThemeSelection,
  normalizeThemePreferences,
  normalizeThemeSelection,
  saveThemePreferences,
  type ThemePreferences,
} from './themePreferences'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('themePreferences v2: 存储与回退', () => {
  it('空存储返回 system 默认', () => {
    const storage = new MemoryStorage()
    expect(loadThemePreferences(storage)).toEqual({ version: 2, selection: { mode: 'system' } })
  })

  it('损坏 JSON 安全回退 system', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, '{broken')
    expect(loadThemePreferences(storage).selection).toEqual({ mode: 'system' })
  })

  it('未知版本回退 system', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 99,
      selection: { mode: 'builtin', themeId: 'tianshu-light' },
    }))
    // 未来版本格式未知：安全回退 system
    expect(loadThemePreferences(storage).selection).toEqual({ mode: 'system' })
  })

  it('未知 builtin themeId 回退 system', () => {
    expect(normalizeThemeSelection({ mode: 'builtin', themeId: 'ghost-theme' })).toEqual({ mode: 'system' })
    expect(normalizeThemeSelection({ mode: 'builtin', themeId: 'tianshu-starry' })).toEqual({ mode: 'system' })
  })

  it('custom selection 拒绝路径/URL 型 ID', () => {
    expect(normalizeThemeSelection({ mode: 'custom', themeId: '../../etc/passwd' })).toEqual({ mode: 'system' })
    expect(normalizeThemeSelection({ mode: 'custom', themeId: 'https://evil.example/x' })).toEqual({ mode: 'system' })
    expect(normalizeThemeSelection({ mode: 'custom', themeId: 'custom-forest' })).toEqual({ mode: 'custom', themeId: 'custom-forest' })
  })

  it('保存后 round-trip 一致', () => {
    const storage = new MemoryStorage()
    const prefs: ThemePreferences = { version: 2, selection: { mode: 'builtin', themeId: 'tianshu-dark' } }
    saveThemePreferences(prefs, storage)
    expect(loadThemePreferences(storage)).toEqual(prefs)
  })

  it('v2 偏好只包含轻量 selection（不携带自定义主题内容）', () => {
    const storage = new MemoryStorage()
    saveThemePreferences({ version: 2, selection: { mode: 'custom', themeId: 'custom-forest' } }, storage)
    const raw = storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ version: 2, selection: { mode: 'custom', themeId: 'custom-forest' } })
    expect(parsed.customThemes).toBeUndefined()
  })
})

describe('themePreferences v2: 旧键迁移', () => {
  it('tianshu:theme=light → builtin tianshu-light', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'light')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'builtin', themeId: BUILTIN_THEME_LIGHT_ID })
  })

  it('tianshu:theme=dark → builtin tianshu-dark', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID })
  })

  it('tianshu:theme=system → system', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'system')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'system' })
  })

  it('旧计划 ID tianshu-paper → tianshu-light', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'tianshu-paper')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'builtin', themeId: BUILTIN_THEME_LIGHT_ID })
  })

  it('旧计划 ID tianshu-night → tianshu-dark', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'tianshu-night')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID })
  })

  it('旧计划 ID tianshu-starry（不再内置）→ system', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'tianshu-starry')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'system' })
  })

  it('无旧键返回 null（不写新键）', () => {
    const storage = new MemoryStorage()
    expect(migrateLegacyThemeSelection(storage)).toBeNull()
  })

  it('load 在 v2 键缺失时走旧键迁移', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    const loaded = loadThemePreferences(storage)
    expect(loaded.selection).toEqual({ mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID })
    expect(storage.getItem(THEME_PREFERENCES_STORAGE_KEY)).toBeTruthy()
  })
})

describe('themePreferences v2: 规范化', () => {
  it('normalizeThemePreferences 丢弃未知字段', () => {
    const prefs = normalizeThemePreferences({
      version: 2,
      selection: { mode: 'system' },
      customThemes: [{ id: 'x', name: 'y' }],
      extra: 42,
    } as unknown)
    expect(prefs).toEqual({ version: 2, selection: { mode: 'system' } })
  })

  it('非对象输入回退默认', () => {
    expect(normalizeThemePreferences(null)).toEqual({ version: 2, selection: { mode: 'system' } })
    expect(normalizeThemePreferences('nope')).toEqual({ version: 2, selection: { mode: 'system' } })
  })
})
