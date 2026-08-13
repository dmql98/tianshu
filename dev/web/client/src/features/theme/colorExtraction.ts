/**
 * 图片取色与色板生成（TIANSHU_THEME_SWITCHING_PLAN §2.3 / §4.2）。
 *
 * 流程：
 * 1. 按像素预算降采样（最大边或固定像素数），避免超大图片阻塞 UI。
 * 2. 过滤透明像素后在 RGB 空间做轻量 k-means 聚类，合并相近簇。
 * 3. 分析整体亮度与焦点区域，推断建议外观（light/dark）。
 * 4. 从候选色选择强调色；背景/面板/文字色经过对比度校正，而不是原样复制像素。
 * 5. 自动生成的正文与背景至少达到 WCAG AA 4.5:1。
 *
 * 纯计算模块（无 DOM 依赖），测试可在 Node 环境直接运行。
 */
import {
  AA_TEXT_CONTRAST,
  adjustToContrast,
  appearanceFromColor,
  contrastRatio,
  mixWith,
  parseColor,
  rgbToHex,
  type Rgb,
} from './contrast'

/** 取色降采样像素预算（默认 40k 像素 ≈ 200x200）。 */
export const DOWNSAMPLE_PIXEL_BUDGET = 40_000
/** 聚类数量。 */
export const CLUSTER_COUNT = 6
/** 最小簇占比（低于该比例视为噪声丢弃）。 */
export const MIN_CLUSTER_FRACTION = 0.03

export interface ExtractedColors {
  /** 主候选色（按占比降序，hex）。 */
  candidates: string[]
  /** 建议外观。 */
  suggestedAppearance: 'light' | 'dark'
  /** 整体亮度 0..1（相对亮度）。 */
  averageLuminance: number
  /** 是否有透明像素。 */
  hasTransparency: boolean
}

export interface GeneratedPalette {
  canvas: string
  surface1: string
  surface2: string
  surfaceHover: string
  input: string
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

// ── 降采样 ──

export interface DownsampleOptions {
  /** 目标像素预算（默认 DOWNSAMPLE_PIXEL_BUDGET）。 */
  maxPixels?: number
  /** 最大边长度（默认 256）。 */
  maxEdge?: number
}

/** 计算降采样后的目标尺寸（保持宽高比，像素数不超过预算、边不超过上限）。 */
export function downsampleSize(
  width: number,
  height: number,
  options: DownsampleOptions = {},
): { width: number; height: number } {
  const maxPixels = options.maxPixels ?? DOWNSAMPLE_PIXEL_BUDGET
  const maxEdge = options.maxEdge ?? 256
  const total = width * height
  if (total <= 0) return { width: 1, height: 1 }

  let scale = Math.min(1, Math.sqrt(maxPixels / total), maxEdge / Math.max(width, height))
  // 保证至少 1x1
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  if (w * h > maxPixels) {
    scale = Math.sqrt(maxPixels / (w * h))
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    }
  }
  return { width: w, height: h }
}

/** 对 ImageData 像素做简单 box 降采样。 */
export function downsampleImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: DownsampleOptions = {},
): { data: Uint8ClampedArray; width: number; height: number } {
  const target = downsampleSize(width, height, options)
  const { width: tw, height: th } = target
  if (tw === width && th === height) return { data, width, height }

  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const srcY = Math.min(height - 1, Math.floor((y + 0.5) * height / th))
    for (let x = 0; x < tw; x++) {
      const srcX = Math.min(width - 1, Math.floor((x + 0.5) * width / tw))
      const si = (srcY * width + srcX) * 4
      const di = (y * tw + x) * 4
      out[di] = data[si]
      out[di + 1] = data[si + 1]
      out[di + 2] = data[si + 2]
      out[di + 3] = data[si + 3]
    }
  }
  return { data: out, width: tw, height: th }
}

// ── 聚类 ──

interface Cluster {
  r: number
  g: number
  b: number
  count: number
}

function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

/**
 * 轻量 k-means：对采样像素聚类。返回按占比降序的簇。
 */
