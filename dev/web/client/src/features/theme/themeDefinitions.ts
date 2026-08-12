/**
 * 主题定义：内置主题与自定义主题的共享数据模型。
 *
 * 设计原则（对齐 TIANSHU_THEME_SWITCHING_PLAN.md）：
 * - 主题不直接覆盖组件选择器，只声明原始参数（appearance / accent / backdrop 等）。
 * - 自定义主题 = 深浅壳（appearance）+ 背景图 + 装饰参数，基础 token 由 CSS 按
 *   `data-color-scheme` 提供，避免每个主题重复声明 100+ 变量。
 * - 背景图只允许本地资源：桌面端经 `tianshu-bg://` 协议访问落盘文件，
 *   浏览器模式降级为 dataURL。不引入远程 URL。
 */

export type Appearance = 'light' | 'dark'

/** 背景图来源：desktop-file = Electron 落盘文件（tianshu-bg://）；data = dataURL（浏览器模式） */
export type BackgroundSource = 'desktop-file' | 'data'

export interface ThemeBackground {
  source: BackgroundSource
  url: string
}

/** 面板不透明度 / 背景暗化 / 焦点的取值范围 */
export const PANEL_OPACITY_MIN = 0.55
export const PANEL_OPACITY_MAX = 1
export const DIM_MIN = 0
export const DIM_MAX = 0.85

export interface ThemeDefinition {
  /** 唯一 id：内置为 'tianshu-paper' | 'tianshu-night'；自定义为 'custom:<uuid>' */
  id: string
  name: string
  appearance: Appearance
  /** 强调色 #RRGGBB，会映射到 --gold / --star-changgeng 等现有变量 */
  accent: string
  /** 背景图；缺省表示纯色主题 */
  background?: ThemeBackground
  /** 面板不透明度 0.55-1，1 为实色 */
  panelOpacity: number
  /** 背景暗化遮罩 0-0.85，0 不暗化 */
  dim: number
  /** 背景视觉焦点（0-1，相对图片宽高比） */
  focusX: number
  focusY: number
  builtin: boolean
}

export const BUILTIN_THEME_PAPER_ID = 'tianshu-paper'
export const BUILTIN_THEME_NIGHT_ID = 'tianshu-night'

export const BUILTIN_THEME_PAPER: ThemeDefinition = {
  id: BUILTIN_THEME_PAPER_ID,
  name: '天枢宣纸',
  appearance: 'light',
  accent: '#c8960a',
  panelOpacity: 1,
  dim: 0,
  focusX: 0.5,
  focusY: 0.5,
  builtin: true,
}

export const BUILTIN_THEME_NIGHT: ThemeDefinition = {
  id: BUILTIN_THEME_NIGHT_ID,
  name: '天枢玄夜',
  appearance: 'dark',
  accent: '#c8960a',
  panelOpacity: 1,
  dim: 0,
  focusX: 0.5,
  focusY: 0.5,
  builtin: true,
}

export const BUILTIN_THEMES: ThemeDefinition[] = [BUILTIN_THEME_PAPER, BUILTIN_THEME_NIGHT]

const BUILTIN_IDS = new Set(BUILTIN_THEMES.map(t => t.id))

export function isBuiltinThemeId(id: string): boolean {
  return BUILTIN_IDS.has(id)
}

export function isCustomThemeId(id: string): boolean {
  return id.startsWith('custom:')
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isValidAccentColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  return clamp(typeof value === 'number' ? value : fallback, min, max)
}

/** 校验并规范化一份主题定义；不合法时返回 null（调用方回退）。 */
export function normalizeThemeDefinition(value: unknown): ThemeDefinition | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ThemeDefinition>
  if (typeof candidate.id !== 'string' || !candidate.id) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  const appearance: Appearance = candidate.appearance === 'dark' ? 'dark' : 'light'
  const accent = isValidAccentColor(candidate.accent) ? candidate.accent.toLowerCase() : '#c8960a'

  let background: ThemeBackground | undefined
  const bg = candidate.background
  if (bg && typeof bg === 'object' && typeof bg.url === 'string' && bg.url) {
    const source: BackgroundSource = bg.source === 'desktop-file' ? 'desktop-file' : 'data'
    background = { source, url: bg.url }
  }

  return {
    id: candidate.id,
    name: candidate.name.trim(),
    appearance,
    accent,
    background,
    panelOpacity: normalizeNumber(candidate.panelOpacity, 1, PANEL_OPACITY_MIN, PANEL_OPACITY_MAX),
    dim: normalizeNumber(candidate.dim, 0, DIM_MIN, DIM_MAX),
    focusX: normalizeNumber(candidate.focusX, 0.5, 0, 1),
    focusY: normalizeNumber(candidate.focusY, 0.5, 0, 1),
    builtin: candidate.builtin === true,
  }
}
