/**
 * 主题数据模型 v2（TIANSHU_THEME_SWITCHING_PLAN §6 / §7）。
 *
 * 设计原则：
 * - 两个内置主题 `tianshu-light` / `tianshu-dark`；`system` 是选择模式，不是第三个主题。
 * - 主题只声明结构化数据（tokens + artwork 参数），不包含任意 CSS / HTML / JS。
 * - 自定义主题完整事实来源在服务端 <dataDir>/themes/<id>/；前端只缓存轻量 selection。
 * - 内置主题的 token 由 index.css 按 `data-color-scheme` 提供；自定义主题由
 *   themeRuntime 以受控的 root style 写入注册变量。
 */

export type Appearance = 'light' | 'dark'

export type BuiltinThemeId = 'tianshu-light' | 'tianshu-dark'

/** 主题选择：system 是自动模式；builtin 固定内置主题；custom 引用服务端自定义主题。 */
export type ThemeSelection =
  | { mode: 'system' }
  | { mode: 'builtin'; themeId: BuiltinThemeId }
  | { mode: 'custom'; themeId: string }

export type ThemeSource = 'builtin' | 'custom'

/**
 * 语义 Token（对应 CSS `--theme-*` 变量，见 index.css 迁移映射）。
 * 组件只消费这些 Token，不感知具体主题 ID。
 */
export interface ThemeTokens {
  canvas: string
  surface1: string
  surface2: string
  surfaceHover: string
  input: string
  overlay: string
  border: string
  borderSubtle: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textFaint: string
  textOnAccent: string
  accent: string
  accentHover: string
  accentSoft: string
  link: string
  focusRing: string
  success: string
  warning: string
  danger: string
  info: string
  shadowColor: string
  codeBg: string
  scrollbar: string
}

export const THEME_TOKEN_NAMES = [
  'canvas', 'surface1', 'surface2', 'surfaceHover', 'input', 'overlay',
  'border', 'borderSubtle', 'textPrimary', 'textSecondary', 'textMuted', 'textFaint',
  'textOnAccent', 'accent', 'accentHover', 'accentSoft', 'link', 'focusRing',
  'success', 'warning', 'danger', 'info', 'shadowColor', 'codeBg', 'scrollbar',
] as const

/** 背景素材与渲染参数。url 由服务端资产 API 提供（不存本地文件路径）。 */
export interface ThemeArtwork {
  url: string
  previewUrl?: string
  focusX: number
  focusY: number
  scale: number
  homeOpacity: number
  taskOpacity: number
  dim: number
  /** 水平/垂直镜像翻转（缺省视为 false）。 */
  flipX?: boolean
  flipY?: boolean
}

export interface ThemeDefinition {
  id: string
  source: ThemeSource
  name: string
  appearance: Appearance
  tokens: ThemeTokens
  artwork?: ThemeArtwork
  /** 首页配置（可选；旧主题/内置主题缺省时用 DEFAULT_HOME_TITLE）。 */
  home?: ThemeHome
  updatedAt?: string
}

/** 首页配置（HOME_PAGE_DEVELOPMENT_PLAN §5.1）。 */
export interface ThemeHome {
  title: string
}

/** 首页标题默认值（与服务端校验共用同一语义；服务端不主动写默认值）。 */
export const DEFAULT_HOME_TITLE = '早上好，今天想推进什么？'

/** 首页标题最大长度（Unicode 码点）。 */
export const HOME_TITLE_MAX = 60

/** 清洗首页标题：去控制字符 → trim → 截断（不切代理对）；空返回 ''。 */
export function normalizeHomeTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  const withoutControl = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const chars = [...withoutControl.trim()]
  return chars.slice(0, HOME_TITLE_MAX).join('')
}

export function normalizeThemeHome(value: unknown): ThemeHome | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { title?: unknown }
  const title = normalizeHomeTitle(candidate.title)
  return title ? { title } : undefined
}

