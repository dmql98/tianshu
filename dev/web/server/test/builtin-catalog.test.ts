import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-builtin-catalog-'))
  process.env.TIANSHU_DATA_DIR = join(root, 'data')
  process.env.TIANSHU_CONFIG_DIR = join(root, 'config')
  mkdirSync(join(root, 'data'), { recursive: true })
  mkdirSync(join(root, 'config'), { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
  delete process.env.TIANSHU_CONFIG_DIR
})

beforeEach(async () => {
  const { resetContentStateCache } = await import('../src/content/state.js')
  resetContentStateCache()
  rmSync(join(root, 'data'), { recursive: true, force: true })
  mkdirSync(join(root, 'data'), { recursive: true })
})

describe('builtin + userdata 双层合并', () => {
  it('只读 content/builtin 能被扫描：至少返回内置角色与技能（source=builtin, readOnly=true）', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const chars = characterMetaStore.getAll()
    const builtin = chars.filter(c => c.source === 'builtin')
    expect(builtin.length).toBeGreaterThan(0)
    for (const c of builtin) {
      expect(c.readOnly).toBe(true)
      expect(c.overridesBuiltin).toBe(false)
    }

    const { listSkillPackages } = await import('../src/agent/skill-catalog.js')
    const skills = listSkillPackages()
    const builtinSkills = skills.filter(s => s.source === 'builtin')
    expect(builtinSkills.length).toBeGreaterThan(0)
    for (const s of builtinSkills) {
      expect(s.readOnly).toBe(true)
    }
  })

  it('同 ID 用户内容完整覆盖内置内容（无逐字段隐式合并）', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    // 找一个内置角色，在用户层创建同 ID 完整副本并修改 name
    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin')!
    const userDir = join(root, 'data', 'characters', builtin.id)
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'character.json'), JSON.stringify({
      id: builtin.id,
      name: '我的自定义版本',
      description: '用户覆盖',
      enabled: true,
    }, null, 2), 'utf-8')

    const merged = characterMetaStore.getById(builtin.id)!
    expect(merged.source).toBe('user')
    expect(merged.readOnly).toBe(false)
    expect(merged.overridesBuiltin).toBe(true)
    expect(merged.name).toBe('我的自定义版本')
    // 用户副本没有 soul.md 时不会回退内置 soul（完整覆盖语义由内容 store 的
    // characterDir 保证——用户目录存在即优先）。
  })

  it('隐藏状态生效：内置角色被隐藏后普通列表不返回，all=true 可见', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const { setHidden } = await import('../src/content/state.js')
    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin')!
    setHidden('characters', builtin.id, true)

    const normal = characterMetaStore.getAll()
    expect(normal.some(c => c.id === builtin.id)).toBe(false)
    const withHidden = characterMetaStore.getAllIncludingHidden()
    expect(withHidden.some(c => c.id === builtin.id)).toBe(true)
  })

  it('内置技能隐藏后不出现在普通列表', async () => {
    const { listSkillPackages } = await import('../src/agent/skill-catalog.js')
    const { setHidden } = await import('../src/content/state.js')
    const builtin = listSkillPackages().find(s => s.source === 'builtin')!
    setHidden('skills', builtin.id, true)
    expect(listSkillPackages().some(s => s.id === builtin.id)).toBe(false)
  })

  it('内置角色 runPolicy 声明为角色层偏好，且只读', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin' && c.runPolicy)
    expect(builtin).toBeTruthy()
    const rp = builtin!.runPolicy!
    // 只允许角色层字段，不得包含 SystemRunPolicy 字段
    expect(rp.version).toBe(1)
    expect(rp).not.toHaveProperty('dynamicLimitEnabled')
    expect(rp).not.toHaveProperty('maxAbsoluteTurnsPerRun')
    expect(rp).not.toHaveProperty('noProgressThreshold')
  })

  it('内置角色能解析出 effectivePreview（受系统边界约束）', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin' && c.runPolicy)!
    const { getSystemRunPolicy } = await import('../src/config.js')
    const { resolveRunPolicy } = await import('../src/agent/loop/run-policy-resolver.js')
    const snap = resolveRunPolicy(getSystemRunPolicy(), builtin.runPolicy)
    expect(snap.effective.absoluteTurns).toBeLessThanOrEqual(getSystemRunPolicy().maxAbsoluteTurnsPerRun)
  })
})
