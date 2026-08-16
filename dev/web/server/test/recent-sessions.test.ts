import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanMessagePreview, sessionStore, type SessionRow } from '../src/db/sessionStore.js'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-recent-'))
  process.env.TIANSHU_DATA_DIR = root
})

afterAll(async () => {
  const { closeDb } = await import('../src/db/schema.js')
  closeDb()
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

beforeEach(async () => {
  const db = (await import('../src/db/schema.js')).getDb()
  db.exec('DELETE FROM messages')
  db.exec('DELETE FROM sessions')
})

async function addSession(partial: Partial<SessionRow> & { id: string }, updatedAt: number): Promise<SessionRow> {
  const created = sessionStore.create({
    id: partial.id,
    character_id: partial.character_id || 'general',
    title: partial.title ?? '',
    session_type: partial.session_type || 'chat',
    parent_id: partial.parent_id ?? null,
    ...partial,
  })
  await touchUpdatedAt(created.id, updatedAt)
  return created
}

async function addMessage(sessionId: string, role: string, content: string, createdOffsetMs = 0) {
  const db = (await import('../src/db/schema.js')).getDb()
  db.prepare(
    'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
  ).run(sessionId, role, content, Date.now() + createdOffsetMs)
}

async function touchUpdatedAt(id: string, updatedAt: number) {
  const db = (await import('../src/db/schema.js')).getDb()
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(updatedAt, id)
}

describe('sessionStore.listRecent', () => {
  it('更新会话时可将完整行对象绑定到只引用部分字段的 SQL', async () => {
    const created = await addSession({ id: 'update-row', title: '旧标题' }, Date.now())
    expect(created.created_at).toBeTypeOf('number')

    const updated = sessionStore.update(created.id, { title: '新标题' })

    expect(updated?.title).toBe('新标题')
    expect(sessionStore.getById(created.id)?.title).toBe('新标题')
  })

  it('按 updated_at 倒序返回 chat 会话', async () => {
    await addSession({ id: 's1' }, Date.now())
    await addSession({ id: 's2' }, Date.now() - 1000)
    await addSession({ id: 's3' }, Date.now() - 2000)
    const rows = sessionStore.listRecent(3)
    expect(rows.map(r => r.id)).toEqual(['s1', 's2', 's3'])
  })

  it('limit 限制数量（默认 3，最多 10，最少 1）', async () => {
    for (let i = 0; i < 6; i++) await addSession({ id: `s${i}` }, Date.now() - i * 1000)
    expect(sessionStore.listRecent().length).toBe(3)
    expect(sessionStore.listRecent(2).length).toBe(2)
    expect(sessionStore.listRecent(99).length).toBe(6)
    expect(sessionStore.listRecent(0).length).toBe(1)
  })

  it('排除 event 类型会话', async () => {
    await addSession({ id: 'chat-a' }, Date.now())
    await addSession({ id: 'event-x', session_type: 'event' }, Date.now() - 500)
    await addSession({ id: 'chat-b' }, Date.now() - 1000)
    const rows = sessionStore.listRecent(5)
    expect(rows.map(r => r.id)).toEqual(['chat-a', 'chat-b'])
  })

  it('包含最近分支会话', async () => {
    await addSession({ id: 'parent' }, Date.now() - 5000)
    await addSession({ id: 'branch-1', parent_id: 'parent' }, Date.now() - 1000)
    const rows = sessionStore.listRecent(5)
    expect(rows.map(r => r.id)).toContain('branch-1')
    expect(rows[0].id).toBe('branch-1')
  })

  it('预览取最近一条 user/assistant 消息并忽略工具消息', async () => {
    await addSession({ id: 's1' }, Date.now())
    await addMessage('s1', 'tool', '工具输出不该出现在摘要', -3000)
    await addMessage('s1', 'assistant', '好的，已完成', -2000)
    await addMessage('s1', 'tool', '另一个工具', -1000)
    await addMessage('s1', 'user', '继续下一步', 0)
    const [row] = sessionStore.listRecent(1)
    expect(row.last_message_preview).toBe('继续下一步')
  })

  it('摘要压缩换行与连续空白', async () => {
    await addSession({ id: 's1' }, Date.now())
    await addMessage('s1', 'user', '第一行\n\n第二行    有空格\r\n第三行', 0)
    const [row] = sessionStore.listRecent(1)
    expect(row.last_message_preview).toBe('第一行 第二行 有空格 第三行')
  })

  it('Unicode 截断不切坏代理对（emoji）', async () => {
    await addSession({ id: 's1' }, Date.now())
    const emoji = '😀'.repeat(80) // 160 码点
    await addMessage('s1', 'user', emoji, 0)
    const [row] = sessionStore.listRecent(1)
    const preview = row.last_message_preview!
    expect([...preview].length).toBeLessThanOrEqual(120)
    // 代理对完整：末尾不会是孤立代理项
    for (const ch of preview) {
      expect(ch.codePointAt(0)).toBeDefined()
    }
    expect(preview.endsWith('😀')).toBe(true)
  })

  it('无消息时返回 null', async () => {
    await addSession({ id: 's1' }, Date.now())
    const [row] = sessionStore.listRecent(1)
    expect(row.last_message_preview).toBeNull()
  })

  it('消息内容全部是控制字符时回退 null', async () => {
    await addSession({ id: 's1' }, Date.now())
    await addMessage('s1', 'assistant', '\u0000\u0001\u0002  \u0003', 0)
    const [row] = sessionStore.listRecent(1)
    expect(row.last_message_preview).toBeNull()
  })
})

describe('cleanMessagePreview', () => {
  it('空输入返回空串', () => {
    expect(cleanMessagePreview(null)).toBe('')
    expect(cleanMessagePreview('')).toBe('')
  })

  it('去除控制字符', () => {
    expect(cleanMessagePreview('a\u0000b\u0007c')).toBe('a b c')
  })

  it('中文与 ASCII 混合截断到 120 码点', () => {
    const text = '天'.repeat(200)
    const cleaned = cleanMessagePreview(text)
    expect([...cleaned].length).toBe(120)
  })
})

describe('GET /api/sessions/recent', () => {
  it('返回最近会话摘要且带 last_message_preview', async () => {
    const { default: sessionsRouter } = await import('../src/routes/sessions.js')
    await addSession({ id: 'r1', title: '会话一' }, Date.now())
    await addMessage('r1', 'user', '第一条消息内容', 0)
    await addSession({ id: 'r2', title: '会话二' }, Date.now() - 2000)

    const res = await sessionsRouter.request(new Request('http://localhost/recent?limit=3'))
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows.length).toBe(2)
    expect(rows[0].id).toBe('r1')
    expect(rows[0].last_message_preview).toBe('第一条消息内容')
    expect(rows[1].last_message_preview).toBeNull()
  })

  it('limit 越界时按 1..10 收敛', async () => {
    const { default: sessionsRouter } = await import('../src/routes/sessions.js')
    const res = await sessionsRouter.request(new Request('http://localhost/recent?limit=999'))
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows.length).toBeLessThanOrEqual(2)
  })
})
