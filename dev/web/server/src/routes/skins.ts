import { Hono } from 'hono'
import { readFileSync } from 'fs'
import { skinStore, type SkinMotion, SKIN_MOTIONS } from '../skin/skin-store.js'

const router = new Hono()
const SKIN_FILE_MAX_BYTES = 60 * 1024 * 1024

function isMotionSlot(v: string): v is SkinMotion {
  return (SKIN_MOTIONS as string[]).includes(v)
}

router.get('/', (c) => {
  return c.json(skinStore.list())
})

router.post('/', async (c) => {
  const body = await c.req.json() as { id?: string; name: string; description?: string }
  if (!body.name) return c.json({ error: 'Skin name is required' }, 400)
  try {
    const skin = skinStore.create({ id: body.id, name: body.name, description: body.description })
    return c.json(skin, 201)
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 400)
  }
})

router.get('/:id', (c) => {
  const skin = skinStore.get(c.req.param('id'))
  if (!skin) return c.json({ error: 'Not found' }, 404)
  return c.json(skin)
})

router.put('/:id', async (c) => {
  const body = await c.req.json() as { name?: string; description?: string; boundCharacters?: string[] }
  try {
    const skin = skinStore.update(c.req.param('id'), body)
    return c.json(skin)
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 404)
  }
})

router.delete('/:id', (c) => {
  const result = skinStore.remove(c.req.param('id'))
  if (!result.ok) return c.json({ error: result.reason || 'Not found' }, 404)
  return c.json({ success: true })
})

/** 上传文件：slot = portrait | avatar | motion（idle/thinking/working/speaking/success/error）。 */
router.post('/:id/upload/:slot', async (c) => {
  const skinId = c.req.param('id')
  const slot = c.req.param('slot')
  if (slot !== 'portrait' && slot !== 'avatar' && !isMotionSlot(slot)) {
    return c.json({ error: `Invalid slot: ${slot}` }, 400)
  }
  const skin = skinStore.get(skinId)
  if (!skin) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) return c.json({ error: 'A multipart file is required' }, 400)
  if (file.size > SKIN_FILE_MAX_BYTES) {
    return c.json({ error: `File exceeds the ${Math.round(SKIN_FILE_MAX_BYTES / 1024 / 1024)} MB limit` }, 413)
  }
  const updated = skinStore.upload(skinId, slot, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
    mime: file.type,
  })
  return c.json(updated, 201)
})

/** 静态读取某个语义文件。 */
router.get('/:id/file/:filename', (c) => {
  const stored = skinStore.getFile(c.req.param('id'), c.req.param('filename'))
  if (!stored) return c.json({ error: 'Not found' }, 404)
  c.header('Content-Type', stored.mime)
  c.header('Cache-Control', 'no-cache')
  return c.body(readFileSync(stored.file), 200)
})

/** 绑定/解绑角色（记录归属；皮肤可复用）。 */
router.post('/:id/bind', async (c) => {
  const body = await c.req.json() as { characterId: string; bind: boolean }
  try {
    const skin = skinStore.bindCharacter(c.req.param('id'), body.characterId, body.bind)
    return c.json(skin)
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 404)
  }
})

export default router
