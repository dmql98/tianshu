import { Hono } from 'hono'
import { characterMetaStore } from '../db/characterStore.js'
import type { CharacterRecord } from '../db/characterStore.js'
import { characterContentStore } from '../character/store.js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getDb } from '../db/schema.js'
import { getDataDir } from '../config.js'
import { findSkillPackage } from '../agent/skill-catalog.js'

const DATA_DIR = getDataDir()
import { resolveCharacterTools } from '../tools/definitions.js'
import { characterRevisionStore } from '../character/revision-store.js'
import { characterVisualStore, type CharacterVisual, type CharacterAssetKind } from '../character/visual-store.js'
import { characterPresenceProjector } from '../character/presence-projector.js'
import { touchPlayerLease } from '../character/asset-refs.js'
import { gzipSync, gunzipSync } from 'zlib'

function mergeContent(meta: CharacterRecord, id: string) {
  const content = characterContentStore.get(id)
  const promptFile = resolve(DATA_DIR, 'characters', id, 'prompt.md')
  const customPrompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf-8') : ''
  return { ...meta, tools: resolveCharacterTools(meta.tools), soul: content.soul, userProfile: content.user, memoryContent: content.memory, customPrompt }
}

const router = new Hono()
const ORIGINAL_MAX_BYTES = 20 * 1024 * 1024
const CHARACTER_ASSET_MAX_BYTES = 50 * 1024 * 1024
router.get('/', (c) => {
  const includeHidden = c.req.query('all') === 'true'
  const chars = characterMetaStore.getAll()
    .filter(r => includeHidden || !r.hidden)
    .map(r => mergeContent(r, r.id))
  return c.json(chars)
})
router.get('/:id', (c) => {
  const record = characterMetaStore.getById(c.req.param('id'))
  if (!record) return c.json({ error: 'Not found' }, 404)
  return c.json(mergeContent(record, record.id))
})
router.get('/:id/revisions', (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  return c.json(characterRevisionStore.list(id).map(revision => ({
    ...revision,
    snapshot: JSON.parse(revision.snapshot),
    visual_manifest: revision.visual_manifest ? JSON.parse(revision.visual_manifest) : null,
  })))
})
router.get('/:id/visual', (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  return c.json({
    visual: characterVisualStore.get(id),
    assets: characterVisualStore.listAssets(id),
  })
})
router.put('/:id/visual', async (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  try {
    return c.json(characterVisualStore.save(id, await c.req.json<CharacterVisual>()))
  } catch (error: any) {
    return c.json({ error: error.message || String(error) }, 400)
  }
})
router.post('/:id/assets', async (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) return c.json({ error: 'A multipart file is required' }, 400)
  const purpose = body.purpose === 'original' ? 'original' : undefined
  const maxBytes = purpose === 'original' ? ORIGINAL_MAX_BYTES : CHARACTER_ASSET_MAX_BYTES
  if (file.size > maxBytes) {
    return c.json({ error: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit` }, 413)
  }
  if (purpose === 'original' && !file.type.startsWith('image/')) {
    return c.json({ error: 'Original artwork must be an image' }, 400)
  }
  const kind = typeof body.kind === 'string' ? body.kind as CharacterAssetKind : undefined
  const asset = characterVisualStore.addAsset(id, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
    mime: file.type,
    kind,
  })
  return c.json(asset, 201)
})
router.get('/:id/assets/:assetId', (c) => {
  const stored = characterVisualStore.getAsset(c.req.param('id'), c.req.param('assetId'))
  if (!stored) return c.json({ error: 'Not found' }, 404)
  // A live fetch refreshes the player lease so in-use assets survive GC.
  touchPlayerLease(c.req.param('id'), stored.asset.assetId, 60 * 60 * 1000)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  c.header('Accept-Ranges', 'bytes')
  const range = c.req.header('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      const size = stored.size
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? parseInt(match[2], 10) : size - 1
      if (start >= size || end >= size) {
        c.header('Content-Range', `bytes */${size}`)
        return c.body(null, 416)
      }
      const chunk = readFileSync(stored.file).subarray(start, end + 1)
      c.header('Content-Type', stored.asset.mime)
      c.header('Content-Length', String(chunk.length))
      c.header('Content-Range', `bytes ${start}-${end}/${size}`)
      return c.body(chunk, 206)
    }
  }
  c.header('Content-Type', stored.asset.mime)
  c.header('Content-Length', String(stored.size))
  return c.body(readFileSync(stored.file))
})
router.delete('/:id/assets/:assetId', (c) => {
  const result = characterVisualStore.removeAsset(c.req.param('id'), c.req.param('assetId'))
  return result.ok ? c.json({ ok: true }) : c.json({ error: result.reason }, result.reason === 'Asset not found' ? 404 : 409)
})
router.get('/:id/presence', (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  return c.json(characterPresenceProjector.get(id))
})
router.get('/:id/export', (c) => {
  const id = c.req.param('id')
  const meta = characterMetaStore.getById(id)
  if (!meta) return c.json({ error: 'Not found' }, 404)
  const content = characterContentStore.get(id)
  const visual = characterVisualStore.get(id)
  const assets = characterVisualStore.listAssets(id).map(asset => {
    const stored = characterVisualStore.getAsset(id, asset.assetId)
    return stored ? {
      ...asset,
      data: readFileSync(stored.file).toString('base64'),
    } : null
  }).filter(Boolean)
  const payload = gzipSync(JSON.stringify({
    packageVersion: 1,
    exportedAt: Date.now(),
    character: meta,
    content,
    visual,
    assets,
  }))
  c.header('Content-Type', 'application/gzip')
  c.header('Content-Disposition', `attachment; filename="${id}.tianshu-character.gz"`)
  return c.body(payload)
})
const PACKAGE_MAX_ASSETS = 100
const PACKAGE_MAX_TOTAL_BYTES = 300 * 1024 * 1024
const PACKAGE_MAX_SINGLE_BYTES = 50 * 1024 * 1024

function validateCharacterPackage(pkg: {
  packageVersion: number
  character?: { name?: string }
  visual?: CharacterVisual
  assets?: Array<{ filename: string; mime: string; kind: CharacterAssetKind; data: string }>
}): void {
  if (pkg.packageVersion !== 1) throw new Error('Unsupported character package version')
  if (!pkg.character?.name?.trim()) throw new Error('Package is missing character name')
  const assets = pkg.assets || []
  if (assets.length > PACKAGE_MAX_ASSETS) {
    throw new Error(`Package has ${assets.length} assets; limit is ${PACKAGE_MAX_ASSETS}`)
  }
  let total = 0
  const kinds = new Set<CharacterAssetKind>(['static', 'animated-image', 'video', 'sprite-sheet', 'frame-sequence'])
  for (const asset of assets) {
    if (!/^(image|video)\//.test(asset.mime)) throw new Error(`Disallowed asset type: ${asset.mime}`)
    if (asset.kind && !kinds.has(asset.kind)) throw new Error(`Invalid asset kind: ${asset.kind}`)
    const size = Math.floor((asset.data?.length || 0) * 3 / 4)
    if (size > PACKAGE_MAX_SINGLE_BYTES) throw new Error(`Asset ${asset.filename} exceeds the ${Math.round(PACKAGE_MAX_SINGLE_BYTES / 1024 / 1024)} MB limit`)
    total += size
  }
  if (total > PACKAGE_MAX_TOTAL_BYTES) {
    throw new Error(`Package exceeds the ${Math.round(PACKAGE_MAX_TOTAL_BYTES / 1024 / 1024)} MB total limit`)
  }
  if (pkg.visual && pkg.visual.schemaVersion !== 1) throw new Error('Unsupported visual schema version')
}

router.post('/import', async (c) => {
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) return c.json({ error: 'A character package file is required' }, 400)
  const conflict = typeof body.conflict === 'string' ? body.conflict : 'error'
  try {
    const raw = gunzipSync(new Uint8Array(await file.arrayBuffer()))
    if (raw.length > PACKAGE_MAX_TOTAL_BYTES) throw new Error('Package exceeds size limit')
    const pkg = JSON.parse(raw.toString('utf8')) as {
      packageVersion: number
      character: CharacterRecord
      content?: { soul?: string; user?: string; memory?: string }
      visual?: CharacterVisual
      assets?: Array<{
        assetId: string
        filename: string
        mime: string
        kind: CharacterAssetKind
        data: string
      }>
    }
    validateCharacterPackage(pkg)
    let requestedId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : pkg.character.id
    if (characterMetaStore.getById(requestedId)) {
      if (conflict === 'new') {
        requestedId = `${requestedId}_import_${Date.now()}`
      } else if (conflict !== 'replace') {
        throw new Error(`Character "${requestedId}" already exists (use conflict=replace to overwrite or conflict=new for a copy)`)
      }
    }
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...meta } = pkg.character
    let created: CharacterRecord
    if (conflict === 'replace' && characterMetaStore.getById(requestedId)) {
      created = characterMetaStore.update(requestedId, meta) as CharacterRecord
      characterVisualStore.clearAssets(requestedId)
    } else {
      created = characterMetaStore.create({ ...meta, id: requestedId })
    }
    characterContentStore.save(created.id, pkg.content || {})
    const assetMap = new Map<string, string>()
    for (const asset of pkg.assets || []) {
      const added = characterVisualStore.addAsset(created.id, {
        bytes: Buffer.from(asset.data, 'base64'),
        filename: asset.filename,
        mime: asset.mime,
        kind: asset.kind,
      })
      assetMap.set(asset.assetId, added.assetId)
    }
    if (pkg.visual) {
      const remap = (assetId?: string) => assetId ? assetMap.get(assetId) : undefined
      characterVisualStore.save(created.id, {
        ...pkg.visual,
        originalAssetId: remap(pkg.visual.originalAssetId),
        avatarAssetId: remap(pkg.visual.avatarAssetId),
        portraitAssetId: remap(pkg.visual.portraitAssetId),
        motions: Object.fromEntries(
          Object.entries(pkg.visual.motions || {}).flatMap(([motion, binding]) => {
            const assetId = remap(binding?.assetId)
            return assetId ? [[motion, { ...binding, assetId }]] : []
          }),
        ),
      })
    }
    const revision = characterRevisionStore.publish(created.id)
    return c.json({ character: mergeContent(created, created.id), revision }, 201)
  } catch (error: any) {
    return c.json({ error: error.message || String(error) }, 400)
  }
})
router.post('/:id/revisions', (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  return c.json(characterRevisionStore.publish(id), 201)
})
router.post('/:id/archive', (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  characterRevisionStore.ensureCurrent(id)
  characterRevisionStore.archive(id)
  characterMetaStore.update(id, { hidden: true, enabled: false })
  return c.json({ ok: true })
})
router.post('/', async (c) => {
  const body = await c.req.json() as any
  const { soul, userProfile, memoryContent, customPrompt, ...metaRest } = body
  let meta
  try {
    meta = characterMetaStore.create(metaRest)
  } catch (e: any) {
    return c.json({ error: e.message }, 409)
  }
  characterContentStore.save(meta.id, {
    soul: soul as string | undefined,
    user: userProfile as string | undefined,
    memory: memoryContent as string | undefined,
    prompt: customPrompt as string | undefined,
  })
  return c.json(mergeContent(meta, meta.id), 201)
})
router.post('/:id/skill-bindings', async (c) => {
  const id = c.req.param('id')
  const record = characterMetaStore.getById(id)
  if (!record) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json() as { action?: 'bind' | 'unbind'; packageId?: string }
  if (!body.packageId || !['bind', 'unbind'].includes(body.action || '')) {
    return c.json({ error: 'action (bind/unbind) and packageId are required' }, 400)
  }
  if (body.action === 'bind' && !findSkillPackage(body.packageId)) {
    return c.json({ error: `Skill package "${body.packageId}" not found` }, 404)
  }
  const current = record.skillBindings || []
  const next = body.action === 'bind'
    ? current.some(binding => binding.packageId === body.packageId) ? current : [...current, { packageId: body.packageId, enabled: true, preloadSkills: [] }]
    : current.filter(binding => binding.packageId !== body.packageId)
  const updated = characterMetaStore.update(id, { skillBindings: next, skills: next.map(binding => binding.packageId) })
  return c.json(updated)
})
router.put('/:id', async (c) => {
  const body = await c.req.json() as any
  const { soul, userProfile, memoryContent, customPrompt, id: newId, ...metaRest } = body
  const oldId = c.req.param('id')
  let currentId = oldId
  // Handle ID rename
  if (newId && newId !== oldId) {
    try {
      const renamed = characterMetaStore.rename(oldId, newId)
      if (!renamed) return c.json({ error: 'Not found' }, 404)
      currentId = newId
    } catch (e: any) {
      return c.json({ error: e.message }, 409)
    }
  }
  const meta = characterMetaStore.update(currentId, metaRest)
  if (!meta) return c.json({ error: 'Not found' }, 404)
  characterContentStore.save(meta.id, {
    soul: soul as string | undefined,
    user: userProfile as string | undefined,
    memory: memoryContent as string | undefined,
    prompt: customPrompt as string | undefined,
  })
  return c.json(mergeContent(meta, meta.id))
})
router.delete('/:id', (c) => {
  const id = c.req.param('id')
  if (!characterMetaStore.getById(id)) return c.json({ error: 'Not found' }, 404)
  characterRevisionStore.ensureCurrent(id)
  characterRevisionStore.archive(id)
  characterMetaStore.update(id, { hidden: true, enabled: false })
  return c.json({ success: true, archived: true })
})
router.get('/:id/stats', (c) => {
  const id = c.req.param('id')
  const db = getDb()
  const sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions WHERE character_id = ?').get(id) as any)?.count || 0
  const lastActive = (db.prepare('SELECT MAX(updated_at) as ts FROM sessions WHERE character_id = ?').get(id) as any)?.ts || null
  return c.json({ sessionCount, lastActive })
})
export default router
