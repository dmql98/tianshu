import { Hono } from 'hono'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

const DEFAULT_PROMPT_FILE = () => resolve(getDataDir(), 'prompts', 'default.md')

const router = new Hono()

router.get('/default', (c) => {
  if (!existsSync(DEFAULT_PROMPT_FILE())) return c.json({ content: '' })
  return c.json({ content: readFileSync(DEFAULT_PROMPT_FILE(), 'utf-8') })
})

router.put('/default', async (c) => {
  const body = await c.req.json()
  mkdirSync(resolve(getDataDir(), 'prompts'), { recursive: true })
  writeFileSync(DEFAULT_PROMPT_FILE(), (body.content || ''), 'utf-8')
  return c.json({ ok: true })
})

export default router
