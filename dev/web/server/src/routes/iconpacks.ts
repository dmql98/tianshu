/**
 * 图标包 API（ICON_PACK_PLAN §6）。
 *
 * GET    /api/iconpacks
 * POST   /api/iconpacks                 { name } 创建空图标库
 * PUT    /api/iconpacks/:id             { name } 重命名
 * DELETE /api/iconpacks/:id
 * PUT    /api/iconpacks/:id/slots/:slotKey      multipart：{ file, tint } 上传/替换单槽位
 * DELETE /api/iconpacks/:id/slots/:slotKey      移除槽位（还原内置）
 * PUT    /api/iconpacks/__overrides__/slots/:slotKey   multipart 设置全局覆盖
 * DELETE /api/iconpacks/__overrides__/slots/:slotKey   移除全局覆盖
 * GET    /api/iconpacks/:id/assets/:file        资产下发（CSP sandbox）
 *
 * 来源：内置只读层（content/builtin/iconpacks/<id>/）+ 用户层（<dataDir>/iconpacks/<id>/）
 * 共用同一 pack.json + assets 结构与同一套接口（source=builtin/user 区分）。
 *
 * 安全：id/文件名/槽位 key 全部服务端校验；内置包只读；SVG sanitize；资产路由
 * 只访问已登记文件；返回不可执行内容策略。
 */
import { Hono, type Context } from 'hono'
import { readFileSync } from 'fs'
import {
  OVERRIDES_PACK_ID,
  isBuiltinIconPackId,
  isValidIconPackId,
  isValidIconSlotKey,
  isWritableIconPackId,
} from '../iconpacks/schema.js'
import {
  createIconPack,
  deleteIconPack,
  getIconPack,
  getOverrides,
  isAllowedAssetExt,
  listIconPacks,
  mimeForAsset,
  removeIconSlot,
  renameIconPack,
  resolveIconAsset,
  saveIconSlot,
  validateIconAsset,
} from '../iconpacks/store.js'

const router = new Hono()

/** 包 → 视图（资产引用转 URL）。 */
function packView(record: { id: string; name: string; slots: Record<string, { file: string; tint: boolean }>; createdAt: string; updatedAt: string }) {
  const slots: Record<string, { url: string; tint: boolean }> = {}
  for (const [key, ref] of Object.entries(record.slots)) {
    slots[key] = {
      url: `/api/iconpacks/${encodeURIComponent(record.id)}/assets/${encodeURIComponent(ref.file)}`,
      tint: ref.tint,
    }
  }
  return {
    id: record.id,
    name: record.name,
    source: isBuiltinIconPackId(record.id) ? 'builtin' : 'user',
    readOnly: isBuiltinIconPackId(record.id),
    slots,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    slotCount: Object.keys(record.slots).length,
  }
}

router.get('/', (c) => {
  const { packs, skipped } = listIconPacks()
  if (skipped.length > 0) {
    console.warn(`[iconpacks] skipped ${skipped.length} invalid pack(s):`, skipped.map(s => `${s.dir}(${s.reason})`).join(', '))
  }
  const overrides = getOverrides()
  const overrideSlots = overrides?.slots ?? {}
  return c.json({
    packs: packs.map(packView),
    overrides: Object.keys(overrideSlots).length > 0
      ? packView({ id: OVERRIDES_PACK_ID, name: OVERRIDES_PACK_ID, slots: overrideSlots, createdAt: overrides?.createdAt ?? '', updatedAt: overrides?.updatedAt ?? '' }).slots
      : {},
  })
})

router.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return c.json({ error: 'Icon pack name is required' }, 400)
    const record = createIconPack(name)
    return c.json(packView(record), 201)
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Failed to create icon pack' }, 400)
  }
})

router.put('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isValidIconPackId(id) || isBuiltinIconPackId(id)) return c.json({ error: 'Invalid pack id' }, 400)
  if (!getIconPack(id)) return c.json({ error: 'Icon pack not found' }, 404)
  try {
    const body = await c.req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return c.json({ error: 'Icon pack name is required' }, 400)
    const record = renameIconPack(id, name)
    return c.json(packView(record))
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Failed to rename icon pack' }, 400)
  }
})

router.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (!isValidIconPackId(id) || isBuiltinIconPackId(id)) return c.json({ error: 'Invalid pack id' }, 400)
  try {
    const result = deleteIconPack(id)
    return c.json({ ok: result.deleted })
  } catch (err: any) {
    return c.json({ error: err?.message ?? 'Failed to delete icon pack' }, 400)
  }
})

/** 解析 multipart 中的图标资产字段（file 必须为上传文件，tint 为勾选标记）。 */
async function parseSlotUpload(c: Context): Promise<{
  slotKey: string
  bytes: Uint8Array
  filename: string
  format: 'svg' | 'png' | 'webp'
  tint: boolean
}> {
  const body = await c.req.parseBody()
  const raw = body as Record<string, unknown>
  const slotKey = c.req.param('slotKey')
  if (!isValidIconSlotKey(slotKey)) throw new Error(`Unknown icon slot: ${slotKey}`)
  const file = raw.file
  if (!(file instanceof File)) throw new Error('Missing "file" multipart field')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const validated = validateIconAsset(bytes)
  if (!validated.ok) throw new Error(validated.message)
  const ext = `.${validated.format}`
  // 服务端生成文件名：不信任原始文件名（防路径注入/扩展名伪装）
  const filename = `icon-${Math.random().toString(36).slice(2, 10)}${ext}`
  const tint = raw.tint === 'true' || raw.tint === '1' || raw.tint === true
  return { slotKey, bytes, filename, format: validated.format, tint }
}

router.put('/:id/slots/:slotKey', async (c) => {
  const id = c.req.param('id')
  // 可写目标：覆盖层或已存在的用户包（内置包只读）
  if (id !== OVERRIDES_PACK_ID && (isBuiltinIconPackId(id) || !getIconPack(id))) {
    return c.json({ error: 'Icon pack not found or read-only' }, 404)
  }
  try {
    const input = await parseSlotUpload(c)
    const record = saveIconSlot(id, { ...input, slotKey: input.slotKey })
    return c.json(packView(record))
  } catch (err: any) {
    const status = err?.message?.includes('limit') || err?.message?.includes('Only') ? 400 : 400
    return c.json({ error: err?.message ?? 'Failed to save icon slot' }, status)
  }
})

router.delete('/:id/slots/:slotKey', (c) => {
  const id = c.req.param('id')
  const slotKey = c.req.param('slotKey')
  if (!isWritableIconPackId(id) || !isValidIconSlotKey(slotKey)) return c.json({ error: 'Invalid params' }, 400)
  const result = removeIconSlot(id, slotKey)
  return c.json({ ok: result.ok, slot: result.slot })
})

router.get('/:id/assets/:file', (c) => {
  const id = c.req.param('id')
  const file = c.req.param('file')
  if (!isValidIconPackId(id) || !isAllowedAssetExt(file)) return c.json({ error: 'Not found' }, 404)
  const path = resolveIconAsset(id, file)
  if (!path) return c.json({ error: 'Not found' }, 404)
  c.header('Content-Type', mimeForAsset(file))
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  c.header('X-Content-Type-Options', 'nosniff')
  // SVG 由 sanitize 清洗过；仍以 sandbox + default-src none 兜底
  c.header('Content-Security-Policy', "default-src 'none'; sandbox")
  return c.body(readFileSync(path))
})

export default router
