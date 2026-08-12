import { Hono } from 'hono'
import { getDataDir, setDataDir, isConfigured, getSystemRunPolicy, setSystemRunPolicy, resetSystemRunPolicy } from '../config.js'
import { DEFAULT_SYSTEM_RUN_POLICY, type SystemRunPolicy } from '../agent/loop/run-policy.js'
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

// ── System run policy (RUN_LIMIT_POLICY_PLAN §12.1) ──

router.get('/run-policy', (c) => {
  return c.json<{ policy: SystemRunPolicy; defaults: SystemRunPolicy }>({
    policy: getSystemRunPolicy(),
    defaults: DEFAULT_SYSTEM_RUN_POLICY,
  })
})

router.put('/run-policy', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const policy = setSystemRunPolicy(body?.policy ?? body)
  return c.json<{ ok: true; policy: SystemRunPolicy; defaults: SystemRunPolicy }>({
    ok: true,
    policy,
    defaults: DEFAULT_SYSTEM_RUN_POLICY,
  })
})

router.post('/run-policy/reset', (c) => {
  const policy = resetSystemRunPolicy()
  return c.json<{ ok: true; policy: SystemRunPolicy; defaults: SystemRunPolicy }>({
    ok: true,
    policy,
    defaults: DEFAULT_SYSTEM_RUN_POLICY,
  })
})

router.post('/reload', (c) => {
  closeDb()
  getDb()
  return c.json({ ok: true, dataDir: getDataDir() })
})

export default router