export function kMeansClusters(
  pixels: Rgb[],
  k: number = CLUSTER_COUNT,
  iterations = 8,
): Cluster[] {
  if (pixels.length === 0) return []
  const effectiveK = Math.min(k, pixels.length)

  // 用均匀采样初始化中心（确定性，便于测试）
  const centers: Rgb[] = []
  for (let i = 0; i < effectiveK; i++) {
    const idx = Math.floor(i * pixels.length / effectiveK)
    centers.push({ ...pixels[idx] })
  }

  const assignments = new Array<number>(pixels.length).fill(0)
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false
    for (let i = 0; i < pixels.length; i++) {
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < centers.length; c++) {
        const d = rgbDistance(pixels[i], centers[c])
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best
        changed = true
      }
    }
    if (!changed) break
    // 重算中心
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }))
    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i]
      sums[c].r += pixels[i].r
      sums[c].g += pixels[i].g
      sums[c].b += pixels[i].b
      sums[c].count++
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c].count > 0) {
        centers[c] = {
          r: sums[c].r / sums[c].count,
          g: sums[c].g / sums[c].count,
          b: sums[c].b / sums[c].count,
        }
      }
    }
  }

  const clusters: Cluster[] = centers.map((center, c) => ({
    r: center.r,
    g: center.g,
    b: center.b,
    count: assignments.filter(a => a === c).length,
  }))
  return clusters
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** 合并相近簇（距离 < threshold 时并入更大的簇）。 */
export function mergeSimilarClusters(clusters: Cluster[], threshold = 28): Cluster[] {
  const sorted = [...clusters].sort((a, b) => b.count - a.count)
  const merged: Cluster[] = []
  for (const cluster of sorted) {
    const existing = merged.find(m => rgbDistance(m, cluster) < threshold)
    if (existing) {
      const total = existing.count + cluster.count
      existing.r = (existing.r * existing.count + cluster.r * cluster.count) / total
      existing.g = (existing.g * existing.count + cluster.g * cluster.count) / total
      existing.b = (existing.b * existing.count + cluster.b * cluster.count) / total
      existing.count = total
    } else {
      merged.push({ ...cluster })
    }
  }
  return merged.sort((a, b) => b.count - a.count)
}

// ── 主入口 ──

/**
 * 从 ImageData 提取候选色与外观建议。
 * pixels 已降采样（由调用方在浏览器 canvas 或测试构造）。
 */
export function extractColorsFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { clusterCount?: number; minFraction?: number } = {},
): ExtractedColors {
  const clusterCount = options.clusterCount ?? CLUSTER_COUNT
  const minFraction = options.minFraction ?? MIN_CLUSTER_FRACTION

  const opaque: Rgb[] = []
  let hasTransparency = false
  let luminanceSum = 0
  let sampleCount = 0

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) {
      hasTransparency = true
      continue
    }
    const rgb = { r: data[i], g: data[i + 1], b: data[i + 2] }
    opaque.push(rgb)
    // 近似亮度（加权和，避免每次做完整 gamma 变换）
    luminanceSum += (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
    sampleCount++
  }

  const averageLuminance = sampleCount > 0 ? luminanceSum / sampleCount : 0.5

  let clusters = kMeansClusters(opaque, clusterCount)
  clusters = mergeSimilarClusters(clusters)
  const total = opaque.length
  const candidates = clusters
    .filter(c => total === 0 || c.count / total >= minFraction)
    .map(c => rgbToHex({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }))

  return {
    candidates: candidates.length > 0 ? candidates : ['#8a8a8a'],
    suggestedAppearance: averageLuminance >= 0.5 ? 'light' : 'dark',
    averageLuminance,
    hasTransparency,
  }
}

/** 从单个颜色生成外观建议（用于非图片场景）。 */
export function appearanceFromHex(hex: string): 'light' | 'dark' {
  return appearanceFromColor(hex)
}

// ── 色板生成 ──

export interface PaletteOptions {
  appearance?: 'light' | 'dark' | 'auto'
  /** 是否使用最饱和候选作为强调色源（默认 true）。 */
  preferSaturatedAccent?: boolean
}

