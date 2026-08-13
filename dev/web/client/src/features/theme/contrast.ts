/**
 * 对比度工具（WCAG 2.x relative luminance / contrast ratio）。
 *
 * 用于取色后的对比度校正：自动生成的正文与背景至少达到 AA 4.5:1，
 * 控件边界和大字至少 3:1（TIANSHU_THEME_SWITCHING_PLAN §2.3 / §13）。
 */

export interface Rgb {
  r: number
  g: number
  b: number
  a?: number
}

export const AA_TEXT_CONTRAST = 4.5
export const AA_LARGE_CONTRAST = 3

const HEX_PATTERN = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i

export function hexToRgb(hex: string): Rgb {
  const m = HEX_PATTERN.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  }
}

export function rgbToHex(rgb: Rgb): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`
}

export function parseColor(input: string): Rgb {
  const trimmed = input.trim()
  if (HEX_PATTERN.test(trimmed)) return hexToRgb(trimmed)
  const m = RGB_PATTERN.exec(trimmed)
  if (m) {
    const alpha = m[4] !== undefined
      ? (m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number.parseFloat(m[4]))
      : 1
    return {
      r: Number.parseFloat(m[1]),
      g: Number.parseFloat(m[2]),
      b: Number.parseFloat(m[3]),
      a: alpha,
    }
  }
  return { r: 0, g: 0, b: 0 }
}

export function isValidColor(input: string): boolean {
  return HEX_PATTERN.test(input.trim()) || RGB_PATTERN.test(input.trim())
}

/** sRGB 通道 → 线性值（WCAG 相对亮度用）。 */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG 相对亮度（0..1）。忽略 alpha（按不透明处理）。 */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b)
}

export function luminanceOf(input: string): number {
  return relativeLuminance(parseColor(input))
}

/** 对比度（1..21）。 */
export function contrastRatio(a: string, b: string): number {
  const la = luminanceOf(a)
  const lb = luminanceOf(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastRatioRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * 在给定背景上选择对比度更高的黑/白文字色。
 */
export function pickReadableTextColor(background: string, preferLightText = false): string {
  const bg = parseColor(background)
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }
  const whiteRatio = contrastRatioRgb(white, bg)
  const blackRatio = contrastRatioRgb(black, bg)
  if (preferLightText) {
    return whiteRatio >= blackRatio ? '#ffffff' : '#000000'
  }
  return whiteRatio >= blackRatio ? '#ffffff' : '#000000'
}

/**
 * 提升/压低颜色亮度直到与背景达到目标对比度（二分搜索，最多 iterations 轮）。
 * 返回满足对比度的颜色 hex；无法达到时返回对比度最高的候选。
 *
 * 策略：若候选比背景亮则逐步变亮（趋向白），否则逐步变暗（趋向黑），
 * 保留候选的色相/饱和度比例（亮度通道整体缩放）。
 */
export function adjustToContrast(
  background: string,
  candidate: string,
  target: number = AA_TEXT_CONTRAST,
  iterations = 32,
): string {
  const bg = parseColor(background)
  const bgLum = relativeLuminance(bg)
  const rgb = parseColor(candidate)
  const startLum = relativeLuminance(rgb)

  // 对比度 = (max+0.05)/(min+0.05)：候选比背景亮则继续变亮，比背景暗则继续变暗
  const needsLighten = startLum > bgLum
  // lighten: factor ∈ [0,1] 越大越接近白；darken 反之
  let lo = 0
  let hi = 1
  let best = needsLighten ? rgbToHex(lightenTowards(rgb, 1)) : rgbToHex(darkenTowards(rgb, 0))
  let bestRatio = contrastRatioRgb(parseColor(best), bg)

  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    const adjusted = needsLighten ? lightenTowards(rgb, mid) : darkenTowards(rgb, mid)
    const ratio = contrastRatioRgb(adjusted, bg)
    if (ratio >= target) {
      best = rgbToHex(adjusted)
      bestRatio = ratio
      if (needsLighten) lo = mid
      else hi = mid
    } else {
      if (needsLighten) hi = mid
      else lo = mid
    }
    if (hi - lo < 1 / 65536) break
  }
  if (bestRatio < target) {
    // 极端（纯白/纯黑）仍不足：返回对比度最高的端点
    return needsLighten ? '#ffffff' : '#000000'
  }
  return best
}

/** 在保持色相/饱和度比例的前提下整体变暗 factor（0..1）。 */
function darkenTowards(rgb: Rgb, factor: number): Rgb {
  const f = Math.min(1, Math.max(0, factor))
  return {
    r: rgb.r * f,
    g: rgb.g * f,
    b: rgb.b * f,
  }
}

function lightenTowards(rgb: Rgb, factor: number): Rgb {
  const f = Math.min(1, Math.max(0, factor))
  return {
    r: rgb.r + (255 - rgb.r) * f,
    g: rgb.g + (255 - rgb.g) * f,
    b: rgb.b + (255 - rgb.b) * f,
  }
}

/** 从背景推断深/浅外观。 */
export function appearanceFromColor(background: string): 'light' | 'dark' {
  return relativeLuminance(parseColor(background)) > 0.5 ? 'light' : 'dark'
}

/** 校验文字/背景对比度是否达到 AA。 */
export function meetsContrast(foreground: string, background: string, target = AA_TEXT_CONTRAST): boolean {
  return contrastRatio(foreground, background) >= target
}

/** 颜色变亮百分比（0-1），用于 hover 等衍生色。 */
export function mixWith(color: string, target: 'white' | 'black', percent: number): string {
  const rgb = parseColor(color)
  const t = target === 'white' ? 255 : 0
  const mix = (c: number) => Math.round(c + (t - c) * Math.min(1, Math.max(0, percent)))
  return rgbToHex({ r: mix(rgb.r), g: mix(rgb.g), b: mix(rgb.b) })
}
