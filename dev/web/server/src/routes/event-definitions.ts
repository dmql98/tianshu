import { Hono } from 'hono'
import { eventDefinitionStore } from '../event/definition-store.js'
import { eventOccurrenceStore } from '../event/occurrence-store.js'
import { scheduleOccurrence } from '../event/event-run-adapter.js'
import { getDb } from '../db/schema.js'

const router = new Hono()

router.get('/', (c) => c.json(eventDefinitionStore.list()))
router.post('/', async (c) => {
  try {
    return c.json(eventDefinitionStore.create(await c.req.json()), 201)
  } catch (error: any) {
    return c.json({ error: error.message || String(error) }, 400)
  }
})
router.get('/:id/occurrences', (c) => {
  const definition = eventDefinitionStore.get(c.req.param('id'))
  if (!definition) return c.json({ error: 'Not found' }, 404)
  return c.json(eventOccurrenceStore.list(definition.id))
})
router.post('/:id/fire', (c) => {
  const definition = eventDefinitionStore.get(c.req.param('id'))
  if (!definition) return c.json({ error: 'Not found' }, 404)
  try {
    const occurrence = eventOccurrenceStore.create(definition, { triggerType: 'manual' })
    scheduleOccurrence(occurrence.id)
    return c.json(occurrence, 201)
  } catch (error: any) {
    return c.json({ error: error.message || String(error) }, 400)
  }
})
router.post('/occurrences/:id/retry', (c) => {
  const occurrence = eventOccurrenceStore.get(c.req.param('id'))
  if (!occurrence) return c.json({ error: 'Not found' }, 404)
  const definition = eventDefinitionStore.get(occurrence.definition_id)
  if (!definition) return c.json({ error: 'Definition not found' }, 404)
  if (occurrence.status === 'running' || occurrence.status === 'pending') {
    return c.json({ error: 'Occurrence is already active' }, 409)
  }
  getDb().prepare(`
    UPDATE event_occurrences SET status = 'pending', error = NULL, updated_at = ? WHERE id = ?
  `).run(Date.now(), occurrence.id)
  scheduleOccurrence(occurrence.id)
  return c.json(eventOccurrenceStore.get(occurrence.id), 202)
})

router.post('/:id/archive', (c) => {
  const updated = eventDefinitionStore.update(c.req.param('id'), { status: 'archived' })
  return updated ? c.json(updated) : c.json({ error: 'Not found' }, 404)
})

router.post('/:id/restore', (c) => {
  const updated = eventDefinitionStore.update(c.req.param('id'), { status: 'active' })
  return updated ? c.json(updated) : c.json({ error: 'Not found' }, 404)
})

router.delete('/:id', (c) => {
  const definition = eventDefinitionStore.get(c.req.param('id'))
  if (!definition) return c.json({ error: 'Not found' }, 404)
  const db = getDb()
  const deleted = db.transaction(() => {
    // Occurrences reference the definition (FK is ON); their event sessions
    // are left in place so conversation history is not destroyed.
    db.prepare('DELETE FROM event_occurrences WHERE definition_id = ?').run(definition.id)
    return db.prepare('DELETE FROM event_definitions WHERE id = ?').run(definition.id).changes > 0
  })()
  return deleted ? c.json({ ok: true }) : c.json({ error: 'Delete failed' }, 500)
})

export default router
