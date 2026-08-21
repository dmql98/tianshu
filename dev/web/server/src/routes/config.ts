import { Hono } from 'hono'
import { getDataDir, setDataDir, isConfigured, getSystemRunPolicy, setSystemRunPolicy, resetSystemRunPolicy, getRtkConfig, setRtkConfig } from '../config.js'
import { isRtkAvailable, getRtkVersion, getRtkLatestVersion, isRtkUpdateAvailable, installRtk, updateRtk } from '../tools/rtk.js'
import { DEFAULT_SYSTEM_RUN_POLICY, type SystemRunPolicy } from '../agent/loop/run-policy.js'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { getDb, closeDb } from '../db/schema.js'
import { materializeAllBuiltinContent, materializeSummary, type MaterializeResult } from '../content/materialize-builtin.js'
import { restoreBuiltinCharacter } from '../content/copy-on-write.js'
import { restoreBuiltinSkill } from '../agent/skill-catalog.js'
import { builtinCharactersRoot, builtinSkillsRoot } from '../content/paths.js'
import { charactersRoot, skillsRoot } from '../data-paths.js'

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

// ── RTK (Rust Token Killer) 集成 ──

router.get('/rtk', async (c) => {
  const config = getRtkConfig()
  const available = isRtkAvailable()
  const version = available ? getRtkVersion() : ''
  const latestVersion = await getRtkLatestVersion()
  const updateAvailable = available && !!version && !!latestVersion
    ? (await isRtkUpdateAvailable())
    : false
  return c.json({ config, available, version, latestVersion, updateAvailable })
})

router.put('/rtk', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const config = setRtkConfig(body?.config ?? body)
  return c.json({ ok: true, config })
})

router.post('/rtk/install', (c) => {
  const result = installRtk()
  return c.json({ ok: result.ok, output: result.output })
})

router.post('/rtk/update', (c) => {
  const result = updateRtk()
  return c.json({ ok: result.ok, output: result.output })
})

/**
 * 重新导入初始配置：删除所有"有 builtin 出厂版对应"的用户层副本（无论是否
 * 编辑过），保留用户自建的角色/技能，然后重新物化 builtin 出厂版。
 * 效果 = 把搞坏的内置角色/技能恢复到出厂内容；自建内容不受影响。
 */
router.post('/reimport-builtin', (c) => {
  const restoredChars: string[] = []
  const restoredSkills: string[] = []
  const kept: string[] = []

  // 角色：用户层每个目录，若 builtin 层存在同名 → 删副本（恢复出厂）。
  const builtinCharIds = new Set<string>()
  if (existsSync(builtinCharactersRoot())) {
    for (const e of readdirSync(builtinCharactersRoot(), { withFileTypes: true })) {
      if (e.isDirectory()) builtinCharIds.add(e.name)
    }
  }
  if (existsSync(charactersRoot())) {
    for (const e of readdirSync(charactersRoot(), { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      if (builtinCharIds.has(e.name)) {
        restoreBuiltinCharacter(e.name)
        restoredChars.push(e.name)
      } else {
        kept.push(`character:${e.name}`)
      }
    }
  }

  // 技能：用户层 <cat>/<pkg>，builtin 层存在同名 → 删副本（恢复出厂）。
  if (existsSync(skillsRoot()) && existsSync(builtinSkillsRoot())) {
    for (const cat of readdirSync(skillsRoot(), { withFileTypes: true })) {
      if (!cat.isDirectory()) continue
      const builtinCatDir = resolve(builtinSkillsRoot(), cat.name)
      const builtinPkgIds = new Set<string>()
      if (existsSync(builtinCatDir)) {
        for (const p of readdirSync(builtinCatDir, { withFileTypes: true })) {
          if (p.isDirectory()) builtinPkgIds.add(p.name)
        }
      }
      const userCatDir = resolve(skillsRoot(), cat.name)
      for (const p of readdirSync(userCatDir, { withFileTypes: true })) {
        if (!p.isDirectory()) continue
        if (builtinPkgIds.has(p.name)) {
          restoreBuiltinSkill(cat.name, p.name)
          restoredSkills.push(`${cat.name}/${p.name}`)
        } else {
          kept.push(`skill:${cat.name}/${p.name}`)
        }
      }
    }
  }

  // 重新物化出厂副本。
  const result = materializeAllBuiltinContent()

  return c.json({
    ok: true,
    restoredCharacters: restoredChars,
    restoredSkills,
    kept,
    materialized: result.materialized.length,
    failed: result.failed,
  })
})

export default router
