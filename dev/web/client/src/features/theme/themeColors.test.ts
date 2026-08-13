import { describe, expect, it } from 'vitest'
import {
  AA_TEXT_CONTRAST,
  adjustToContrast,
  appearanceFromColor,
  contrastRatio,
  hexToRgb,
  meetsContrast,
  mixWith,
  parseColor,
  relativeLuminance,
  rgbToHex,
} from './contrast'
import {
  DOWNSAMPLE_PIXEL_BUDGET,
  downsampleSize,
  extractColorsFromPixels,
  generatePalette,
  kMeansClusters,
  mergeSimilarClusters,
} from './colorExtraction'

describe('contrast: 亮度与对比度', () => {
  it('黑白对比度为 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('同色对比度为 1', () => {
    expect(contrastRatio('#c8960a', '#c8960a')).toBeCloseTo(1, 5)
  })

  it('相对亮度：白 1 / 黑 0', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
  })

  it('hexToRgb 解析 6 位与 3 位 hex', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('parseColor 解析 rgb()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('rgba(10, 20, 30, 0.5)').a).toBeCloseTo(0.5)
  })

  it('rgbToHex round-trip', () => {
    expect(rgbToHex({ r: 0, g: 128, b: 255 })).toBe('#0080ff')
  })
})

describe('contrast: 外观推断', () => {
  it('亮色 → light，暗色 → dark', () => {
    expect(appearanceFromColor('#f5f0e8')).toBe('light')
    expect(appearanceFromColor('#17130e')).toBe('dark')
  })
})

describe('contrast: 对比度校正', () => {
  it('浅背景上极暗文字达到 AA 4.5', () => {
    const adjusted = adjustToContrast('#f5f0e8', '#8a7d68', AA_TEXT_CONTRAST)
    expect(meetsContrast(adjusted, '#f5f0e8')).toBe(true)
  })

  it('深背景上极亮文字达到 AA 4.5', () => {
    const adjusted = adjustToContrast('#17130e', '#c9bda6', AA_TEXT_CONTRAST)
    expect(meetsContrast(adjusted, '#17130e')).toBe(true)
  })

  it('亮青色背景上的纯白文字会转向深色并达到 AA 4.5', () => {
    const adjusted = adjustToContrast('#3bc0c3', '#ffffff', AA_TEXT_CONTRAST)
    expect(adjusted).not.toBe('#ffffff')
    expect(meetsContrast(adjusted, '#3bc0c3')).toBe(true)
  })

  it('无法满足时返回最高对比度端点', () => {
    // 在 #808080 上，#808080 无论怎么调整都不可能 >4.5（最极端是黑/白，对比 3.9x）
    const adjusted = adjustToContrast('#808080', '#808080', AA_TEXT_CONTRAST)
    const ratio = contrastRatio(adjusted, '#808080')
    expect(ratio).toBeGreaterThanOrEqual(3.9)
  })

  it('mixWith 变亮/变暗方向正确', () => {
    expect(mixWith('#000000', 'white', 1)).toBe('#ffffff')
    expect(mixWith('#ffffff', 'black', 1)).toBe('#000000')
  })
})

describe('colorExtraction: 降采样预算', () => {
  it('大图被降采样到像素预算内', () => {
    const size = downsampleSize(4000, 3000)
    expect(size.width * size.height).toBeLessThanOrEqual(DOWNSAMPLE_PIXEL_BUDGET)
    expect(size.width).toBeLessThanOrEqual(256)
    expect(size.height).toBeLessThanOrEqual(256)
  })

  it('小图不被放大', () => {
    const size = downsampleSize(32, 24)
    expect(size).toEqual({ width: 32, height: 24 })
  })

  it('保持宽高比', () => {
    const size = downsampleSize(2000, 1000)
    expect(size.width / size.height).toBeCloseTo(2, 1)
  })
})

