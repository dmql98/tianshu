/**
 * 主题图片校验（TIANSHU_THEME_SWITCHING_PLAN §8 服务端规则）。
 *
 * - 只接受 JPEG / PNG / 静态 WebP：以 magic bytes + 文件头结构解析为准，
 *   不能只信扩展名或请求 MIME。
 * - 拒绝 SVG、HTML、动图（GIF / 动画 WebP / 动画 PNG 不存在但 APNG 也拒绝）、
 *   data URL 和远程 URL。
 * - 限制字节数、像素尺寸、单边尺寸和长宽比（防解码炸弹）。
 * - 校验通过返回真实格式、尺寸与 MIME；失败返回明确错误码。
 *
 * 服务端在 Node 环境无内置像素解码器，这里实现头部级"结构解码"：
 * 解析出真实尺寸与格式标志；客户端上传前已用 canvas 完成真实像素解码预览，
 * 双层校验共同构成安全边界。
 */

export interface ImageValidationResult {
  ok: true
  format: 'png' | 'jpeg' | 'webp'
  mime: string
  width: number
  height: number
  bytes: number
}

export interface ImageValidationFailure {
  ok: false
  code:
    | 'EMPTY'
    | 'UNSUPPORTED_FORMAT'
    | 'ANIMATED'
    | 'TOO_LARGE_BYTES'
    | 'TOO_LARGE_PIXELS'
    | 'TOO_LARGE_DIMENSION'
    | 'BAD_ASPECT_RATIO'
    | 'CORRUPT'
  message: string
}

export type ImageValidationResultOrFailure = ImageValidationResult | ImageValidationFailure

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // 15 MB
export const MAX_IMAGE_PIXELS = 40_000_000 // 4000 万像素（解码内存预算）
export const MAX_IMAGE_DIMENSION = 10_000
export const MIN_ASPECT_RATIO = 1 / 20
export const MAX_ASPECT_RATIO = 20

// ── magic bytes ──

export function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | null {
  if (bytes.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp'
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif'
  // SVG/HTML: 文本嗅探（<svg / <?xml / <!DOCTYPE html / <html）
  const head = String.fromCharCode(...bytes.slice(0, Math.min(512, bytes.length))).toLowerCase()
  if (head.includes('<svg') || head.includes('<!doctype html') || head.includes('<html')) return 'svg'
  return null
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0
}

function isPngAnimated(bytes: Uint8Array): boolean {
  // APNG：在 IHDR 之后存在 acTL chunk
  if (bytes.length < 33) return false
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    if (type === 'acTL') return true
    if (type === 'IEND') break
    offset += 12 + length
  }
  return false
}

/** 解析 PNG 尺寸（IHDR）。 */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null
  const width = readUint32BE(bytes, 16)
  const height = readUint32BE(bytes, 20)
  if (width === 0 || height === 0) return null
  return { width, height }
}

/** 解析 JPEG 尺寸（扫描 SOF marker）。 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xd8) { offset += 2; continue } // SOI
    if (marker === 0xd9 || marker === 0xda) break // EOI / SOS
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue } // RST
    const length = readUint16BE(bytes, offset + 2)
    if (length < 2) return null
    // SOF0-SOF15（排除 DHT C4 / DAC CC）
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = readUint16BE(bytes, offset + 5)
      const width = readUint16BE(bytes, offset + 7)
      if (width === 0 || height === 0) return null
      return { width, height }
    }
    offset += 2 + length
  }
  return null
}

/** 解析 WebP 尺寸与动画标志。 */
function webpInfo(bytes: Uint8Array): { width: number; height: number; animated: boolean } | null {
  if (bytes.length < 30) return null
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunkType === 'VP8X') {
    const flags = bytes[20]
    const animated = (flags & 0x02) !== 0
    // 24-bit little-endian canvas size
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return { width, height, animated }
  }
  if (chunkType === 'VP8 ') {
    // lossy: frame tag 3 bytes + sync 3 bytes + 宽高 2 字节 each
    const width = readUint16BE(bytes, 26) & 0x3fff
    const height = readUint16BE(bytes, 28) & 0x3fff
    return { width, height, animated: false }
  }
  if (chunkType === 'VP8L') {
    // lossless: signature byte + 14-bit 宽高
    const b = bytes[21]
    const c = bytes[22]
    const d = bytes[23]
    const e = bytes[24]
    const width = 1 + (((b & 0x3f) << 8) | c)
    const height = 1 + (((d & 0x0f) << 8) | e)
    return { width, height, animated: false }
  }
  return null
}

// ── 主入口 ──

export function validateThemeImage(bytes: Uint8Array, options?: {
  maxBytes?: number
  maxPixels?: number
  maxDimension?: number
}): ImageValidationResultOrFailure {
  const maxBytes = options?.maxBytes ?? MAX_IMAGE_BYTES
  const maxPixels = options?.maxPixels ?? MAX_IMAGE_PIXELS
  const maxDimension = options?.maxDimension ?? MAX_IMAGE_DIMENSION

  if (!bytes || bytes.length === 0) {
    return { ok: false, code: 'EMPTY', message: 'Empty file' }
  }
  if (bytes.length > maxBytes) {
    return { ok: false, code: 'TOO_LARGE_BYTES', message: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit` }
  }

  const format = detectImageFormat(bytes)
  if (!format) {
    return { ok: false, code: 'UNSUPPORTED_FORMAT', message: 'Only JPEG, PNG or static WebP images are accepted' }
  }
  if (format === 'gif' || format === 'svg') {
    return { ok: false, code: 'UNSUPPORTED_FORMAT', message: 'GIF and SVG are not accepted as theme artwork' }
  }

  let width = 0
  let height = 0
  if (format === 'png') {
    if (isPngAnimated(bytes)) {
      return { ok: false, code: 'ANIMATED', message: 'Animated PNG (APNG) is not accepted' }
    }
    const dim = pngDimensions(bytes)
    if (!dim) return { ok: false, code: 'CORRUPT', message: 'Invalid PNG structure' }
    width = dim.width
    height = dim.height
  } else if (format === 'jpeg') {
    const dim = jpegDimensions(bytes)
    if (!dim) return { ok: false, code: 'CORRUPT', message: 'Invalid JPEG structure' }
    width = dim.width
    height = dim.height
  } else {
    const info = webpInfo(bytes)
    if (!info) return { ok: false, code: 'CORRUPT', message: 'Invalid WebP structure' }
    if (info.animated) {
      return { ok: false, code: 'ANIMATED', message: 'Animated WebP is not accepted' }
    }
    width = info.width
    height = info.height
  }

  if (width <= 0 || height <= 0 || width > maxDimension || height > maxDimension) {
    return { ok: false, code: 'TOO_LARGE_DIMENSION', message: `Image dimension exceeds ${maxDimension}px` }
  }
  if (width * height > maxPixels) {
    return { ok: false, code: 'TOO_LARGE_PIXELS', message: `Image exceeds ${maxPixels} pixels` }
  }
  const ratio = width / height
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) {
    return { ok: false, code: 'BAD_ASPECT_RATIO', message: 'Image aspect ratio out of range (1:20 ~ 20:1)' }
  }

  return {
    ok: true,
    format,
    mime: format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp',
    width,
    height,
    bytes: bytes.length,
  }
}

/** 规范化的背景素材扩展名（保留原格式，运行时只引用主题目录内文件）。 */
export function extensionForFormat(format: 'png' | 'jpeg' | 'webp'): string {
  return format === 'png' ? 'png' : format === 'jpeg' ? 'jpg' : 'webp'
}
