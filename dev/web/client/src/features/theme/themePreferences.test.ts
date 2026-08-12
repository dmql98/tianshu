import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_THEME_NIGHT,
  BUILTIN_THEME_PAPER,
  BUILTIN_THEME_PAPER_ID,
  BUILTIN_THEME_NIGHT_ID,
} from './themeDefinitions'
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_PREFERENCES_STORAGE_KEY,
  applyResolvedTheme,
  createCustomTheme,
  deleteCustomTheme,
  getThemeDefinition,
  initializeThemePreferences,
  loadThemePreferences,
  migrateLegacyThemeSelection,
  normalizeThemePreferences,
  resetThemePreferences,
  resolveTheme,
  saveThemePreferences,
  setThemeSelection,
  upsertCustomTheme,
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

function makeRoot() {
  const attributes = new Map<string, string>()
  const properties = new Map<string, string>()
  return {
    setAttribute: (key: string, value: string) => { attributes.set(key, value) },
    getAttribute: (key: string) => attributes.get(key) ?? null,
    style: {
      colorScheme: '',
      setProperty: (key: string, value: string) => { properties.set(key, value) },
      getPropertyValue: (key: string) => properties.get(key) ?? '',
    },
  }
}

const customTheme = createCustomTheme({
  name: '星海',
  appearance: 'dark',
  accent: '#3b82f6',
  background: { source: 'data', url: 'data:image/png;base64,AAAA' },
  panelOpacity: 0.8,
  dim: 0.4,
  focusX: 0.3,
  focusY: 0.7,
})

const prefsWithCustom: ThemePreferences = {
  version: 1,
  selection: { mode: 'fixed', themeId: customTheme.id },
  customThemes: [customTheme],
}

describe('themePreferences: 存储与回退', () => {
  it('空存储返回 system 默认', () => {
    const storage = new MemoryStorage()
    expect(loadThemePreferences(storage)).toEqual({ version: 1, selection: { mode: 'system' }, customThemes: [] })
  })

  it('损坏 JSON、未知字段安全回退', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, '{broken')
    expect(loadThemePreferences(storage).selection).toEqual({ mode: 'system' })

    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 99,
      selection: { mode: 'fixed', themeId: 'no-such-theme' },
      customThemes: [{ id: 42 }],
    }))
    const loaded = loadThemePreferences(storage)
    // normalize 保留结构（id 存在性由 resolve 阶段校验）；非法 custom theme 被过滤
    expect(loaded.customThemes).toEqual([])
    // 未知 themeId 在 resolve 时安全回退 system
    expect(resolveTheme(loaded, false).id).toBe(BUILTIN_THEME_PAPER_ID)
  })

  it('未知 themeId 的 fixed selection 归一化后回退 system', () => {
    const prefs = normalizeThemePreferences({
      selection: { mode: 'fixed', themeId: 'ghost' },
      customThemes: [],
    })
    expect(prefs.selection).toEqual({ mode: 'fixed', themeId: 'ghost' })
    // resolve 阶段回退
    expect(resolveTheme(prefs, false).id).toBe(BUILTIN_THEME_PAPER_ID)
    expect(resolveTheme(prefs, true).id).toBe(BUILTIN_THEME_NIGHT_ID)
  })

  it('保存后可原样加载', () => {
    const storage = new MemoryStorage()
    saveThemePreferences(prefsWithCustom, storage)
    expect(loadThemePreferences(storage)).toEqual(prefsWithCustom)
  })
})

describe('themePreferences: 旧键迁移', () => {
  it('light -> fixed paper；dark -> fixed night；system -> system', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'light')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'fixed', themeId: BUILTIN_THEME_PAPER_ID })

    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'fixed', themeId: BUILTIN_THEME_NIGHT_ID })

    storage.setItem(LEGACY_THEME_STORAGE_KEY, 'system')
    expect(migrateLegacyThemeSelection(storage)?.selection).toEqual({ mode: 'system' })
  })

  it('无旧键时不产生迁移', () => {
    const storage = new MemoryStorage()
    expect(migrateLegacyThemeSelection(storage)).toBeNull()
  })
})

describe('themePreferences: 解析', () => {
  it('system 跟随 prefersDark', () => {
    const prefs = { version: 1 as const, selection: { mode: 'system' as const }, customThemes: [] }
    expect(resolveTheme(prefs, false).id).toBe(BUILTIN_THEME_PAPER_ID)
    expect(resolveTheme(prefs, true).id).toBe(BUILTIN_THEME_NIGHT_ID)
  })

  it('fixed 主题不随系统变化', () => {
    const prefs = { version: 1 as const, selection: { mode: 'fixed' as const, themeId: BUILTIN_THEME_PAPER_ID }, customThemes: [] }
    expect(resolveTheme(prefs, true).id).toBe(BUILTIN_THEME_PAPER_ID)
  })

  it('fixed 自定义主题可解析，删除后回退 system', () => {
    expect(getThemeDefinition(prefsWithCustom, customTheme.id)).toEqual(customTheme)
    const afterDelete = deleteCustomTheme(prefsWithCustom, customTheme.id)
    expect(afterDelete.selection).toEqual({ mode: 'system' })
    expect(resolveTheme(afterDelete, true).id).toBe(BUILTIN_THEME_NIGHT_ID)
  })
})