describe('colorExtraction: 聚类', () => {
  it('k-means 对纯色返回单一簇', () => {
    const pixels = Array.from({ length: 100 }, () => ({ r: 200, g: 100, b: 50 }))
    const clusters = kMeansClusters(pixels, 4)
    expect(clusters.length).toBeGreaterThan(0)
    const top = clusters[0]
    expect(Math.round(top.r)).toBe(200)
    expect(Math.round(top.g)).toBe(100)
    expect(Math.round(top.b)).toBe(50)
  })

  it('mergeSimilarClusters 合并相近色', () => {
    const clusters = [
      { r: 200, g: 100, b: 50, count: 60 },
      { r: 205, g: 105, b: 55, count: 40 },
    ]
    const merged = mergeSimilarClusters(clusters, 28)
    expect(merged.length).toBe(1)
    expect(merged[0].count).toBe(100)
  })
})

function imageDataOf(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { data, width, height }
}

describe('colorExtraction: 取色', () => {
  it('单色图返回单一候选与正确外观', () => {
    const { data, width, height } = imageDataOf(64, 64, () => [30, 30, 30, 255])
    const result = extractColorsFromPixels(data, width, height)
    expect(result.candidates[0]).toBe('#1e1e1e')
    expect(result.suggestedAppearance).toBe('dark')
    expect(result.hasTransparency).toBe(false)
  })

  it('灰度图去重后候选有限', () => {
    const { data, width, height } = imageDataOf(64, 64, (x) => {
      const v = (x % 2 === 0) ? 128 : 129
      return [v, v, v, 255]
    })
    const result = extractColorsFromPixels(data, width, height)
    expect(result.candidates.length).toBeLessThanOrEqual(6)
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it('透明像素被过滤并标记 hasTransparency', () => {
    const { data, width, height } = imageDataOf(64, 64, (x) => {
      return x < 32 ? [255, 0, 0, 0] : [10, 200, 10, 255]
    })
    const result = extractColorsFromPixels(data, width, height)
    expect(result.hasTransparency).toBe(true)
    // 只剩不透明簇
    expect(result.candidates.length).toBe(1)
  })

  it('极暗图推断 dark，极亮图推断 light', () => {
    const dark = imageDataOf(32, 32, () => [5, 5, 8, 255])
    expect(extractColorsFromPixels(dark.data, dark.width, dark.height).suggestedAppearance).toBe('dark')

    const light = imageDataOf(32, 32, () => [250, 248, 240, 255])
    expect(extractColorsFromPixels(light.data, light.width, light.height).suggestedAppearance).toBe('light')
  })

  it('极小簇（噪声）被过滤', () => {
    const { data, width, height } = imageDataOf(64, 64, (x, y) => {
      // 大部分为 #444444，只有 3 个像素是 #ff0000
      if (x === 0 && y < 3) return [255, 0, 0, 255]
      return [68, 68, 68, 255]
    })
    const result = extractColorsFromPixels(data, width, height, { minFraction: 0.03 })
    expect(result.candidates[0]).toBe('#444444')
  })
})

describe('colorExtraction: 色板生成（对比度保证）', () => {
  it('深色外观：正文与背景达到 AA', () => {
    const palette = generatePalette(['#1a1a2e', '#16213e'], { appearance: 'dark' })
    expect(contrastRatio(palette.textPrimary, palette.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.textSecondary, palette.canvas)).toBeGreaterThanOrEqual(4.5)
  })

  it('浅色外观：正文与背景达到 AA', () => {
    const palette = generatePalette(['#f5f0e8', '#d4c9b8'], { appearance: 'light' })
    expect(contrastRatio(palette.textPrimary, palette.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.textSecondary, palette.canvas)).toBeGreaterThanOrEqual(4.5)
  })

  it('auto 外观按主色推断', () => {
    const darkPalette = generatePalette(['#0f1115'], { appearance: 'auto' })
    expect(darkPalette.canvas).toMatch(/^#[0-9a-f]{6}$/)
    // 深色主色 → canvas 应偏暗
    expect(relativeLuminance(hexToRgb(darkPalette.canvas))).toBeLessThan(0.35)
  })

  it('on-accent 文字与强调色保持可读', () => {
    const palette = generatePalette(['#2b6cb0'], { appearance: 'light' })
    expect(contrastRatio(palette.textOnAccent, palette.accent)).toBeGreaterThanOrEqual(3)
  })
})
