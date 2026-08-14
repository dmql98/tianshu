/**
 * 主题 API（TIANSHU_THEME_SWITCHING_PLAN §8）。
 *
 * GET    /api/themes
 * GET    /api/themes/:id
 * POST   /api/themes                    （multipart 创建）
 * PUT    /api/themes/:id                （multipart 更新；或 JSON {name} 重命名）
 * POST   /api/themes/:id/duplicate
 * DELETE /api/themes/:id
 * GET    /api/themes/:id/assets
 * GET    /api/themes/:id/assets/:file
 *
 * 服务端规则：
 * - id/文件名/路径全部服务端校验，拒绝 traversal、绝对路径与目录外访问。
 * - 图片只接受 JPEG/PNG/静态 WebP（magic bytes + 结构解码 + 尺寸限制）。
 * - 资产路由只访问已登记在有效 theme.json 中的文件；返回不可执行内容策略。
 * - 列表扫描遇到损坏主题时跳过并记录诊断，不让整个接口失败。
 */
import { Hono, type Context } from 'hono'
import { readFileSync } from 'fs'
import { extname } from 'path'
import { isValidAssetFileName, isValidThemeId, REGISTERED_COLOR_SLOTS, type ColorSlot, type ThemeRecord } from '../theme/schema.js'
import {
  cleanupTempDirs,
  deleteTheme,
  duplicateTheme,
  getTheme,
  listThemeAssets,
  listThemes,
  renameTheme,
  saveTheme,
  themeAssetPath,
  validateUploadedImage,
  type ThemeAssetInput,
} from '../theme/store.js'

