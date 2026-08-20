/**
 * 主题 schema（TIANSHU_THEME_SWITCHING_PLAN §5.3 / §8）。
 *
 * 主题只允许声明结构化数据：身份、外观、素材相对路径、焦点/强度参数、
 * 颜色映射。不含任意 CSS / HTML / JS / 远程 URL。
 *
 * 服务端规则：
 * - `id` 由服务端生成（custom-<slug>），拒绝客户端提交的路径型/URL 型 ID。
 * - JSON 中素材路径必须是主题目录内相对文件名：禁止绝对路径、`..`、分隔符。
 * - `colors` 只接受注册的语义 Token 名（与客户端 ThemeTokens 对齐）。
 */

export const THEME_SCHEMA_VERSION = 1

export const REGISTERED_COLOR_SLOTS = [
  'canvas', 'surface1', 'surface2', 'surfaceHover', 'input', 'overlay',
  'border', 'borderSubtle', 'textPrimary', 'textSecondary', 'textMuted', 'textFaint',
  'textOnAccent', 'accent', 'accentHover', 'accentSoft', 'link', 'focusRing',
  'success', 'warning', 'danger', 'info', 'shadowColor', 'codeBg', 'scrollbar',
] as const

export type ColorSlot = (typeof REGISTERED_COLOR_SLOTS)[number]

export const REGISTERED_COLOR_SLOT_SET = new Set<string>(REGISTERED_COLOR_SLOTS)

export interface ThemeArtworkSpec {
  /** 主题目录内相对文件名（background.<ext>）。 */
  file?: string
  /** 主题目录内相对文件名（preview.webp）。 */
  preview?: string
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

/** 首页配置（HOME_PAGE_DEVELOPMENT_PLAN §5.1）：可选字段，向后兼容。 */
export interface ThemeHomeSpec {
  title: string
}

/** 首页标题最大长度（Unicode 码点）。 */
export const HOME_TITLE_MAX = 60

/**
 * 清洗首页标题：去控制字符 → trim → 截断到 60 个 Unicode 码点（不切代理对）。
 * 空字符串返回 ''（表示"未设置"，读取时回退默认标题）。
 */
export function normalizeHomeTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  const withoutControl = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const trimmed = withoutControl.trim()
  const chars = [...trimmed]
  return chars.slice(0, HOME_TITLE_MAX).join('')
}

export function normalizeThemeHome(value: unknown): ThemeHomeSpec | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { title?: unknown }
  const title = normalizeHomeTitle(candidate.title)
  return title ? { title } : undefined
}

export interface ThemeRecord {
  schemaVersion: typeof THEME_SCHEMA_VERSION
  id: string
  name: string
  appearance: 'light' | 'dark'
  artwork?: ThemeArtworkSpec
  /** 首页配置；旧主题缺少 home 时使用默认标题。 */
  home?: ThemeHomeSpec
  colors: Partial<Record<ColorSlot, string>>
  createdAt: string
  updatedAt: string
}

/** 服务端生成的主题 ID 形状（目录名）。 */
export function isValidThemeId(id: unknown): id is string {
  return typeof id === 'string' && /^custom-[a-z0-9-]{1,64}$/i.test(id)
}

export function generateThemeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'theme'
  const suffix = Math.random().toString(36).slice(2, 8)
  return `custom-${slug}-${suffix}`
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const CSS_COLOR_PATTERN = /^(#[0-9a-f]{6}|rgba?\([\d\s.,%]+\))$/i

export function isValidColorValue(value: unknown): value is string {
  return typeof value === 'string' && (HEX_COLOR_PATTERN.test(value) || CSS_COLOR_PATTERN.test(value))
}

/** 主题目录内的素材文件名：禁止路径分隔符、`..`、绝对路径和隐藏文件。 */
export function isValidAssetFileName(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  if (value.length > 128) return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  if (value.startsWith('.') || value.endsWith('.')) return false
  return /^[a-zA-Z0-9._-]+$/.test(value)
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function normalizeArtwork(value: unknown): ThemeArtworkSpec | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const artwork: ThemeArtworkSpec = {
    focusX: clampNumber(candidate.focusX, 0.5, 0, 1),
    focusY: clampNumber(candidate.focusY, 0.5, 0, 1),
    scale: clampNumber(candidate.scale, 1, 1, 2.5),
    homeOpacity: clampNumber(candidate.homeOpacity, 0.8, 0, 1),
    taskOpacity: clampNumber(candidate.taskOpacity, 0.35, 0, 1),
    dim: clampNumber(candidate.dim, 0.2, 0, 0.85),
    flipX: candidate.flipX === true,
    flipY: candidate.flipY === true,
  }
  if (isValidAssetFileName(candidate.file)) artwork.file = candidate.file
  if (isValidAssetFileName(candidate.preview)) artwork.preview = candidate.preview
  return artwork
}

function normalizeColors(value: unknown): Partial<Record<ColorSlot, string>> {
  const colors: Partial<Record<ColorSlot, string>> = {}
  if (!value || typeof value !== 'object') return colors
  const candidate = value as Record<string, unknown>
  for (const slot of REGISTERED_COLOR_SLOTS) {
    const raw = candidate[slot]
    if (isValidColorValue(raw)) colors[slot] = raw
  }
  return colors
}

/** 解析并规范化主题记录；非法返回 null（调用方回退/跳过）。 */
export function parseThemeRecord(raw: string, idFromDir?: string): ThemeRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>

  const id = idFromDir && isValidThemeId(idFromDir) ? idFromDir : candidate.id
  if (!isValidThemeId(id)) return null
  if (candidate.schemaVersion !== THEME_SCHEMA_VERSION) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  if (candidate.appearance !== 'light' && candidate.appearance !== 'dark') return null

  const colors = normalizeColors(candidate.colors)
  // 至少需要可用的核心色板（背景/文字/强调），否则视为损坏
  if (!colors.canvas || !colors.textPrimary || !colors.accent) return null

  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id,
    name: candidate.name.trim().slice(0, 80),
    appearance: candidate.appearance,
    artwork: normalizeArtwork(candidate.artwork),
    ...(normalizeThemeHome(candidate.home) ? { home: normalizeThemeHome(candidate.home) } : {}),
    colors,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  }
}

/** 构建一份待保存的主题记录（服务端侧校验过的输入）。 */
export function buildThemeRecord(input: {
  id: string
  name: string
  appearance: 'light' | 'dark'
  colors: unknown
  artwork?: unknown
  home?: unknown
}): ThemeRecord {
  const now = new Date().toISOString()
  return {
    schemaVersion: THEME_SCHEMA_VERSION,
    id: input.id,
    name: input.name.trim().slice(0, 80),
    appearance: input.appearance,
    colors: normalizeColors(input.colors),
    artwork: normalizeArtwork(input.artwork),
    ...(normalizeThemeHome(input.home) ? { home: normalizeThemeHome(input.home) } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

export function themeRecordToJson(record: ThemeRecord): string {
  return JSON.stringify(record, null, 2)
}
