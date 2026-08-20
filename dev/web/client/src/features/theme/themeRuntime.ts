/**
 * 主题运行时：解析、应用、系统监听、跨窗口同步、失败回退与启动前初始化。
 *
 * 职责（TIANSHU_THEME_SWITCHING_PLAN §9）：
 * - resolve：system → 按 prefers-color-scheme 解析到内置浅/深；builtin → 固定内置；
 *   custom → 从服务端拉取的定义中查找，失败回退内置。
 * - apply：原子写入 html attributes（data-theme-selection/source/id/color-scheme）、
 *   `color-scheme`、注册 Token 与背景参数；切换自定义主题时先清除上一个自定义主题
 *   留下的 inline token（只能写注册变量）。
 * - 监听 matchMedia('(prefers-color-scheme: dark)')：只有 selection 为 system 时响应。
 * - 监听 storage 事件：其他窗口修改偏好后同步。
 * - 返回 cleanup，支持测试与 HMR。
 */
import {
  BUILTIN_THEME_DARK,
  BUILTIN_THEME_LIGHT,
  BUILTIN_THEMES,
  DEFAULT_HOME_TITLE,
  THEME_TOKEN_NAMES,
  type ThemeArtwork,
  type ThemeDefinition,
  type ThemeSelection,
  type ThemeTokens,
} from './themeDefinitions'
import {
  THEME_CHANGED_EVENT,
  THEME_PREFERENCES_STORAGE_KEY,
  getDefaultStorage,
  loadThemePreferences,
  normalizeThemePreferences,
  saveThemePreferences,
  type ThemePreferences,
} from './themePreferences'

export interface ThemeRuntimeDeps {
  storage?: Storage | null
  root?: HTMLElement | null
  /** 服务端拉取的自定义主题定义（缺省表示不可用，custom 选择回退内置）。 */
  customThemes?: ThemeDefinition[]
  prefersDark?: boolean
  /** 是否派发 tianshu:theme-changed 事件（测试可关闭）。 */
  dispatch?: boolean
}

export interface ResolvedTheme {
  theme: ThemeDefinition
  selection: ThemeSelection
}

// ── Token 注册表：runtime 只允许写这些变量（防任意 CSS 注入面） ──

/**
 * ThemeTokens 使用 camelCase，CSS 注册变量使用 kebab-case；数字前也需要连字符
 * （例如 surface1 → --theme-surface-1）。
 */
export function tokenVariableName(name: string): string {
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase()
  return `--theme-${kebab}`
}

/** 可写入 root style 的注册变量白名单。 */
export const REGISTERED_TOKEN_VARIABLES = THEME_TOKEN_NAMES.map(tokenVariableName)

const BACKDROP_VARIABLES = [
  '--theme-backdrop-image',
  '--theme-backdrop-home-opacity',
  '--theme-backdrop-task-opacity',
  '--theme-backdrop-dim',
  '--theme-backdrop-focus-x',
  '--theme-backdrop-focus-y',
  '--theme-backdrop-scale',
  '--theme-backdrop-flip-x',
  '--theme-backdrop-flip-y',
] as const

export function tokenVariableValue(tokens: ThemeTokens, name: string): string {
  return (tokens as unknown as Record<string, string>)[name] ?? ''
}

function getDefaultRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