const router = new Hono()

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function themeView(record: ThemeRecord) {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    name: record.name,
    appearance: record.appearance,
    ...(record.artwork ? { artwork: record.artwork } : {}),
    ...(record.home ? { home: record.home } : {}),
    colors: record.colors,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

router.get('/', (c) => {
  const { themes, skipped } = listThemes()
  if (skipped.length > 0) {
    console.warn(`[themes] skipped ${skipped.length} invalid theme(s):`, skipped.map(s => `${s.dir}(${s.reason})`).join(', '))
  }
  return c.json({ themes: themes.map(themeView) })
})

router.get('/:id', (c) => {
  const id = c.req.param('id')
  const record = getTheme(id)
  if (!record) return c.json({ error: 'Theme not found' }, 404)
  return c.json(themeView(record))
})

router.get('/:id/assets', (c) => {
  const id = c.req.param('id')
  if (!getTheme(id)) return c.json({ error: 'Theme not found' }, 404)
  const assets = listThemeAssets(id)
  return c.json({ assets })
})

router.get('/:id/assets/:file', (c) => {
  const id = c.req.param('id')
  const file = c.req.param('file')
  if (!isValidThemeId(id) || !isValidAssetFileName(file)) return c.json({ error: 'Not found' }, 404)
  const path = themeAssetPath(id, file)
  if (!path) return c.json({ error: 'Not found' }, 404)
  const ext = extname(path).toLowerCase()
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
  c.header('Content-Type', mime)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Content-Security-Policy', "default-src 'none'; sandbox")
  return c.body(readFileSync(path))
})

async function parseImageField(body: Record<string, unknown>, key: string): Promise<ThemeAssetInput | undefined> {
  const file = body[key]
  if (!file) return undefined
  if (!(file instanceof File)) throw new Error(`Invalid multipart field "${key}"`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = key === 'preview' ? 'preview' : 'background'
  const validated = validateUploadedImage(bytes, kind)
  if (!validated.ok) throw new Error(validated.message)
  return {
    kind,
    bytes,
    filename: validated.filename,
    mime: validated.mime,
    width: validated.width,
    height: validated.height,
  }
}

async function parseThemeBody(c: Context): Promise<{
  name: string
  appearance: 'light' | 'dark'
  colors: Record<string, string>
  artwork: Record<string, unknown>
  home: Record<string, unknown>
  background?: ThemeAssetInput
  preview?: ThemeAssetInput
}> {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody()
    const raw = body as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const appearance: 'light' | 'dark' = raw.appearance === 'dark' ? 'dark' : 'light'

    let colors: Record<string, string> = {}
    if (typeof raw.colors === 'string') {
      try {
        const parsed = JSON.parse(raw.colors)
        if (parsed && typeof parsed === 'object') {
          for (const slot of REGISTERED_COLOR_SLOTS) {
            const value = (parsed as Record<string, unknown>)[slot]
            if (typeof value === 'string' && /^(#[0-9a-f]{6}|rgba?\([\d\s.,%]+\))$/i.test(value)) {
              colors[slot as ColorSlot] = value
            }
          }
        }
      } catch { /* 非法 colors 视为空，由 schema 校验拒绝 */ }
    }

    let artwork: Record<string, unknown> = {}
    if (typeof raw.artwork === 'string') {
      try {
        const parsed = JSON.parse(raw.artwork)
        if (parsed && typeof parsed === 'object') artwork = parsed as Record<string, unknown>
      } catch { /* ignore */ }
    }

    let home: Record<string, unknown> = {}
    if (typeof raw.home === 'string') {
      try {
        const parsed = JSON.parse(raw.home)
        if (parsed && typeof parsed === 'object') home = parsed as Record<string, unknown>
      } catch { /* ignore */ }
    }

    const background = await parseImageField(raw, 'background')
    const preview = await parseImageField(raw, 'preview')

    return { name, appearance, colors, artwork, home, background, preview }
  }

  // JSON 请求（重命名等轻量操作）
  const body = await c.req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const appearance: 'light' | 'dark' = body.appearance === 'dark' ? 'dark' : 'light'
  const colors = typeof body.colors === 'object' && body.colors ? body.colors as Record<string, string> : {}
  const artwork = typeof body.artwork === 'object' && body.artwork ? body.artwork as Record<string, unknown> : {}
  const home = typeof body.home === 'object' && body.home ? body.home as Record<string, unknown> : {}
  return { name, appearance, colors, artwork, home }
}

router.post('/', async (c) => {
  try {
    const input = await parseThemeBody(c)
    if (!input.name) return c.json({ error: 'Theme name is required' }, 400)
    if (!input.colors.canvas || !input.colors.textPrimary || !input.colors.accent) {
      return c.json({ error: 'Colors must include canvas, textPrimary and accent' }, 400)
    }
    const id = `custom-${randomSuffix()}`
    const record = saveTheme(id, input)
    return c.json(themeView(record), 201)
  } catch (err: any) {
    const status = err?.message?.includes('limit') || err?.message?.includes('Only JPEG') ? 400 : 400
    return c.json({ error: err?.message ?? 'Failed to create theme' }, status)
  }
})

router.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!getTheme(id)) return c.json({ error: 'Theme not found' }, 404)
  try {
    const input = await parseThemeBody(c)
    if (!input.name) return c.json({ error: 'Theme name is required' }, 400)
    if (input.colors.canvas && input.colors.textPrimary && input.colors.accent) {
      const record = saveTheme(id, input)
      return c.json(themeView(record))
    }
    // 只重命名（JSON {name} 轻量路径）
    const record = renameTheme(id, input.name)
    return c.json(themeView(record))
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Failed to update theme' }, 400)
  }
})

router.post('/:id/duplicate', (c) => {
  const id = c.req.param('id')
  try {
    const record = duplicateTheme(id)
    return c.json(themeView(record), 201)
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Failed to duplicate theme' }, err?.message?.includes('not found') ? 404 : 400)
  }
})

router.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (!isValidThemeId(id)) return c.json({ error: 'Invalid theme id' }, 400)
  const result = deleteTheme(id)
  return c.json({ ok: result.deleted })
})

/** 启动时清理临时目录（挂载时执行一次；也可由生命周期调用）。 */
export function initThemeStore(): void {
  try { cleanupTempDirs() } catch { /* ignore */ }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10)
}

export default router
