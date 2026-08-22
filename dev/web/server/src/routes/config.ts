import { Hono } from 'hono'
import { getDataDir, setDataDir, isConfigured, getSystemRunPolicy, setSystemRunPolicy, resetSystemRunPolicy, getRtkConfig, setRtkConfig } from '../config.js'
import { isRtkAvailable, getRtkVersion, getRtkLatestVersion, isRtkUpdateAvailable, installRtk, updateRtk } from '../tools/rtk.js'
import { DEFAULT_SYSTEM_RUN_POLICY, type SystemRunPolicy } from '../agent/loop/run-policy.js'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { getDb, closeDb } from '../db/schema.js'
import { materializeAllBuiltinContent, materializeSummary, type MaterializeResult } from '../content/materialize-builtin.js'
import { restoreBuiltinCharacter, restoreBuiltinIconPack, restoreBuiltinPrompt, restoreBuiltinProvider } from '../content/copy-on-write.js'
import { restoreBuiltinSkill } from '../agent/skill-catalog.js'
import { builtinCharactersRoot, builtinSkillsRoot, builtinIconPacksRoot, builtinPromptsRoot, builtinProvidersRoot } from '../content/paths.js'
import { charactersRoot, skillsRoot, iconPacksRoot, providersRoot } from '../data-paths.js'

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
 * 重新导入初始配置（恢复出厂内容）：
 * - 删除 dataDir 中"出厂源存在同名"的内置项副本（无论是否编辑/篡改过），再重新物化出厂版；
 * - 保留用户自建内容（出厂源无同名 → kept，绝不触碰）；
 * - 覆盖五类：角色 / 技能 / 图标包 / 默认提示词 / 服务商预设。
 * 效果 = 把搞坏的内置项恢复到出厂内容；自建内容不受影响。
 */
router.post('/reimport-builtin', (c) => {
  const restoredCharacters: string[] = []
  const restoredSkills: string[] = []
  const restoredIconPacks: string[] = []
  const restoredProviders: string[] = []
  let restoredPrompts = 0
  const kept: string[] = []
  const subdirs = (root: string): string[] =>
    existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : []

  // 角色：用户层每个目录，若出厂源存在同名 → 删副本（恢复出厂）。
  const builtinCharIds = new Set(subdirs(builtinCharactersRoot()))
  for (const name of subdirs(charactersRoot())) {
    if (builtinCharIds.has(name)) { restoreBuiltinCharacter(name); restoredCharacters.push(name) }
    else kept.push(`character:${name}`)
  }

  // 技能：用户层 <cat>/<pkg>，出厂源存在同名 → 删副本（恢复出厂）。
  for (const cat of subdirs(skillsRoot())) {
    const builtinPkgIds = new Set(subdirs(resolve(builtinSkillsRoot(), cat)))
    const userCatDir = resolve(skillsRoot(), cat)
    for (const pkg of subdirs(userCatDir)) {
      if (builtinPkgIds.has(pkg)) { restoreBuiltinSkill(cat, pkg); restoredSkills.push(`${cat}/${pkg}`) }
      else kept.push(`skill:${cat}/${pkg}`)
    }
  }

  // 图标包：用户层每个目录，若出厂源存在同名 → 删副本（恢复出厂）。
  const builtinPackIds = new Set(subdirs(builtinIconPacksRoot()))
  for (const name of subdirs(iconPacksRoot())) {
    if (builtinPackIds.has(name)) { restoreBuiltinIconPack(name); restoredIconPacks.push(name) }
    else kept.push(`iconpack:${name}`)
  }

  // 默认提示词（单文件）：出厂源有默认提示词且用户层副本存在 → 恢复出厂。
  if (existsSync(resolve(builtinPromptsRoot(), 'default.md')) && existsSync(resolve(getDataDir(), 'prompts', 'builtin-default.md'))) {
    restoreBuiltinPrompt(); restoredPrompts++
  }

  // 服务商预设（目录树 <dataDir>/providers/<name>）：出厂源有同名 → 删目录（恢复出厂）。
  const builtinProviderNames = new Set(subdirs(builtinProvidersRoot()))
  for (const name of subdirs(providersRoot())) {
    if (builtinProviderNames.has(name)) { restoreBuiltinProvider(name); restoredProviders.push(name) }
    else kept.push(`provider:${name}`)
  }

  // 重新物化出厂副本（补齐缺失项；用户自建项因出厂源无名而跳过保留）。
  const result = materializeAllBuiltinContent()

  return c.json({
    ok: true,
    restoredCharacters,
    restoredSkills,
    restoredIconPacks,
    restoredProviders,
    restoredPrompts,
    kept,
    materialized: result.materialized.length,
    failed: result.failed,
  })
})

export default router