export const BUILTIN_THEME_LIGHT_ID: BuiltinThemeId = 'tianshu-light'
export const BUILTIN_THEME_DARK_ID: BuiltinThemeId = 'tianshu-dark'

/** 浅色内置主题（延续既有暖纸色系，保证浅色视觉基线不变）。 */
export const BUILTIN_THEME_LIGHT: ThemeDefinition = {
  id: BUILTIN_THEME_LIGHT_ID,
  source: 'builtin',
  name: '天枢浅色',
  appearance: 'light',
  tokens: {
    canvas: '#f5f0e8',
    surface1: '#ede6da',
    surface2: '#e0d8cc',
    surfaceHover: '#e0d8cc',
    input: '#faf8f4',
    overlay: 'rgba(44,36,24,0.4)',
    border: 'rgba(180,160,130,0.15)',
    borderSubtle: 'rgba(180,160,130,0.08)',
    textPrimary: '#2c2418',
    textSecondary: '#5c5040',
    textMuted: '#8a7d68',
    textFaint: '#b8a890',
    textOnAccent: '#ffffff',
    accent: '#c8960a',
    accentHover: '#b08508',
    accentSoft: 'rgba(200,150,10,0.1)',
    link: '#c8960a',
    focusRing: 'rgba(200,150,10,0.55)',
    success: '#2a9d5c',
    warning: '#d97706',
    danger: '#c45c3c',
    info: '#2563eb',
    shadowColor: 'rgba(44,36,24,0.2)',
    codeBg: '#faf8f4',
    scrollbar: '#b8a890',
  },
}

/** 深色内置主题：完整深色 Token，保证真实可读的深色视觉。 */
export const BUILTIN_THEME_DARK: ThemeDefinition = {
  id: BUILTIN_THEME_DARK_ID,
  source: 'builtin',
  name: '天枢玄夜',
  appearance: 'dark',
  tokens: {
    canvas: '#17130e',
    surface1: '#201b14',
    surface2: '#2a2319',
    surfaceHover: '#32291d',
    input: '#1c1710',
    overlay: 'rgba(0,0,0,0.55)',
    border: 'rgba(255,235,200,0.12)',
    borderSubtle: 'rgba(255,235,200,0.07)',
    textPrimary: '#f2ead9',
    textSecondary: '#c9bda6',
    textMuted: '#998d78',
    textFaint: '#6b6253',
    textOnAccent: '#17130e',
    accent: '#e0b341',
    accentHover: '#f0c35c',
    accentSoft: 'rgba(224,179,65,0.16)',
    link: '#e0b341',
    focusRing: 'rgba(224,179,65,0.6)',
    success: '#4caf7d',
    warning: '#e8933c',
    danger: '#e0735a',
    info: '#6b9ff3',
    shadowColor: 'rgba(0,0,0,0.5)',
    codeBg: '#17130e',
    scrollbar: '#4a4134',
  },
}

export const BUILTIN_THEMES: ThemeDefinition[] = [BUILTIN_THEME_LIGHT, BUILTIN_THEME_DARK]

const BUILTIN_IDS = new Set<string>(BUILTIN_THEMES.map(t => t.id))

export function isBuiltinThemeId(id: string): id is BuiltinThemeId {
  return BUILTIN_IDS.has(id)
}

/** 服务端自定义主题 ID 形如 `custom-<slug>`；拒绝任何路径型 ID。 */
export function isCustomThemeId(id: string): boolean {
  return typeof id === 'string' && /^custom-[a-z0-9-]{1,64}$/i.test(id)
}

export function isThemeSelection(value: unknown): value is ThemeSelection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { mode?: unknown; themeId?: unknown }
  if (candidate.mode === 'system') return true
  if (candidate.mode === 'builtin') return typeof candidate.themeId === 'string' && isBuiltinThemeId(candidate.themeId)
  if (candidate.mode === 'custom') return typeof candidate.themeId === 'string' && candidate.themeId.length > 0
  return false
}

export const DEFAULT_THEME_SELECTION: ThemeSelection = { mode: 'system' }

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

