import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  detectImageFormat,
  validateThemeImage,
} from '../src/theme/image-validation.js'

function pngBytes(width: number, height: number): Uint8Array {
  // PNG signature + IHDR
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // IHDR length 13, type IHDR
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const set32 = (off: number, v: number) => {
    bytes[off] = (v >>> 24) & 0xff
    bytes[off + 1] = (v >>> 16) & 0xff
    bytes[off + 2] = (v >>> 8) & 0xff
    bytes[off + 3] = v & 0xff
  }
  set32(16, width)
  set32(20, height)
  bytes[24] = 8 // bit depth
  bytes[25] = 6 // color type RGBA
  return bytes
}

function apngBytes(width: number, height: number): Uint8Array {
  // PNG + acTL chunk before IDAT（近似 APNG 结构）
  const base = pngBytes(width, height)
  const bytes = new Uint8Array(33 + 20)
  bytes.set(base)
  // acTL chunk: length 8, "acTL", numFrames=2, numPlays=0, crc
  bytes.set([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0], 33)
  return bytes
}

function jpegBytes(width: number, height: number): Uint8Array {
  // SOI + APP0 + SOF0 + EOI
  const bytes = new Uint8Array(2 + 2 + 14 + 2 + 17 + 2)
  let o = 0
  bytes[o++] = 0xff; bytes[o++] = 0xd8 // SOI
  // APP0
  bytes[o++] = 0xff; bytes[o++] = 0xe0
  bytes[o++] = 0; bytes[o++] = 16
  bytes.set([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0], o); o += 14
  // SOF0
  bytes[o++] = 0xff; bytes[o++] = 0xc0
  bytes[o++] = 0; bytes[o++] = 17
  bytes[o++] = 8 // precision
  bytes[o++] = (height >> 8) & 0xff; bytes[o++] = height & 0xff
  bytes[o++] = (width >> 8) & 0xff; bytes[o++] = width & 0xff
  bytes[o++] = 3 // components
  bytes.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], o); o += 9
  bytes[o++] = 0xff; bytes[o++] = 0xd9 // EOI
  return bytes
}

function webpBytes(width: number, height: number, animated = false): Uint8Array {
  // RIFF + WEBP + VP8X
  const bytes = new Uint8Array(12 + 8 + 10)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
  const chunkSize = 8 + 10
  bytes[4] = chunkSize & 0xff
  bytes[5] = (chunkSize >> 8) & 0xff
  bytes[6] = (chunkSize >> 16) & 0xff
  bytes[7] = (chunkSize >> 24) & 0xff
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x58], 12) // VP8X
  bytes.set([0, 0, 0, 10], 16) // chunk size
  bytes[20] = animated ? 0x02 : 0x00 // flags
  // canvas size (1 + 24bit LE)
  const w = width - 1
  const h = height - 1
  bytes[24] = w & 0xff
  bytes[25] = (w >> 8) & 0xff
  bytes[26] = (w >> 16) & 0xff
  bytes[27] = h & 0xff
  bytes[28] = (h >> 8) & 0xff
  bytes[29] = (h >> 16) & 0xff
  return bytes
}

describe('image-validation: 格式检测', () => {
  it('识别 PNG / JPEG / WebP magic bytes', () => {
    expect(detectImageFormat(pngBytes(10, 10))).toBe('png')
    expect(detectImageFormat(jpegBytes(10, 10))).toBe('jpeg')
    expect(detectImageFormat(webpBytes(10, 10))).toBe('webp')
  })

  it('拒绝 GIF 与 SVG/HTML', () => {
    expect(detectImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBe('gif')
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(detectImageFormat(svg)).toBe('svg')
  })

  it('空文件拒绝', () => {
    expect(validateThemeImage(new Uint8Array(0)).ok).toBe(false)
  })
})

describe('image-validation: 尺寸解析', () => {
  it('PNG 尺寸', () => {
    const result = validateThemeImage(pngBytes(640, 480))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.width).toBe(640)
      expect(result.height).toBe(480)
      expect(result.mime).toBe('image/png')
    }
  })

  it('JPEG 尺寸', () => {
    const result = validateThemeImage(jpegBytes(1920, 1080))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.width).toBe(1920)
      expect(result.height).toBe(1080)
      expect(result.mime).toBe('image/jpeg')
    }
  })

  it('WebP 尺寸（VP8X）', () => {
    const result = validateThemeImage(webpBytes(800, 600))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.width).toBe(800)
      expect(result.height).toBe(600)
      expect(result.mime).toBe('image/webp')
    }
  })
})

describe('image-validation: 拒绝动图', () => {
  it('拒绝 APNG', () => {
    const result = validateThemeImage(apngBytes(100, 100))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('ANIMATED')
  })

  it('拒绝动画 WebP', () => {
    const result = validateThemeImage(webpBytes(100, 100, true))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('ANIMATED')
  })
})

describe('image-validation: 限制', () => {
  it('拒绝超大字节数', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(pngBytes(10, 10))
    const result = validateThemeImage(big)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TOO_LARGE_BYTES')
  })

  it('拒绝超大像素', () => {
    const result = validateThemeImage(pngBytes(9000, 9000))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TOO_LARGE_PIXELS')
  })

  it('拒绝超大单边', () => {
    const result = validateThemeImage(pngBytes(MAX_IMAGE_DIMENSION + 100, 100))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TOO_LARGE_DIMENSION')
  })

  it('拒绝异常长宽比', () => {
    const result = validateThemeImage(pngBytes(10000, 10))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_ASPECT_RATIO')
  })

  it('损坏结构拒绝', () => {
    const corrupt = pngBytes(100, 100)
    corrupt[13] = 0x00 // 破坏 IHDR type
    const result = validateThemeImage(corrupt)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('CORRUPT')
  })
})
