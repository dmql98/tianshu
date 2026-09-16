/**
 * cloud/sync/differ.test.ts — 纯函数单测：上传/拉取决策 + 备份路径。
 * 运行：npm test（vitest run，desktop 包内）。
 */

import { describe, expect, it } from 'vitest'
import { decideUploads, decidePulls, backupPath, type LocalFile } from '../src/cloud/sync/differ'
import type { RemoteFileEntry } from '../src/cloud/contracts-sync/sync-contract'

const cloud = (over: Partial<RemoteFileEntry> & { path: string; hash: string }): RemoteFileEntry => ({
  size: 3,
  mtime: 1,
  originDevice: 'dev-1',
  updatedAt: 1000,
  deletedAt: null,
  ...over,
})

describe('decideUploads', () => {
  it('云端无此文件 → upload(new)', () => {
    const local: LocalFile = { path: 'characters/x/a.md', hash: 'h1', size: 3, mtime: 500 }
    expect(decideUploads([local], [])).toEqual([{ kind: 'upload', path: 'characters/x/a.md', reason: 'new' }])
  })

  it('hash 相同 → skip(same)', () => {
    const local: LocalFile = { path: 'characters/x/a.md', hash: 'h1', size: 3, mtime: 500 }
    const remote = [cloud({ path: 'characters/x/a.md', hash: 'h1' })]
    expect(decideUploads([local], remote)).toEqual([{ kind: 'skip', path: 'characters/x/a.md', reason: 'same' }])
  })

  it('内容不同 → conflict-keep-local（发出上传，由服务端 LWW 裁决）', () => {
    const local: LocalFile = { path: 'characters/x/a.md', hash: 'h2', size: 3, mtime: 999 }
    const remote = [cloud({ path: 'characters/x/a.md', hash: 'h1', updatedAt: 1000 })]
    const ops = decideUploads([local], remote)
    expect(ops[0]).toMatchObject({ kind: 'conflict-keep-local', path: 'characters/x/a.md', cloudMtime: 1000, localMtime: 999 })
  })
})

describe('decidePulls', () => {
  it('本地无 → download(new)', () => {
    const ops = decidePulls([cloud({ path: 'characters/x/a.md', hash: 'h1' })], [])
    expect(ops).toEqual([{ kind: 'download', path: 'characters/x/a.md', hash: 'h1', reason: 'new' }])
  })

  it('hash 相同 → skip', () => {
    const local: LocalFile = { path: 'characters/x/a.md', hash: 'h1', size: 3, mtime: 500 }
    const ops = decidePulls([cloud({ path: 'characters/x/a.md', hash: 'h1' })], [local])
    expect(ops).toEqual([{ kind: 'skip', path: 'characters/x/a.md', reason: 'same' }])
  })

  it('云端较新 → download(changed)；拉取语义=云端覆盖本地（本地较新也下载）', () => {
    const local: LocalFile = { path: 'characters/x/a.md', hash: 'h-local', size: 3, mtime: 5000 }
    const ops = decidePulls([cloud({ path: 'characters/x/a.md', hash: 'h-cloud', updatedAt: 1000 })], [local])
    expect(ops).toEqual([{ kind: 'download', path: 'characters/x/a.md', hash: 'h-cloud', reason: 'changed' }])
  })

  it('云端墓碑 + 本地存在 → delete-local', () => {
    const local: LocalFile = { path: 'characters/x/a.md', hash: 'h1', size: 3, mtime: 500 }
    const ops = decidePulls([cloud({ path: 'characters/x/a.md', hash: 'h1', deletedAt: 2000 })], [local])
    expect(ops).toEqual([{ kind: 'delete-local', path: 'characters/x/a.md', reason: 'cloud-tombstone' }])
  })

  it('云端墓碑 + 本地不存在 → 无动作', () => {
    const ops = decidePulls([cloud({ path: 'characters/x/a.md', hash: 'h1', deletedAt: 2000 })], [])
    expect(ops).toEqual([])
  })
})

describe('backupPath', () => {
  it('生成 .sync-backup/<utc-stamp>/<rel>', () => {
    const p = backupPath('characters/x/a.md', Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(p).toMatch(/^\.sync-backup\/2026-01-02T03-04-05-000Z\/characters\/x\/a\.md$/)
  })
})
