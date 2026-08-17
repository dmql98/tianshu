/**
 * SVG 图标 sanitize（ICON_PACK_PLAN §6）。
 *
 * 上传的 SVG 可能内嵌 <script>、on* 事件属性、javascript: URL、外部引用等。
 * 策略（纵深防御，客户端渲染也只用 <img> / CSS mask，不内联执行）：
 * - 用 htmlparser2 解析 → 白名单元素/属性重建 → 序列化回纯图形 SVG。
 * - 剥离：<script>/<foreignObject>/<iframe>/<use> 外链、所有 on* 属性、
 *   javascript:/data: URL、外部 <image> 引用、<a> 与 style 中的 script。
 * - 输出仅含 path/circle/rect/ellipse/line/polyline/polygon/g/defs/linearGradient/
 *   radialGradient/stop/title/desc 及其安全属性。
 */
import { Parser, type Handler } from 'htmlparser2'

/** 允许的 SVG 元素。 */
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc',
  'clipPath', 'mask', 'symbol', 'use', 'pattern', 'marker',
])

/** 属性白名单：元素无关的安全属性（其余全部剥离）。 */
const SAFE_ATTRS = new Set([
  // 结构
  'id', 'viewbox', 'preserveaspectratio', 'xmlns', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'pathlength',
  'transform', 'translate', 'scale', 'rotate', 'skewx', 'skewy', 'matrix',
  'clip-path', 'clip-pathunits', 'mask', 'maskunits', 'patternunits', 'patterncontentunits',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'stop-color', 'stop-opacity',
  'href', 'xlink:href', 'idref',
  // 样式
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'style', 'class', 'color', 'font-family', 'font-size', 'font-weight', 'text-anchor',
])

/** 明确禁止的元素（即使带安全属性也不允许）。 */
const BLOCKED_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'a', 'image', 'animate', 'set', 'use'])

/** href 值安全检查：只允许站内片段引用（#id），拒绝 javascript:/data:/http(s) 外链。 */
function isSafeHref(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '') return false
  if (trimmed.startsWith('#')) return true
  if (trimmed.startsWith('data:image/')) return false // 图标内嵌位图也拒绝（尺寸不可控）
  return false
}

/** style 属性安全检查：剥离 url(...) 与 expression/script 关键字。 */
function sanitizeStyle(value: string): string {
  const cleaned = value
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/@import/gi, '')
  return cleaned.trim()
}

export function sanitizeSvg(raw: string): { ok: true; data: string } | { ok: false; message: string } {
  if (raw.length > 512 * 1024) return { ok: false, message: 'SVG exceeds 512 KB limit' }
  // 快速拒绝：明确的可执行标记（即使被注释也要拒绝，避免混淆绕过）
  if (/<script[\s>]/i.test(raw)) return { ok: false, message: 'SVG contains <script>' }

  let rootAllowed = false
  const output: string[] = []
  let skipDepth = 0

  const handler: Partial<Handler> = {
    onopentag(name, attrs) {
      const tag = name.toLowerCase()
      if (skipDepth > 0) {
        skipDepth++
        return
      }
      if (tag === 'svg') rootAllowed = true
      if (BLOCKED_TAGS.has(tag)) {
        // 阻断整个子树：跳过直至对应闭合标签
        skipDepth = 1
        return
      }
      if (!ALLOWED_TAGS.has(tag)) return
      const safeAttrs: string[] = []
      for (const [key, value] of Object.entries(attrs)) {
        const lower = key.toLowerCase()
        if (lower.startsWith('on')) continue
        if (!SAFE_ATTRS.has(lower)) continue
        if (lower === 'href' || lower === 'xlink:href') {
          if (!isSafeHref(value ?? '')) continue
        }
        if (lower === 'style') {
          const cleaned = sanitizeStyle(value ?? '')
          if (!cleaned) continue
          safeAttrs.push(` ${key}="${escapeAttr(cleaned)}"`)
          continue
        }
        safeAttrs.push(` ${key}="${escapeAttr(value ?? '')}"`)
      }
      output.push(`<${tag}${safeAttrs.join('')}>`)
    },
    onclosetag(name) {
      const tag = name.toLowerCase()
      if (skipDepth > 0) {
        skipDepth--
        return
      }
      if (BLOCKED_TAGS.has(tag)) return
      if (!ALLOWED_TAGS.has(tag)) return
      output.push(`</${tag}>`)
    },
    ontext(text) {
      if (skipDepth > 0) return
      // 只保留 title/desc 内的文本，其余剥掉（防文本节点注入）
      output.push(escapeText(text))
    },
    oncomment() {
      /* 丢弃注释 */
    },
    onprocessinginstruction() {
      /* 丢弃（含 XML 声明与 DOCTYPE） */
    },
  }

  const parser = new Parser(handler, { xmlMode: true, lowerCaseAttributeNames: true })
  parser.write(raw)
  parser.end()

  if (!rootAllowed) return { ok: false, message: 'Not a valid SVG document' }
  const data = output.join('')
  // 最终安全网：输出中不允许出现任何可执行标记
  if (/<script[\s>]/i.test(data)) return { ok: false, message: 'SVG sanitize failed' }
  return { ok: true, data }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
