import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { resolve } from 'path'
import { randomUUID } from 'crypto'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const MEDIA_DIR = resolve(DATA_DIR, 'media')

export interface AttachmentMeta {
  id: string
  mediaType: string
  filename: string
  size: number
  ext: string
}

function extFor(mediaType: string, filename: string): string {
  const fromName = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'application/json': 'json',
  }
  return map[mediaType] || 'bin'
}

export function saveAttachment(
  sessionId: string,
  input: { filename: string; mediaType: string; data: string },
): AttachmentMeta {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true })
  const ext = extFor(input.mediaType, input.filename)
  const id = randomUUID()
  const rel = `${sessionId}/${id}.${ext}`
  const abs = resolve(MEDIA_DIR, rel)
  if (!existsSync(resolve(MEDIA_DIR, sessionId))) mkdirSync(resolve(MEDIA_DIR, sessionId), { recursive: true })
  const buf = Buffer.from(input.data, 'base64')
  writeFileSync(abs, buf)
  return { id, mediaType: input.mediaType, filename: input.filename, size: buf.length, ext }
}

export function loadAttachmentBase64(sessionId: string, id: string, ext: string): string | null {
  const abs = resolve(MEDIA_DIR, sessionId, `${id}.${ext}`)
  if (!existsSync(abs)) return null
  return readFileSync(abs).toString('base64')
}

export function deleteSessionMedia(sessionId: string): void {
  const dir = resolve(MEDIA_DIR, sessionId)
  if (!existsSync(dir)) return
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