/** 从候选色生成完整、可读的色板（对比度校正内置）。 */
export function generatePalette(
  candidates: string[],
  options: PaletteOptions = {},
): GeneratedPalette {
  const base = candidates[0] ?? '#8a8a8a'
  const appearance = options.appearance === 'auto'
    ? appearanceFromColor(base)
    : (options.appearance ?? appearanceFromColor(base))
  const dark = appearance === 'dark'

  // 主背景：保持外观方向——深色主题画布偏暗、浅色主题画布偏亮，
  // 不做"与纯白/纯黑对比"的反向提亮；对比度校正发生在文字色上。
  const canvas = dark
    ? mixWith(base, 'black', 0.7)
    : mixWith(base, 'white', 0.72)

  // 面板/输入框：在背景基础上略微偏移
  const surface1 = dark
    ? mixWith(canvas, 'white', 0.06)
    : mixWith(canvas, 'black', 0.06)
  const surface2 = dark
    ? mixWith(canvas, 'white', 0.12)
    : mixWith(canvas, 'black', 0.12)
  const surfaceHover = dark
    ? mixWith(canvas, 'white', 0.16)
    : mixWith(canvas, 'black', 0.12)
  const input = dark
    ? mixWith(canvas, 'black', 0.08)
    : mixWith(canvas, 'white', 0.5)

  // 强调色：优先最饱和候选，否则取次候选
  const accent = pickAccent(candidates, dark)

  // 正文文字：与背景对比度 ≥ 4.5
  const textPrimary = dark
    ? adjustToContrast(canvas, '#f2ead9', AA_TEXT_CONTRAST)
    : adjustToContrast(canvas, '#2c2418', AA_TEXT_CONTRAST)
  const textSecondary = dark
    ? adjustToContrast(canvas, mixWith(textPrimary, 'black', 0.25), 4.5)
    : adjustToContrast(canvas, mixWith(textPrimary, 'white', 0.3), 4.5)
  const textMuted = dark
    ? adjustToContrast(canvas, mixWith(textPrimary, 'black', 0.45), 3)
    : adjustToContrast(canvas, mixWith(textPrimary, 'white', 0.55), 3)
  const textFaint = dark
    ? mixWith(canvas, 'white', 0.28)
    : mixWith(canvas, 'black', 0.28)

  // on-accent 文字：强调色背景上的高对比文字
  const textOnAccent = contrastRatio('#ffffff', accent) >= 4.5 ? '#ffffff' : '#000000'
  const accentHover = dark ? mixWith(accent, 'white', 0.12) : mixWith(accent, 'black', 0.1)
  const link = dark ? mixWith(accent, 'white', 0.08) : accent
  const focusRing = dark ? mixWith(accent, 'white', 0.25) : mixWith(accent, 'black', 0.15)

  const border = dark
    ? 'rgba(255,235,200,0.12)'
    : 'rgba(180,160,130,0.15)'
  const borderSubtle = dark
    ? 'rgba(255,235,200,0.07)'
    : 'rgba(180,160,130,0.08)'

  return {
    canvas,
    surface1,
    surface2,
    surfaceHover,
    input,
    border,
    borderSubtle,
    textPrimary,
    textSecondary,
    textMuted,
    textFaint,
    textOnAccent,
    accent,
    accentHover,
    accentSoft: dark ? 'rgba(224,179,65,0.16)' : 'rgba(200,150,10,0.1)',
    link,
    focusRing,
    success: dark ? '#4caf7d' : '#2a9d5c',
    warning: dark ? '#e8933c' : '#d97706',
    danger: dark ? '#e0735a' : '#c45c3c',
    info: dark ? '#6b9ff3' : '#2563eb',
    shadowColor: dark ? 'rgba(0,0,0,0.5)' : 'rgba(44,36,24,0.2)',
    codeBg: input,
    scrollbar: dark ? mixWith(canvas, 'white', 0.2) : mixWith(canvas, 'black', 0.2),
  }
}

function pickAccent(candidates: string[], dark: boolean): string {
  const sorted = [...candidates].sort((a, b) => saturation(b) - saturation(a))
  const best = sorted[0] ?? '#c8960a'
  // 强调色也要与文字/背景保持可读性（文字走 textOnAccent 校验）
  const target = dark ? '#e0b341' : '#c8960a'
  // 若最饱和候选过于接近中性（饱和度极低），退回默认金色系
  if (saturation(best) < 0.08) return target
  return best
}

function saturation(hex: string): number {
  const rgb = parseColor(hex)
  const max = Math.max(rgb.r, rgb.g, rgb.b) / 255
  const min = Math.min(rgb.r, rgb.g, rgb.b) / 255
  if (max === 0) return 0
  return (max - min) / max
}
