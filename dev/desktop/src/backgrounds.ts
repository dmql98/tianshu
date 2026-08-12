import { app, dialog, net, protocol, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { basename, extname, join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { randomBytes } from 'crypto'
import type {
  BackgroundImageInfo,
  OpenImageDialogResult,
  SaveBackgroundImageInput,
} from '../../shared/desktop-contract.js'

/**
 * 背景图落盘与加载：
 * - 图片文件保存在 userData/backgrounds/，文件名由主进程生成（custom-<ts>-<rand>.<ext>）。
 * - renderer 通过自定义协议 tianshu-bg://backgrounds/<fileName> 加载，
 *   主进程做文件名白名单 + 路径穿越校验后映射到磁盘文件。
 */

const SCHEME = 'tianshu-bg'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MiB
const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}
const DATA_URL_PATTERN = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/=]+)$/
/** 只允许安全的文件名，拒绝任何路径分隔符与特殊字符。 */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function backgroundsDir(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

/** 校验文件名并返回安全的绝对路径；非法时返回 null。 */
function safeBackgroundPath(fileName: string): string | null {
  if (!FILE_NAME_PATTERN.test(fileName)) return null
  const dir = resolve(backgroundsDir())
  const filePath = resolve(join(dir, fileName))
  if (!filePath.startsWith(dir + sep)) return null
  return filePath
}

/** 必须在 app ready 之前调用（registerSchemesAsPrivileged 限制）。 */
export function registerBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** 在 app ready 之后调用，把 tianshu-bg:// 映射到 userData/backgrounds。 */
export function registerBackgroundProtocolHandler(): void {
  mkdirSync(backgroundsDir(), { recursive: true })
  protocol.handle(SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'backgrounds') {
        return new Response('forbidden', { status: 403 })
      }
      const fileName = url.pathname.replace(/^\//, '').split('/').pop() ?? ''
      const filePath = safeBackgroundPath(fileName)
      if (!filePath || !existsSync(filePath)) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

/** 扩展名 + 魔数双重校验，返回 MIME；不合法返回 null。 */
function detectMime(filePath: string, buf: Buffer): string | null {
  const byExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const mime = byExt[extname(filePath).toLowerCase()]
  if (!mime) return null
  if (mime === 'image/png' && buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return mime
  if (mime === 'image/jpeg' && buf.length >= 3 &&
      buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return mime
  if (mime === 'image/webp' && buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return mime
  return null
}

export async function openImageDialog(win: BrowserWindow | null): Promise<OpenImageDialogResult> {
  if (!win) return { canceled: true }
  const result = await dialog.showOpenDialog(win, {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  const filePath = result.filePaths[0]
  try {
    const buf = readFileSync(filePath)
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
      return { canceled: true }
    }
    const mimeType = detectMime(filePath, buf)
    if (!mimeType) {
      return { canceled: true }
    }
    return {
      canceled: false,
      image: {
        fileName: basename(filePath),
        dataUrl: `data:${mimeType};base64,${buf.toString('base64')}`,
        sizeBytes: buf.length,
        mimeType,
      },
    }
  } catch {
    return { canceled: true }
  }
}

export function saveBackgroundImage(input: SaveBackgroundImageInput): BackgroundImageInfo {
  const match = DATA_URL_PATTERN.exec(input.dataUrl)
  if (!match) {
    throw new Error('不支持的图片格式（仅支持 PNG / JPEG / WebP）')
  }
  const mime = match[1]
  const buf = Buffer.from(match[2], 'base64')
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    throw new Error('图片大小超出限制（最大 10MB）')
  }
  const ext = ALLOWED_MIME[mime]
  const fileName = `custom-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
  const dir = backgroundsDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, fileName), buf)
  return {
    fileName,
    url: `${SCHEME}://backgrounds/${fileName}`,
    sizeBytes: buf.length,
  }
}

export function deleteBackgroundImage(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${SCHEME}:`) return false
    const fileName = parsed.pathname.replace(/^\//, '').split('/').pop() ?? ''
    const filePath = safeBackgroundPath(fileName)
    if (!filePath) return false
    if (!existsSync(filePath)) return true // 已不存在视为成功
    unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}
