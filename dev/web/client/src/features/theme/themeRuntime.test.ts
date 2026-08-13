import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_THEME_DARK,
  BUILTIN_THEME_DARK_ID,
  BUILTIN_THEME_LIGHT,
  BUILTIN_THEME_LIGHT_ID,
  type ThemeDefinition,
} from './themeDefinitions'
import { THEME_PREFERENCES_STORAGE_KEY, type ThemePreferences } from './themePreferences'
import {
  applyResolvedTheme,
  appliedThemeId,
  initializeThemeRuntime,
  resolveTheme,
  setThemeSelection,
  tokenVariableName,
} from './themeRuntime'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

interface FakeRoot {
  attributes: Map<string, string>
  properties: Map<string, string>
  colorScheme: string
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  removeAttribute(k: string): void
  style: {
    colorScheme: string
    setProperty(k: string, v: string): void
    removeProperty(k: string): void
    getPropertyValue(k: string): string
  }
}

function makeRoot(): FakeRoot {
  const attributes = new Map<string, string>()
  const properties = new Map<string, string>()
  return {
    attributes,
    properties,
    colorScheme: '',
    setAttribute: (k: string, v: string) => { attributes.set(k, v) },
    getAttribute: (k: string) => attributes.get(k) ?? null,
    removeAttribute: (k: string) => { attributes.delete(k) },
    style: {
      colorScheme: '',
      setProperty: (k: string, v: string) => { properties.set(k, v) },
      removeProperty: (k: string) => { properties.delete(k) },
      getPropertyValue: (k: string) => properties.get(k) ?? '',
    },
  }
}

interface FakeMediaQueryList {
  matches: boolean
  listener: ((e: { matches: boolean }) => void) | null
  addEventListener: (type: string, fn: (e: { matches: boolean }) => void) => void
  removeEventListener: () => void
  addListener: (fn: (e: { matches: boolean }) => void) => void
  removeListener: () => void
}

function makeMedia(matches: boolean): FakeMediaQueryList {
  const media: FakeMediaQueryList = {
    matches,
    listener: null,
    addEventListener: (_type: string, fn: (e: { matches: boolean }) => void) => { media.listener = fn },
    removeEventListener: () => { media.listener = null },
    addListener: (fn: (e: { matches: boolean }) => void) => { media.listener = fn },
    removeListener: () => { media.listener = null },
  }
  return media
}

function stubWindow(media: FakeMediaQueryList) {
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', {
    dispatchEvent,
    matchMedia: () => media,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  return { dispatchEvent }
}

const prefs: ThemePreferences = { version: 2, selection: { mode: 'system' } }

describe('themeRuntime: resolve', () => {
  it('system 在 prefersDark=false 时解析为浅色内置', () => {
    const resolved = resolveTheme({ mode: 'system' }, false)
    expect(resolved.theme.id).toBe(BUILTIN_THEME_LIGHT_ID)
    expect(resolved.theme.appearance).toBe('light')
  })

  it('system 在 prefersDark=true 时解析为深色内置', () => {
    const resolved = resolveTheme({ mode: 'system' }, true)
    expect(resolved.theme.id).toBe(BUILTIN_THEME_DARK_ID)
    expect(resolved.theme.appearance).toBe('dark')
  })

  it('builtin 固定选择不随系统变化', () => {
    expect(resolveTheme({ mode: 'builtin', themeId: BUILTIN_THEME_LIGHT_ID }, true).theme.id).toBe(BUILTIN_THEME_LIGHT_ID)
    expect(resolveTheme({ mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID }, false).theme.id).toBe(BUILTIN_THEME_DARK_ID)
  })

  it('未知 builtin ID 回退内置（不改变选择）', () => {
    const resolved = resolveTheme({ mode: 'builtin', themeId: 'ghost' as never }, true)
    expect(resolved.theme.id).toBe(BUILTIN_THEME_DARK_ID)
    expect(resolved.selection).toEqual({ mode: 'builtin', themeId: 'ghost' })
  })

  it('custom 在列表中找到时返回自定义主题', () => {
    const custom: ThemeDefinition = { ...BUILTIN_THEME_LIGHT, id: 'custom-forest', source: 'custom', name: '森林' }
    const resolved = resolveTheme({ mode: 'custom', themeId: 'custom-forest' }, false, [custom])
    expect(resolved.theme.id).toBe('custom-forest')
    expect(resolved.theme.source).toBe('custom')
  })

  it('custom 缺失时回退内置但保留选择', () => {
    const resolved = resolveTheme({ mode: 'custom', themeId: 'custom-gone' }, true, [])
    expect(resolved.theme.id).toBe(BUILTIN_THEME_DARK_ID)
    expect(resolved.selection).toEqual({ mode: 'custom', themeId: 'custom-gone' })
  })
})

