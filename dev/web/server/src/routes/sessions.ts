import { Hono } from 'hono'
import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { eventService } from '../event/eventService.js'

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
  if (session.event_id) {
    eventService.delete(session.event_id)
    console.log('[cascade] deleted event %s with session %s', session.event_id, id)
  }
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
router.get('/:id/messages', (c) => {
  const id = c.req.param('id')
  const session = sessionStore.getById(id)
  if (!session) return c.json({ error: 'Not found' }, 404)
  const messages = messageStore.getMessages(id)
  return c.json({ session, messages, total: messages.length })
})

export default router
