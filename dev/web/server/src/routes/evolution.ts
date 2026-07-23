import { Hono } from 'hono'
import { evolutionConfig } from '../evolution/evolutionConfig.js'

const router = new Hono()

router.get('/', (c) => {
  return c.json(evolutionConfig.get())
})

router.put('/', async (c) => {
  const body = await c.req.json()
  return c.json(evolutionConfig.set(body))
})

router.post('/clear', (c) => {
  evolutionConfig.clear()
  return c.json({ ok: true })
})

export default router
