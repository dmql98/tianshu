import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tianshu-copyonwrite-'))
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

afterEach(async () => {
  const { closeDb } = await import('../src/db/schema.js')
  closeDb()
})

describe('copy-on-write（BUILTIN_CONTENT_DEVELOPMENT_PLAN §5）', () => {
  it('编辑内置角色自动物化完整用户副本，且不复制运行状态', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin')!

    // 触发编辑（update 内部先 materialize）
    const updated = characterMetaStore.update(builtin.id, { description: '已自定义' })
    expect(updated).toBeTruthy()

    const userDir = join(root, 'data', 'characters', builtin.id)
    expect(existsSync(userDir)).toBe(true)
    expect(existsSync(join(userDir, 'character.json'))).toBe(true)
    expect(existsSync(join(userDir, 'soul.md'))).toBe(true)
    // 运行状态不复制
    expect(existsSync(join(userDir, 'memory.md'))).toBe(false)
    expect(existsSync(join(userDir, 'revisions'))).toBe(false)
    // 来源文件标记
    expect(existsSync(join(userDir, '.tianshu-source.json'))).toBe(true)
    const source = JSON.parse(readFileSync(join(userDir, '.tianshu-source.json'), 'utf-8'))
    expect(source.kind).toBe('builtin-fork')
    expect(source.builtinId).toBe(builtin.id)

    const merged = characterMetaStore.getById(builtin.id)!
    expect(merged.source).toBe('user')
    expect(merged.overridesBuiltin).toBe(true)
    expect(merged.description).toBe('已自定义')
  })

  it('内置角色 runPolicy 进入用户副本、revision 快照和新 Run 策略', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const { characterRevisionStore } = await import('../src/character/revision-store.js')
    const { getDb } = await import('../src/db/schema.js')
    const { sessionStore } = await import('../src/db/sessionStore.js')
    const { runStore } = await import('../src/agent/runtime/run-store.js')

    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin' && c.runPolicy)!
    // 编辑 runPolicy → materialize 用户副本
    const updated = characterMetaStore.update(builtin.id, { runPolicy: { version: 1, softTurns: 80, graceTurns: 8 } })
    expect(updated?.runPolicy?.softTurns).toBe(80)

    // revision 快照包含副本的 runPolicy
    const revision = characterRevisionStore.publish(builtin.id)
    const snapshot = JSON.parse(revision.snapshot)
    expect(snapshot.meta.runPolicy.softTurns).toBe(80)

    // 新 Run 使用 pinned revision 解析策略快照
    const session = sessionStore.create({
      id: `sess_cow_${Date.now()}`,
      character_id: builtin.id,
      title: 'cow-test',
      character_binding_mode: 'pinned',
      pinned_character_revision_id: revision.id,
    } as any)
    const run = runStore.create(session, { source: 'chat' })
    expect(run.character_revision_id).toBe(revision.id)
    const policy = runStore.policySnapshot(run.id)!
    expect(policy.character.softTurns).toBe(80)
    expect(policy.effective.softTurns).toBe(80)

    void getDb
  })

  it('已启动 Run 不受角色副本后续修改影响（快照固定）', async () => {
    const { characterMetaStore } = await import('../src/db/characterStore.js')
    const { characterRevisionStore } = await import('../src/character/revision-store.js')
    const { sessionStore } = await import('../src/db/sessionStore.js')
    const { runStore } = await import('../src/agent/runtime/run-store.js')

    const builtin = characterMetaStore.getAll().find(c => c.source === 'builtin' && c.runPolicy)!
    // 首次编辑物化，固定 revision
    characterMetaStore.update(builtin.id, { runPolicy: { version: 1, softTurns: 40 } })
    const rev1 = characterRevisionStore.publish(builtin.id)

    const session = sessionStore.create({
      id: `sess_pin_${Date.now()}`,
      character_id: builtin.id,
      title: 'pin-test',
      character_binding_mode: 'pinned',
      pinned_character_revision_id: rev1.id,
    } as any)
    const run = runStore.create(session, { source: 'chat' })
    expect(run.character_revision_id).toBe(rev1.id)

    // 后续修改副本 → 产生新 revision，但已启动 Run 的快照不变
    characterMetaStore.update(builtin.id, { runPolicy: { version: 1, softTurns: 999 } })
    characterRevisionStore.publish(builtin.id)

    const pinned = runStore.policySnapshot(run.id)!
    expect(pinned.character.softTurns).toBe(40)
    expect(pinned.effective.softTurns).toBe(40)
  })

  it('materialize 失败不留下可扫描的半成品（缺 character.json 的内置项）', async () => {
    const { materializeCharacter } = await import('../src/content/copy-on-write.js')

    // 在临时 builtin 覆盖根下造一个缺少 character.json 的内置角色
    const fakeBuiltin = join(root, 'fake-builtin')
    const prev = process.env.TIANSHU_BUILTIN_CONTENT_DIR
    process.env.TIANSHU_BUILTIN_CONTENT_DIR = fakeBuiltin
    try {
      mkdirSync(join(fakeBuiltin, 'characters', 'broken-char'), { recursive: true })
      expect(() => materializeCharacter('broken-char')).toThrow()
      const userDir = join(root, 'data', 'characters', 'broken-char')
      expect(existsSync(userDir)).toBe(false)
      // staging 目录不残留
      const { readdirSync } = await import('fs')
      const entries = readdirSync(join(root, 'data', 'characters'))
      expect(entries.every(e => !e.includes('materialize'))).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.TIANSHU_BUILTIN_CONTENT_DIR
      else process.env.TIANSHU_BUILTIN_CONTENT_DIR = prev
    }
  })

  it('编辑内置技能自动物化完整用户副本（含 SKILL.md 与 skill-package.json）', async () => {
    const { listSkillPackages, ensureSkillPackageWritable } = await import('../src/agent/skill-catalog.js')
    const builtin = listSkillPackages().find(s => s.source === 'builtin')!

    const writable = ensureSkillPackageWritable(builtin.category, builtin.id)
    expect(writable.source).toBe('user')
    expect(writable.overridesBuiltin).toBe(true)

    const userDir = join(root, 'data', 'skills', builtin.category, builtin.id)
    expect(existsSync(join(userDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(userDir, 'skill-package.json'))).toBe(true)
    expect(existsSync(join(userDir, '.tianshu-source.json'))).toBe(true)
  })
})