export function isCssColor(value: unknown): value is string {
  return typeof value === 'string' && (
    HEX_COLOR_PATTERN.test(value) ||
    /^rgba?\([\d\s.,%]+\)$/i.test(value)
  )
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(typeof value === 'number' ? value : fallback, min, max)
}

/** 校验并规范化一个 color token；非法值回退。 */
function normalizeToken(value: unknown, fallback: string): string {
  return isCssColor(value) ? value : fallback
}

/** 从任意对象提取 tokens；缺省用内置主题对应外观的 token。 */
export function normalizeThemeTokens(value: unknown, appearance: Appearance): ThemeTokens {
  const base = appearance === 'dark' ? BUILTIN_THEME_DARK.tokens : BUILTIN_THEME_LIGHT.tokens
  if (!value || typeof value !== 'object') return { ...base }
  const candidate = value as Partial<Record<keyof ThemeTokens, unknown>>
  const result = { ...base } as ThemeTokens
  for (const key of THEME_TOKEN_NAMES) {
    const fallback = base[key]
    const raw = candidate[key]
    if (isCssColor(raw)) result[key] = raw as string
    else if (key === 'canvas' || key === 'surface1' || key === 'surface2' || key === 'surfaceHover' || key === 'input') {
      // 表面色必须是不透明或接近不透明的颜色；rgba 表面色允许但保持 fallback 语义
      result[key] = isCssColor(raw) ? raw as string : fallback
    }
  }
  return result
}

export function normalizeAppearance(value: unknown): Appearance {
  return value === 'dark' ? 'dark' : 'light'
}

export function normalizeArtwork(value: unknown): ThemeArtwork | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<ThemeArtwork>
  if (typeof candidate.url !== 'string' || !candidate.url) return undefined
  return {
    url: candidate.url,
    previewUrl: typeof candidate.previewUrl === 'string' ? candidate.previewUrl : undefined,
    focusX: normalizeNumber(candidate.focusX, 0.5, 0, 1),
    focusY: normalizeNumber(candidate.focusY, 0.5, 0, 1),
    scale: normalizeNumber(candidate.scale, 1, 1, 2.5),
    homeOpacity: normalizeNumber(candidate.homeOpacity, 0.8, 0, 1),
    taskOpacity: normalizeNumber(candidate.taskOpacity, 0.35, 0, 1),
    dim: normalizeNumber(candidate.dim, 0.2, 0, 0.85),
    flipX: candidate.flipX === true,
    flipY: candidate.flipY === true,
  }
}

/**
 * 校验并规范化一份主题定义；不合法时返回 null（调用方回退）。
 * 不校验 themeId 是否存在（由调用方/服务端决定回退策略）。
 */
export function normalizeThemeDefinition(value: unknown): ThemeDefinition | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ThemeDefinition>
  if (typeof candidate.id !== 'string' || !candidate.id) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  const appearance = normalizeAppearance(candidate.appearance)
  const source: ThemeSource = candidate.source === 'custom' ? 'custom' : 'builtin'
  return {
    id: candidate.id,
    source,
    name: candidate.name.trim(),
    appearance,
    tokens: normalizeThemeTokens(candidate.tokens, appearance),
    artwork: normalizeArtwork(candidate.artwork),
    ...(normalizeThemeHome(candidate.home) ? { home: normalizeThemeHome(candidate.home) } : {}),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined,
  }
}

/** 旧计划内置主题 ID → 新内置主题 ID 的迁移映射。 */
export const LEGACY_BUILTIN_ID_MAP: Record<string, BuiltinThemeId> = {
  'tianshu-paper': BUILTIN_THEME_LIGHT_ID,
  'tianshu-night': BUILTIN_THEME_DARK_ID,
}

export function migrateLegacyBuiltinId(id: string): BuiltinThemeId | null {
  if (isBuiltinThemeId(id)) return id
  return LEGACY_BUILTIN_ID_MAP[id] ?? null
}
