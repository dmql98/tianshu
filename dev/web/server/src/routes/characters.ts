import { Hono } from 'hono'
import { characterMetaStore } from '../db/characterStore.js'
import type { CharacterRecord } from '../db/characterStore.js'
import { characterContentStore } from '../character/store.js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
import { resolveCharacterTools } from '../tools/definitions.js'

function mergeContent(meta: CharacterRecord, id: string) {
  const content = characterContentStore.get(id)
  const promptFile = resolve(DATA_DIR, 'characters', id, 'prompt.md')
  const customPrompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf-8') : ''
  return { ...meta, tools: resolveCharacterTools(meta.tools), soul: content.soul, userProfile: content.user, memoryContent: content.memory, customPrompt }
}

const router = new Hono()
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
router.post('/', async (c) => {
  const body = await c.req.json() as any
  const { soul, userProfile, memoryContent, customPrompt, ...metaRest } = body
  const meta = characterMetaStore.create(metaRest)
  characterContentStore.save(meta.id, {
    soul: soul as string | undefined,
    user: userProfile as string | undefined,
    memory: memoryContent as string | undefined,
    prompt: customPrompt as string | undefined,
  })
  return c.json({ ...meta, soul: soul || '', userProfile: userProfile || '', memoryContent: memoryContent || '', customPrompt: customPrompt || '' }, 201)
})
router.put('/:id', async (c) => {
  const body = await c.req.json() as any
  const { soul, userProfile, memoryContent, customPrompt, ...metaRest } = body
  const meta = characterMetaStore.update(c.req.param('id'), metaRest)
  if (!meta) return c.json({ error: 'Not found' }, 404)
  characterContentStore.save(meta.id, {
    soul: soul as string | undefined,
    user: userProfile as string | undefined,
    memory: memoryContent as string | undefined,
    prompt: customPrompt as string | undefined,
  })
  return c.json({ ...meta, soul: soul || '', userProfile: userProfile || '', memoryContent: memoryContent || '', customPrompt: customPrompt || '' })
})
router.delete('/:id', (c) => {
  const ok = characterMetaStore.delete(c.req.param('id'))
  return ok ? c.json({ success: true }) : c.json({ error: 'Not found' }, 404)
})
export default router