describe('themeRuntime: apply', () => {
  it('将 camelCase Token 名映射为样式表使用的 kebab-case 变量', () => {
    expect(tokenVariableName('surface1')).toBe('--theme-surface-1')
    expect(tokenVariableName('surfaceHover')).toBe('--theme-surface-hover')
    expect(tokenVariableName('textPrimary')).toBe('--theme-text-primary')
    expect(tokenVariableName('textOnAccent')).toBe('--theme-text-on-accent')
    expect(tokenVariableName('codeBg')).toBe('--theme-code-bg')
  })

  it('写入正确 attributes 与 color-scheme', () => {
    const root = makeRoot()
    applyResolvedTheme({ theme: BUILTIN_THEME_DARK, selection: { mode: 'system' } }, root as unknown as HTMLElement)
    expect(root.getAttribute('data-theme-selection')).toBe('system')
    expect(root.getAttribute('data-theme-source')).toBe('builtin')
    expect(root.getAttribute('data-theme-id')).toBe(BUILTIN_THEME_DARK_ID)
    expect(root.getAttribute('data-color-scheme')).toBe('dark')
    expect(root.getAttribute('data-has-backdrop')).toBe('false')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('builtin 主题不写 inline token（由 CSS 提供）', () => {
    const root = makeRoot()
    applyResolvedTheme({ theme: BUILTIN_THEME_LIGHT, selection: { mode: 'builtin', themeId: BUILTIN_THEME_LIGHT_ID } }, root as unknown as HTMLElement)
    expect(root.style.getPropertyValue('--theme-canvas')).toBe('')
    expect(root.style.getPropertyValue('--theme-accent')).toBe('')
  })

  it('custom 主题写入全部注册 token 与背景参数', () => {
    const root = makeRoot()
    const custom: ThemeDefinition = {
      ...BUILTIN_THEME_DARK,
      id: 'custom-forest',
      source: 'custom',
      name: '森林',
      artwork: {
        url: 'http://localhost/api/themes/custom-forest/assets/background.webp',
        focusX: 0.3,
        focusY: 0.7,
        scale: 1.4,
        homeOpacity: 0.8,
        taskOpacity: 0.35,
        dim: 0.25,
      },
    }
    applyResolvedTheme({ theme: custom, selection: { mode: 'custom', themeId: 'custom-forest' } }, root as unknown as HTMLElement)
    expect(root.getAttribute('data-theme-source')).toBe('custom')
    expect(root.getAttribute('data-has-backdrop')).toBe('true')
    expect(root.style.getPropertyValue(tokenVariableName('canvas'))).toBe(custom.tokens.canvas)
    expect(root.style.getPropertyValue(tokenVariableName('accent'))).toBe(custom.tokens.accent)
    expect(root.style.getPropertyValue('--theme-surface-1')).toBe(custom.tokens.surface1)
    expect(root.style.getPropertyValue('--theme-text-primary')).toBe(custom.tokens.textPrimary)
    expect(root.style.getPropertyValue('--theme-border-subtle')).toBe(custom.tokens.borderSubtle)
    expect(root.style.getPropertyValue('--theme-backdrop-image')).toContain('background.webp')
    expect(root.style.getPropertyValue('--theme-backdrop-focus-x')).toBe('30%')
    expect(root.style.getPropertyValue('--theme-backdrop-focus-y')).toBe('70%')
    expect(root.style.getPropertyValue('--theme-backdrop-scale')).toBe('1.4')
  })

  it('切换 custom → builtin 时清除残留 inline token', () => {
    const root = makeRoot()
    const custom: ThemeDefinition = { ...BUILTIN_THEME_DARK, id: 'custom-a', source: 'custom', name: 'A' }
    applyResolvedTheme({ theme: custom, selection: { mode: 'custom', themeId: 'custom-a' } }, root as unknown as HTMLElement)
    expect(root.style.getPropertyValue('--theme-canvas')).not.toBe('')

    applyResolvedTheme({ theme: BUILTIN_THEME_LIGHT, selection: { mode: 'builtin', themeId: BUILTIN_THEME_LIGHT_ID } }, root as unknown as HTMLElement)
    expect(root.style.getPropertyValue('--theme-canvas')).toBe('')
    expect(root.style.getPropertyValue('--theme-backdrop-image')).toBe('')
    expect(root.getAttribute('data-theme-id')).toBe(BUILTIN_THEME_LIGHT_ID)
  })
})

describe('themeRuntime: setThemeSelection 持久化', () => {
  it('应用并持久化选择，dispatch 事件', () => {
    const storage = new MemoryStorage()
    const root = makeRoot()
    const { dispatchEvent } = stubWindow(makeMedia(false))
    setThemeSelection(prefs, { mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID }, {
      storage,
      root: root as unknown as HTMLElement,
      prefersDark: false,
    })
    const stored = JSON.parse(storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)
    expect(stored.selection).toEqual({ mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_DARK_ID)
    expect(dispatchEvent).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('custom 选择在主题不可用时不持久化失败（回退内置但仍保存选择）', () => {
    const storage = new MemoryStorage()
    const root = makeRoot()
    setThemeSelection(prefs, { mode: 'custom', themeId: 'custom-missing' }, {
      storage,
      root: root as unknown as HTMLElement,
      prefersDark: true,
      customThemes: [],
    })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_DARK_ID)
    const stored = JSON.parse(storage.getItem(THEME_PREFERENCES_STORAGE_KEY)!)
    expect(stored.selection).toEqual({ mode: 'custom', themeId: 'custom-missing' })
  })
})

describe('themeRuntime: initialize 与监听', () => {
  it('初始化应用当前偏好', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { mode: 'builtin', themeId: BUILTIN_THEME_DARK_ID },
    }))
    const root = makeRoot()
    const cleanup = initializeThemeRuntime({
      storage,
      root: root as unknown as HTMLElement,
      prefersDark: false,
    })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_DARK_ID)
    cleanup()
  })

  it('system 模式响应 matchMedia 变化', () => {
    const storage = new MemoryStorage()
    const root = makeRoot()
    const media = makeMedia(false)
    stubWindow(media)
    initializeThemeRuntime({ storage, root: root as unknown as HTMLElement, prefersDark: false })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_LIGHT_ID)
    media.listener?.({ matches: true })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_DARK_ID)
    vi.unstubAllGlobals()
  })

  it('builtin 固定选择不响应 matchMedia', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      selection: { mode: 'builtin', themeId: BUILTIN_THEME_LIGHT_ID },
    }))
    const root = makeRoot()
    const media = makeMedia(true)
    stubWindow(media)
    initializeThemeRuntime({ storage, root: root as unknown as HTMLElement, prefersDark: true })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_LIGHT_ID)
    media.listener?.({ matches: false })
    expect(appliedThemeId(root as unknown as HTMLElement)).toBe(BUILTIN_THEME_LIGHT_ID)
    vi.unstubAllGlobals()
  })
})
