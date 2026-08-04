import { Hono } from 'hono'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { getDb } from '../db/schema.js'

const router = new Hono()

router.get('/', (c) => c.json(sessionStore.list()))
router.post('/', async (c) => {
  const body = await c.req.json()
  const session = sessionStore.create({ id: body.id, ...body })
  return c.json(session, 201)
})
router.put('/:id', async (c) => {
  const body = await c.req.json()
  const updated = sessionStore.update(c.req.param('id'), body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})
router.delete('/:id', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  sessionStore.delete(id)
  return c.json({ ok: true })
})
router.delete('/:id/messages', (c) => {
  const keep = c.req.query('keep')
  if (!keep) return c.json({ error: 'Missing keep param' }, 400)
  const count = parseInt(keep, 10)
  if (isNaN(count) || count < 0) return c.json({ error: 'Invalid keep param' }, 400)
  messageStore.keepFirst(c.req.param('id'), count)
  return c.json({ ok: true })
})
router.get('/:id/children', (c) => {
  const id = c.req.param('id')
  return c.json(sessionStore.getChildren(id))
})
router.post('/:id/fork', async (c) => {
  const sourceId = c.req.param('id')
  const source = sessionStore.getById(sourceId)
  if (!source) return c.json({ error: 'Not found' }, 404)

  const body = await c.req.json()
  const targetId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID()
  if (sessionStore.getById(targetId)) return c.json({ error: 'Session id already exists' }, 409)

  const messages = messageStore.getMessages(sourceId)
  let throughIndex = -1
  if (body.message_id != null && /^\d+$/.test(String(body.message_id))) {
    throughIndex = messages.findIndex(message => message.id === Number(body.message_id))
  }
  if (throughIndex < 0 && Number.isInteger(body.message_count)) {
    throughIndex = Math.min(messages.length, Math.max(0, body.message_count)) - 1
  }
  if (throughIndex < 0 || messages[throughIndex]?.role !== 'assistant') {
    return c.json({ error: 'A valid assistant message is required' }, 400)
  }

  const result = getDb().transaction(() => {
    const title = sessionStore.nextForkTitle(source.title)
    const session = sessionStore.create({
      id: targetId,
      character_id: source.character_id,
      title,
      model: source.model,
      provider_id: source.provider_id,
      workspace: source.workspace,
      workspaces: source.workspaces,
      dataspace: source.dataspace,
      parent_id: null,
      character_binding_mode: source.character_binding_mode,
      pinned_character_revision_id: source.pinned_character_revision_id,
      forked_from_session_id: source.id,
      forked_from_message_id: messages[throughIndex].id,
      active_group: source.active_group,
      session_type: 'chat',
      event_id: null,
      current_strategy: source.current_strategy,
      approval_mode: source.approval_mode,
      execution_mode: source.execution_mode,
      reasoning_effort: source.reasoning_effort,
      context_window: source.context_window,
    })
    messageStore.copyFirst(sourceId, targetId, throughIndex + 1)
    return { session, messages: messageStore.getMessages(targetId) }
  })()

  return c.json(result, 201)
})
router.get('/:id/messages', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  const messages = messageStore.getMessages(id, 100000)
  return c.json({ session, messages, total: messages.length })
})

export default router
