import { Hono } from 'hono'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const DEFAULT_PROMPT_FILE = resolve(DATA_DIR, 'prompts', 'default.md')

const router = new Hono()

router.get('/default', (c) => {
  if (!existsSync(DEFAULT_PROMPT_FILE)) return c.json({ content: '' })
  return c.json({ content: readFileSync(DEFAULT_PROMPT_FILE, 'utf-8') })
})

router.put('/default', async (c) => {
  const body = await c.req.json()
  mkdirSync(resolve(DATA_DIR, 'prompts'), { recursive: true })
  writeFileSync(DEFAULT_PROMPT_FILE, (body.content || ''), 'utf-8')
  return c.json({ ok: true })
})

export default router
