/**
 * git-snapshot.test.ts — git 快照仓库模块单测（vitest）。
 *
 * 覆盖：projectKeyFor 稳定性、available() 探测、ensure+track+diff 全链路
 * （修改/新增/删除/黑名单/大 untracked 过滤/patch 截断）。
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-snap-'))
process.env.TIANSHU_DATA_DIR = tmpData

import {
  gitSnapshot, projectKeyFor, MAX_PATCH_BYTES, MAX_UNTRACKED_BYTES,
  createAddedPatch, countLines,
} from '../src/agent/snapshot/git-snapshot.js'

const workTrees: string[] = []
function newWorkTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tianshu-wt-'))
  workTrees.push(dir)
  return dir
}

afterAll(() => {
  rmSync(tmpData, { recursive: true, force: true })
  for (const wt of workTrees) rmSync(wt, { recursive: true, force: true })
})

describe('git-snapshot projectKey / availability', () => {
  it('projectKeyFor 稳定且为 16 位 hex', () => {
    const a = projectKeyFor('C:/foo/bar')
    const b = projectKeyFor('C:/foo/bar')
    const c = projectKeyFor('C:/foo/bar/')
    expect(a).toBe(b)
    expect(a).toBe(c) // 尾部斜杠归一
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('available() 探测到系统 git', () => {
    expect(gitSnapshot.available()).toBe(true)
  })

  it('ensure 拒绝不存在的 workTree', async () => {
    await expect(gitSnapshot.ensure(randomUUID(), join(tmpdir(), 'no-such-dir'))).rejects.toThrow(/not found/)
  })
})

describe('git-snapshot track/diff 全链路', () => {
  it('修改文件：status=modified，行数正确', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    writeFileSync(join(wt, 'a.txt'), 'line1\nline2\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    writeFileSync(join(wt, 'a.txt'), 'line1\nline2\nline3\n', 'utf-8')
    const diffs = await gitSnapshot.diff(key, base!)
    const a = diffs.find(d => d.file === 'a.txt')
    expect(a).toBeTruthy()
    expect(a!.status).toBe('modified')
    expect(a!.additions).toBe(1)
    expect(a!.deletions).toBe(0)
    expect(a!.patch).toContain('+line3')
  })

  it('新增文件：status=added（untracked 路径）', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    writeFileSync(join(wt, 'seed.txt'), 'seed\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    writeFileSync(join(wt, 'new.txt'), 'hello\n', 'utf-8')
    const diffs = await gitSnapshot.diff(key, base!)
    const n = diffs.find(d => d.file === 'new.txt')
    expect(n).toBeTruthy()
    expect(n!.status).toBe('added')
    expect(n!.additions).toBe(1)
    expect(n!.deletions).toBe(0)
    expect(n!.patch).toContain('new file mode')
  })

  it('删除文件：status=deleted', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    writeFileSync(join(wt, 'del.txt'), 'bye\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    rmSync(join(wt, 'del.txt'), { force: true })
    const diffs = await gitSnapshot.diff(key, base!)
    const d = diffs.find(d => d.file === 'del.txt')
    expect(d).toBeTruthy()
    expect(d!.status).toBe('deleted')
    expect(d!.deletions).toBe(1)
  })

  it('无改动时 track 返回 undefined（不产生空 commit）', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)
    const base = await gitSnapshot.track(key)
    expect(base).toBeUndefined()
  })

  it('黑名单目录（node_modules）不进快照', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    mkdirSync(join(wt, 'node_modules'), { recursive: true })
    writeFileSync(join(wt, 'node_modules', 'dep.js'), 'x\n', 'utf-8')
    writeFileSync(join(wt, 'keep.txt'), 'y\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    writeFileSync(join(wt, 'node_modules', 'dep.js'), 'xx\n', 'utf-8')
    writeFileSync(join(wt, 'keep.txt'), 'yy\n', 'utf-8')
    const diffs = await gitSnapshot.diff(key, base!)
    expect(diffs.find(d => d.file.includes('node_modules'))).toBeUndefined()
    expect(diffs.find(d => d.file === 'keep.txt')).toBeTruthy()
  })

  it('大 untracked 文件（>1MB）不进快照', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    writeFileSync(join(wt, 'seed.txt'), 'seed\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    writeFileSync(join(wt, 'big.bin'), Buffer.alloc(MAX_UNTRACKED_BYTES + 1, 0x41))
    writeFileSync(join(wt, 'small.txt'), 's\n', 'utf-8')
    const diffs = await gitSnapshot.diff(key, base!)
    expect(diffs.find(d => d.file === 'big.bin')).toBeUndefined()
    expect(diffs.find(d => d.file === 'small.txt')).toBeTruthy()
  })

  it('patch 超过 MAX_PATCH_BYTES 时只给行数不给 patch', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    // 初始小文件，再改写成超大文件（超出 patch 上限）
    writeFileSync(join(wt, 'big.txt'), 'x\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    const huge = 'x'.repeat(MAX_PATCH_BYTES) + '\n'
    writeFileSync(join(wt, 'big.txt'), huge, 'utf-8')
    const diffs = await gitSnapshot.diff(key, base!)
    const b = diffs.find(d => d.file === 'big.txt')
    expect(b).toBeTruthy()
    expect(b!.patch).toBe('')
    expect(b!.additions).toBe(1)
  })

  it('diffWorking 返回工作区相对 HEAD 的全部未提交改动', async () => {
    const wt = newWorkTree()
    const key = projectKeyFor(wt)
    await gitSnapshot.ensure(key, wt)

    writeFileSync(join(wt, 'f.txt'), 'one\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    writeFileSync(join(wt, 'f.txt'), 'two\n', 'utf-8')
    const diffs = await gitSnapshot.diffWorking(key)
    expect(diffs.find(d => d.file === 'f.txt')?.status).toBe('modified')
  })
})

describe('git-snapshot 辅助函数', () => {
  it('countLines 正确处理末尾换行', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('中文\n行')).toBe(2)
  })

  it('createAddedPatch 生成标准 unified 头', () => {
    const patch = createAddedPatch('x/y.ts', 'a\nb\n')
    expect(patch).toContain('diff --git a/x/y.ts b/x/y.ts')
    expect(patch).toContain('--- /dev/null')
    expect(patch).toContain('+++ b/x/y.ts')
    expect(patch).toContain('+a')
    expect(patch).toContain('+b')
  })
})