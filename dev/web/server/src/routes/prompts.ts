import { Hono } from 'hono'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

const USER_PROMPT_FILE = () => resolve(getDataDir(), 'prompts', 'default.md')
// 单层化：出厂默认提示词经 seed 落到 <dataDir>/prompts/builtin-default.md。
const BUILTIN_PROMPT_FILE = () => resolve(getDataDir(), 'prompts', 'builtin-default.md')

/** 读默认提示词：用户覆盖层优先，否则回退内置只读层。 */
function readDefault(): { content: string; source: 'builtin' | 'user' | null } {
  if (existsSync(USER_PROMPT_FILE())) return { content: readFileSync(USER_PROMPT_FILE(), 'utf-8'), source: 'user' }
  if (existsSync(BUILTIN_PROMPT_FILE())) return { content: readFileSync(BUILTIN_PROMPT_FILE(), 'utf-8'), source: 'builtin' }
  return { content: '', source: null }
}

const router = new Hono()

router.get('/default', (c) => {
  return c.json(readDefault())
})

router.put('/default', async (c) => {
  const body = await c.req.json()
  const content = (body.content || '')
  // 保存空内容 = 恢复内置默认（删除用户覆盖层，回退到 builtin 只读层）。
  if (content === '') {
    if (existsSync(USER_PROMPT_FILE())) rmSync(USER_PROMPT_FILE())
    return c.json({ ok: true, source: existsSync(BUILTIN_PROMPT_FILE()) ? 'builtin' : null })
  }
  mkdirSync(resolve(getDataDir(), 'prompts'), { recursive: true })
  writeFileSync(USER_PROMPT_FILE(), content, 'utf-8')
  return c.json({ ok: true, source: 'user' })
})

export default router
