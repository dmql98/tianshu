import { Hono } from 'hono'
import { getDataDir, setDataDir, isConfigured, getSystemRunPolicy, setSystemRunPolicy, resetSystemRunPolicy } from '../config.js'
import { DEFAULT_SYSTEM_RUN_POLICY, type SystemRunPolicy } from '../agent/loop/run-policy.js'
import { existsSync, mkdirSync } from 'fs'
import { getDb, closeDb } from '../db/schema.js'
import { materializeAllBuiltinContent, materializeSummary, type MaterializeResult } from '../content/materialize-builtin.js'

const router = new Hono()

router.get('/dataspace', (c) => {
  // 前端启动必调此接口：顺带做一次 builtin 物化兜底（幂等），确保任何启动
  // 路径（含初次安装默认 dataDir、切换后）用户层副本始终存在。
  const result = materializeAllBuiltinContent()
  if (result.failed.length > 0) {
    console.warn(`[config] dataspace materialize failed for ${result.failed.length} item(s): ` +
      result.failed.map(f => `${f.id}: ${f.error}`).join('; '))
  }
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
  // 新 dataDir 可能还没有 builtin 物化副本：立即检测并补齐（幂等，
  // 已有用户副本跳过，不覆盖用户修改）。
  const result: MaterializeResult = materializeAllBuiltinContent()
  if (result.failed.length > 0) {
    console.warn(`[config] materialize after dataDir switch failed for ${result.failed.length} item(s): ` +
      result.failed.map(f => `${f.id}: ${f.error}`).join('; '))
  }
  if (result.materialized.length > 0) {
    console.log(`[config] dataDir switched to ${path}; materialized ${result.materialized.length} builtin item(s)`)
  }
  return c.json({
    ok: true,
    dataDir: path,
    materialized: result.materialized.length,
    skipped: result.skipped.length,
    failed: result.failed,
  })
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