describe('themePreferences: 自定义主题 CRUD', () => {
  it('创建时生成唯一 custom id 并保留参数', () => {
    expect(customTheme.id.startsWith('custom:')).toBe(true)
    expect(customTheme.name).toBe('星海')
    expect(customTheme.background?.source).toBe('data')
    expect(customTheme.panelOpacity).toBe(0.8)
    expect(customTheme.dim).toBe(0.4)
  })

  it('upsert 同 id 覆盖，不同 id 追加', () => {
    const updated = { ...customTheme, name: '星海 v2' }
    const a = upsertCustomTheme(prefsWithCustom, updated)
    expect(a.customThemes).toHaveLength(1)
    expect(a.customThemes[0].name).toBe('星海 v2')

    const another = createCustomTheme({ name: '晨曦', appearance: 'light', accent: '#c8960a', panelOpacity: 1, dim: 0, focusX: 0.5, focusY: 0.5 })
    const b = upsertCustomTheme(prefsWithCustom, another)
    expect(b.customThemes).toHaveLength(2)
  })
})

describe('themePreferences: 应用', () => {
  it('写入正确的 data attributes 与 color-scheme', () => {
    const root = makeRoot() as unknown as HTMLElement
    applyResolvedTheme(BUILTIN_THEME_NIGHT, { mode: 'fixed', themeId: BUILTIN_THEME_NIGHT_ID }, root)
    expect(root.getAttribute('data-theme-selection')).toBe('fixed')
    expect(root.getAttribute('data-theme-id')).toBe(BUILTIN_THEME_NIGHT_ID)
    expect(root.getAttribute('data-color-scheme')).toBe('dark')
    expect(root.getAttribute('data-has-backdrop')).toBe('false')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('背景主题写入 backdrop 变量与强调色', () => {
    const root = makeRoot() as unknown as HTMLElement
    applyResolvedTheme(customTheme, { mode: 'fixed', themeId: customTheme.id }, root)
    expect(root.getAttribute('data-has-backdrop')).toBe('true')
    const style = root.style as unknown as { getPropertyValue(key: string): string }
    expect(style.getPropertyValue('--theme-backdrop-image')).toContain('data:image/png')
    expect(style.getPropertyValue('--theme-backdrop-dim')).toBe('0.4')
    expect(style.getPropertyValue('--theme-panel-opacity')).toBe('0.8')
    expect(style.getPropertyValue('--theme-accent')).toBe('#3b82f6')
    expect(style.getPropertyValue('--gold')).toBe('#3b82f6')
    expect(style.getPropertyValue('--theme-backdrop-focus-x')).toBe('30%')
  })

  it('setThemeSelection 持久化并 dispatch 事件', () => {
    const storage = new MemoryStorage()
    const listener = vi.fn()
    const originalDispatch = globalThis.window?.dispatchEvent
    const fakeWindow = {
      matchMedia: () => ({ matches: false }),
      dispatchEvent: listener,
    }
    vi.stubGlobal('window', fakeWindow)
    try {
      const next = setThemeSelection({ version: 1, selection: { mode: 'system' }, customThemes: [] }, { mode: 'fixed', themeId: BUILTIN_THEME_PAPER_ID }, storage)
      expect(next.selection).toEqual({ mode: 'fixed', themeId: BUILTIN_THEME_PAPER_ID })
      const saved = JSON.parse(storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)
      expect(saved.selection.mode).toBe('fixed')
      expect(listener).toHaveBeenCalled()
    } finally {
      if (originalDispatch) vi.stubGlobal('window', originalDispatch)
      else vi.unstubAllGlobals()
    }
  })

  it('reset 恢复默认且不触碰自定义主题之外的设置', () => {
    const storage = new MemoryStorage()
    saveThemePreferences({ version: 1, selection: { mode: 'fixed', themeId: customTheme.id }, customThemes: [customTheme] }, storage)
    const defaults = resetThemePreferences(storage)
    expect(defaults.selection).toEqual({ mode: 'system' })
    const saved = JSON.parse(storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)
    expect(saved.selection).toEqual({ mode: 'system' })
  })
})

describe('themePreferences: 初始化', () => {
  it('无浏览器环境时返回空 cleanup', () => {
    const cleanup = initializeThemePreferences()
    expect(typeof cleanup).toBe('function')
  })

  it('浏览器环境注册监听并返回 cleanup（可重复调用）', () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener, removeEventListener }))
    vi.stubGlobal('window', { matchMedia, addEventListener, removeEventListener })
    vi.stubGlobal('document', { documentElement: makeRoot() })
    try {
      const cleanup = initializeThemePreferences()
      expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
      expect(addEventListener).toHaveBeenCalled()
      cleanup()
      expect(removeEventListener).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