function prefersDarkDefault(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ── 解析 ──

/**
 * 将用户选择解析为实际主题。
 * - system：prefersDark ? tianshu-dark : tianshu-light。
 * - builtin：查内置表；未知 ID 回退 system 解析结果。
 * - custom：在 customThemes 中查找；缺失/损坏回退 system 解析结果。
 */
export function resolveTheme(
  selection: ThemeSelection,
  prefersDark: boolean,
  customThemes: ThemeDefinition[] = [],
): ResolvedTheme {
  const fallback = (): ResolvedTheme => ({
    theme: prefersDark ? BUILTIN_THEME_DARK : BUILTIN_THEME_LIGHT,
    selection,
  })

  if (selection.mode === 'builtin') {
    const theme = BUILTIN_THEMES.find(t => t.id === selection.themeId)
    if (theme) return { theme, selection }
    return fallback()
  }

  if (selection.mode === 'custom') {
    const theme = customThemes.find(t => t.id === selection.themeId)
    if (theme) return { theme, selection }
    // 服务端主题不可用：回退内置，但不改变持久化的选择（下次拉取成功自动恢复）
    return { theme: prefersDark ? BUILTIN_THEME_DARK : BUILTIN_THEME_LIGHT, selection }
  }

  return fallback()
}

// ── 应用 ──

function clearInlineThemeTokens(root: HTMLElement): void {
  const style = root.style
  for (const variable of REGISTERED_TOKEN_VARIABLES) style.removeProperty(variable)
  for (const variable of BACKDROP_VARIABLES) style.removeProperty(variable)
  style.removeProperty('--theme-artwork-image')
  style.removeProperty('--theme-artwork-preview')
}

function applyTokens(tokens: ThemeTokens, source: ThemeDefinition['source'], root: HTMLElement): void {
  const style = root.style
  if (source === 'builtin') {
    // 内置主题的 token 由 index.css 按 data-color-scheme 提供，清掉 inline 残留。
    clearInlineThemeTokens(root)
    return
  }
  // 自定义主题：写全部注册 token，覆盖 CSS 默认；写入前不清理（全部覆盖写）。
  for (const name of THEME_TOKEN_NAMES) {
    const value = tokenVariableValue(tokens, name)
    if (value) style.setProperty(tokenVariableName(name), value)
  }
}

function applyBackdrop(artwork: ThemeArtwork | undefined, root: HTMLElement): void {
  const style = root.style
  if (artwork) {
    style.setProperty('--theme-artwork-image', `url("${artwork.url}")`)
    style.setProperty('--theme-artwork-preview', artwork.previewUrl ? `url("${artwork.previewUrl}")` : 'none')
    style.setProperty('--theme-backdrop-image', `url("${artwork.url}")`)
    style.setProperty('--theme-backdrop-home-opacity', String(artwork.homeOpacity))
    style.setProperty('--theme-backdrop-task-opacity', String(artwork.taskOpacity))
    style.setProperty('--theme-backdrop-dim', String(artwork.dim))
    style.setProperty('--theme-backdrop-focus-x', `${artwork.focusX * 100}%`)
    style.setProperty('--theme-backdrop-focus-y', `${artwork.focusY * 100}%`)
    style.setProperty('--theme-backdrop-scale', String(artwork.scale))
    style.setProperty('--theme-backdrop-flip-x', artwork.flipX === true ? '-1' : '1')
    style.setProperty('--theme-backdrop-flip-y', artwork.flipY === true ? '-1' : '1')
  } else {
    style.removeProperty('--theme-artwork-image')
    style.removeProperty('--theme-artwork-preview')
    style.removeProperty('--theme-backdrop-image')
    style.removeProperty('--theme-backdrop-home-opacity')
    style.removeProperty('--theme-backdrop-task-opacity')
    style.removeProperty('--theme-backdrop-dim')
    style.removeProperty('--theme-backdrop-focus-x')
    style.removeProperty('--theme-backdrop-focus-y')
    style.removeProperty('--theme-backdrop-scale')
    style.removeProperty('--theme-backdrop-flip-x')
    style.removeProperty('--theme-backdrop-flip-y')
  }
}

/**
 * 原子应用解析结果：attributes + color-scheme + tokens + backdrop。
 * 写完后读取关键属性确认（失败时由调用方回退）。
 */
export function applyResolvedTheme(
  resolved: ResolvedTheme,
  root: HTMLElement | null = getDefaultRoot(),
): void {
  if (!root) return
  const { theme, selection } = resolved

  root.setAttribute('data-theme-selection', selection.mode)
  root.setAttribute('data-theme-source', theme.source)
  root.setAttribute('data-theme-id', theme.id)
  root.setAttribute('data-color-scheme', theme.appearance)
  root.setAttribute('data-has-backdrop', theme.artwork ? 'true' : 'false')
  root.style.colorScheme = theme.appearance
  // 首页标题写入安全属性（HOME_PAGE_DEVELOPMENT_PLAN §6）：文本节点渲染，不注入 HTML
  root.dataset.homeTitle = theme.home?.title || DEFAULT_HOME_TITLE

  applyTokens(theme.tokens, theme.source, root)
  applyBackdrop(theme.artwork, root)
}

/** 读取当前已生效的主题 id（校验用）。 */
export function appliedThemeId(root: HTMLElement | null = getDefaultRoot()): string | null {
  return root?.getAttribute('data-theme-id') ?? null
}

/**
 * 读取当前已生效的首页标题；缺失/空白回退默认标题。
 * 首页初始化时调用，并监听 `tianshu:theme-changed` 事件后重新读取。
 */
export function appliedHomeTitle(root: HTMLElement | null = getDefaultRoot()): string {
  const value = root?.dataset.homeTitle
  return value && value.trim() ? value : DEFAULT_HOME_TITLE
}

// ── 切换 ──

/**
 * 应用用户选择：resolve → apply → 持久化 → dispatch。
 * 失败时回退上一有效主题（本实现 resolve/apply 无抛错路径，防御性 try）。
 */
export function setThemeSelection(
  preferences: ThemePreferences,
  selection: ThemeSelection,
  deps: ThemeRuntimeDeps = {},
): ThemePreferences {
  const storage = deps.storage !== undefined ? deps.storage : getDefaultStorage()
  const root = deps.root !== undefined ? deps.root : getDefaultRoot()
  const prefersDark = deps.prefersDark !== undefined ? deps.prefersDark : prefersDarkDefault()

  const normalized = normalizeThemePreferences({ ...preferences, selection })
  try {
    const resolved = resolveTheme(normalized.selection, prefersDark, deps.customThemes)
    applyResolvedTheme(resolved, root)
  } catch {
    // 防御：任何应用失败都回到内置浅色（默认安全主题）
    applyResolvedTheme({ theme: BUILTIN_THEME_LIGHT, selection: { mode: 'system' } }, root)
  }
  saveThemePreferences(normalized, storage)
  if (deps.dispatch !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, {
      detail: { themeId: appliedThemeId(root), selection: normalized.selection },
    }))
  }
  return normalized
}

