import { loadAttachmentBase64 } from './media-store.js'
import { getModels } from '../providers/index.js'

export interface TextPart {
  type: 'text'
  text: string
}
export interface MediaPart {
  type: 'media'
  mediaType: string
  data: string // base64
  filename?: string
  id?: string
  ext?: string
}
export type ContentPart = TextPart | MediaPart

export interface AttachmentRecord {
  id: string
  mediaType: string
  filename: string
  size: number
  ext: string
}

export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { inline_data: { mime_type: string; data: string } }

export type ProviderFormat = 'openai' | 'anthropic' | 'gemini'

import { getPlugin } from '../providers/index.js'

export function resolveProviderFormat(providerId: string): ProviderFormat {
  return getPlugin(providerId)?.format ?? 'openai'
}

export interface ProviderCapability {
  supportsVision: boolean
  supportsFiles: boolean
}

/** Resolve whether the target model can consume multimodal input.
 * Checks plugin model definitions first; falls back to a name-based heuristic. */
export function resolveCapability(
  modelId: string,
  providerId?: string,
  explicit?: boolean,
): ProviderCapability {
  if (explicit !== undefined) return { supportsVision: explicit, supportsFiles: explicit }
  if (providerId) {
    const model = getModels(providerId).find(m => m.id === modelId)
    if (model?.capabilities.supports_vision !== undefined) {
      return { supportsVision: model.capabilities.supports_vision, supportsFiles: model.capabilities.supports_vision }
    }
  }
  const id = modelId.toLowerCase()
  const vision = VISION_HINTS.some((h) => id.includes(h))
  return { supportsVision: vision, supportsFiles: vision }
}

const VISION_HINTS = [
  'vision', 'vl', 'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4v', 'claude',
  'gemini', 'qwen-vl', 'qwen2-vl', 'glm-4v', 'minimax', 'pixtral', 'llava',
  'internvl', 'deepseek-vl', 'step', 'kimi', 'moonshot', 'qwq-vl', 'mimo', 'hy3',
]

export function textPart(text: string): TextPart {
  return { type: 'text', text }
}

export function mediaPart(input: {
  mediaType: string
  data: string
  filename?: string
  id?: string
  ext?: string
}): MediaPart {
  return { type: 'media', mediaType: input.mediaType, data: input.data, filename: input.filename, id: input.id, ext: input.ext }
}

export function isImage(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

export function isTextLike(mediaType: string): boolean {
  if (mediaType.startsWith('text/')) return true
  return [
    'application/json',
    'application/xml',
    'text/csv',
    'text/markdown',
    'application/markdown',
    'application/javascript',
    'application/typescript',
  ].includes(mediaType)
}

const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'xml', 'yaml', 'yml', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'sh',
  'html', 'htm', 'css', 'scss', 'less',
  'log', 'env', 'ini', 'cfg', 'conf', 'yml',
  'csv', 'tsv',
])

export function isTextExtension(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase().replace(/^\./, ''))
}

export function resolveMediaType(mediaType: string, ext?: string, filename?: string): string {
  if (mediaType !== 'application/octet-stream' && mediaType !== '') return mediaType
  const e = ext || (filename ? filename.split('.').pop() || '' : '')
  if (!e) return mediaType
  const extLower = e.toLowerCase().replace(/^\./, '')
  if (isTextExtension(extLower)) return 'text/plain'
  if (['png','jpg','jpeg','gif','webp','bmp','svg','ico'].includes(extLower)) return 'image/png'
  if (extLower === 'pdf') return 'application/pdf'
  return mediaType
}

/**
 * Lower structured ContentPart[] into the OpenAI-compatible content blocks the
 * LLM API expects. Images become `image_url` multimodal blocks ONLY when the
 * model supports vision; otherwise a clear textual note is emitted instead of
 * silently dropping the bytes (which previously caused the model to hallucinate).
 */
export function lowerContentToProvider(
  parts: ContentPart[],
  cap: ProviderCapability,
  format: ProviderFormat = 'openai',
): ProviderContentBlock[] {
  const out: ProviderContentBlock[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text) out.push({ type: 'text', text: part.text })
      continue
    }
    const effectiveType = resolveMediaType(part.mediaType, part.ext, part.filename)
    const label = part.filename ? `「${part.filename}」` : '附件'
    if (isImage(effectiveType)) {
      if (cap.supportsVision) {
        if (format === 'anthropic') {
          out.push({ type: 'image', source: { type: 'base64', media_type: effectiveType, data: part.data } })
        } else if (format === 'gemini') {
          out.push({ inline_data: { mime_type: effectiveType, data: part.data } })
        } else {
          out.push({ type: 'image_url', image_url: { url: `data:${effectiveType};base64,${part.data}` } })
        }
      } else {
        out.push({ type: 'text', text: `[图片附件${label}：当前模型不支持视觉输入，无法查看图片内容]` })
      }
      continue
    }
    if (isTextLike(effectiveType)) {
      let decoded = ''
      try { decoded = Buffer.from(part.data, 'base64').toString('utf-8') } catch { decoded = '' }
      out.push({ type: 'text', text: `文件${label}（${effectiveType}）内容：\n${decoded}` })
      continue
    }
    // Binary / unsupported type: describe rather than silently drop.
    if (cap.supportsFiles && effectiveType === 'application/pdf') {
      out.push({ type: 'text', text: `[PDF 附件${label}：当前模型暂不支持直接解析 PDF，已跳过]` })
    } else {
      out.push({ type: 'text', text: `[附件${label}（${part.mediaType}）：当前模型不支持该类型，已跳过]` })
    }
  }
  return out
}

/** Reconstruct MediaParts from persisted attachment records + message text. */
export function reconstructParts(
  content: string,
  attachmentsJson: string | null,
  sessionId: string,
): { text: string; media: MediaPart[] } {
  let media: MediaPart[] = []
  if (attachmentsJson) {
    try {
      const records: AttachmentRecord[] = JSON.parse(attachmentsJson)
      media = records
        .map((r) => {
          const data = loadAttachmentBase64(sessionId, r.id, r.ext)
          if (data == null) return null
          return mediaPart({ mediaType: r.mediaType, data, filename: r.filename, id: r.id, ext: r.ext })
        })
        .filter((m): m is MediaPart => m !== null)
    } catch {
      media = []
    }
  }
  return { text: content, media }
}
