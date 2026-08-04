import { Hono } from 'hono'
import { getDb } from '../db/schema.js'
import { messageStore } from '../db/messageStore.js'

const router = new Hono()

router.post('/:id/revise', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid message id' }, 400)
  const original = messageStore.getById(id)
  if (!original) return c.json({ error: 'Not found' }, 404)
  if (original.role !== 'user') return c.json({ error: 'Only user messages can be revised' }, 400)
  const body = await c.req.json<{ content?: string }>()
  const content = body.content?.trim()
  if (!content) return c.json({ error: 'Content is required' }, 400)

  getDb().transaction(() => {
    getDb().prepare(`
      UPDATE messages SET status = 'superseded'
      WHERE session_id = ? AND id >= ? AND status = 'active'
    `).run(original.session_id, original.id)
    if (original.turn_id) {
      const turn = getDb().prepare('SELECT ordinal FROM turns WHERE id = ?')
        .get(original.turn_id) as { ordinal: number } | undefined
      if (turn) {
        getDb().prepare(`
          UPDATE turns SET status = 'superseded'
          WHERE session_id = ? AND ordinal >= ?
        `).run(original.session_id, turn.ordinal)
      }
    }
    getDb().prepare(`
      UPDATE sessions SET compaction_summary = NULL, compaction_until_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), original.session_id)
  })()

  return c.json({
    session_id: original.session_id,
    supersedes_message_id: original.id,
    content,
  })
})

export default router