export function resetThemePreferences(deps: ThemeRuntimeDeps = {}): ThemePreferences {
  const defaults: ThemePreferences = { version: 2, selection: { mode: 'system' } }
  return setThemePreferences(defaults, { mode: 'system' }, deps)
}

/** 兼容命名：应用一份完整偏好。 */
export function setThemePreferences(
  preferences: ThemePreferences,
  selection: ThemeSelection = preferences.selection,
  deps: ThemeRuntimeDeps = {},
): ThemePreferences {
  return setThemeSelection(preferences, selection, deps)
}

// ── 初始化 ──

/**
 * 启动前初始化：load → migrate → resolve → apply，并监听系统主题变化与跨窗口 storage。
 * 在 React 首次渲染前调用（main.tsx）。返回 cleanup。
 */
export function initializeThemeRuntime(deps: ThemeRuntimeDeps = {}): () => void {
  const storage = deps.storage !== undefined ? deps.storage : getDefaultStorage()
  const root = deps.root !== undefined ? deps.root : getDefaultRoot()
  const prefersDark = deps.prefersDark !== undefined ? deps.prefersDark : prefersDarkDefault()

  const preferences = loadThemePreferences(storage)
  const resolved = resolveTheme(preferences.selection, prefersDark, deps.customThemes)
  applyResolvedTheme(resolved, root)

  if (typeof window === 'undefined' || !window.matchMedia) return () => {}

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onMediaChange = (event: MediaQueryListEvent): void => {
    const current = loadThemePreferences(storage)
    if (current.selection.mode === 'system') {
      const next = resolveTheme(current.selection, event.matches, deps.customThemes)
      applyResolvedTheme(next, root)
    }
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key === THEME_PREFERENCES_STORAGE_KEY) {
      const current = loadThemePreferences(storage)
      const next = resolveTheme(current.selection, prefersDarkDefault(), deps.customThemes)
      applyResolvedTheme(next, root)
    }
  }

  const mediaListener = typeof media.addEventListener === 'function'
    ? () => media.addEventListener('change', onMediaChange)
    : () => media.addListener(onMediaChange as never)
  mediaListener()

  window.addEventListener('storage', onStorage)
  return () => {
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onMediaChange)
    window.removeEventListener('storage', onStorage)
  }
}
