import { Hono } from 'hono'
import { getDataDir, setDataDir, isConfigured } from '../config.js'
import { existsSync, mkdirSync } from 'fs'
import { getDb, closeDb } from '../db/schema.js'

const router = new Hono()

router.get('/dataspace', (c) => {
  return c.json({ dataDir: getDataDir(), configured: isConfigured() })
})

router.put('/dataspace', async (c) => {
  const body = await c.req.json()
  const path = body.dataDir
  if (!path || typeof path !== 'string') {
    return c.json({ error: 'dataDir is required' }, 400)
  }
  // Ensure directory exists
  if (!existsSync(path)) {
    try { mkdirSync(path, { recursive: true }) } catch (err: any) {
      return c.json({ error: `Cannot create directory: ${err.message}` }, 400)
    }
  }
  setDataDir(path)
  return c.json({ ok: true, dataDir: path })
})

router.post('/reload', (c) => {
  closeDb()
  getDb()
  return c.json({ ok: true, dataDir: getDataDir() })
})

export default router
