import { Hono } from 'hono'
import { eventService } from '../event/eventService.js'
import { scheduleImmediate, triggerAndRun } from '../event/eventScheduler.js'

const router = new Hono()

router.get('/', (c) => {
  const status = c.req.query('status')
  const source_type = c.req.query('source_type')
  const limit = c.req.query('limit')
  const offset = c.req.query('offset')
  return c.json(eventService.list({
    status: status as any || undefined,
    source_type: source_type || undefined,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  }))
})

router.get('/:id', (c) => {
  const event = eventService.getById(c.req.param('id'))
  if (!event) return c.json({ error: 'Not found' }, 404)
  return c.json(event)
})

router.post('/', async (c) => {
  const body = await c.req.json()
  try {
    const event = eventService.create({
      source_type: body.source_type || 'user',
      source_id: body.source_id,
      source_meta: body.source_meta,
      assigned_agent_id: body.assigned_agent_id,
      assigned_group_id: body.assigned_group_id,
      model: body.model,
      provider_id: body.provider_id,
      workspace: body.workspace,
      type: body.type || 'once',
      cron_expr: body.cron_expr,
      payload: body.payload,
      status: body.status,
      priority: body.priority,
      scheduled_at: body.scheduled_at,
    })
    scheduleImmediate()
    return c.json(event, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

router.post('/:id/trigger', async (c) => {
  const ok = await triggerAndRun(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found or not pending' }, 400)
  return c.json({ ok: true })
})

router.post('/:id/archive', (c) => {
  if (!eventService.archive(c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

router.post('/archive-old', async (c) => {
  const body = await c.req.json()
  const hours = body.hours ?? 24
  const count = eventService.archiveOld(hours)
  return c.json({ ok: true, archived: count })
})

router.patch('/:id/status', async (c) => {
  const body = await c.req.json()
  const updated = eventService.updateStatus(c.req.param('id'), body.status, body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})

router.delete('/:id', (c) => {
  if (!eventService.delete(c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export default router
