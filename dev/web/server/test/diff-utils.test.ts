/**
 * diff-utils.test.ts — 行级 diff 与统一 schema 工具单测（vitest）。
 */
import { describe, expect, it } from 'vitest'
import {
  lineCount, diffLines, isPatchTooLarge, toFileDiff, MAX_PATCH_BYTES,
} from '../src/tools/diff-utils.js'

describe('diff-utils lineCount', () => {
  it('空串/单行/多行/末尾换行', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
    expect(lineCount('a\nb\n')).toBe(2)
    expect(lineCount('中文\n行')).toBe(2)
  })
})

describe('diff-utils diffLines', () => {
  it('追加行：additions 正确', () => {
    expect(diffLines('a\nb', 'a\nb\nc')).toEqual({ additions: 1, deletions: 0 })
  })

  it('删除行：deletions 正确', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual({ additions: 0, deletions: 1 })
  })

  it('修改中间行：增删各 1', () => {
    expect(diffLines('a\nX\nc', 'a\nY\nc')).toEqual({ additions: 1, deletions: 1 })
  })

  it('全量重写（无公共前后缀）', () => {
    expect(diffLines('x', 'y\nz')).toEqual({ additions: 2, deletions: 1 })
  })

  it('无变化：0/0', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual({ additions: 0, deletions: 0 })
  })

  it('空文件 → 内容：additions = 内容行数', () => {
    expect(diffLines('', 'a\nb')).toEqual({ additions: 2, deletions: 0 })
  })

  it('内容 → 空文件：deletions = 内容行数', () => {
    expect(diffLines('a\nb', '')).toEqual({ additions: 0, deletions: 2 })
  })

  it('首行改 + 尾行加：前后缀剥离正确', () => {
    expect(diffLines('A\nb\nc', 'X\nb\nc\nd')).toEqual({ additions: 2, deletions: 1 })
  })
})

describe('diff-utils isPatchTooLarge / toFileDiff', () => {
  it('小 patch 不截断，大 patch 截断', () => {
    expect(isPatchTooLarge('+a\n-b\n')).toBe(false)
    const big = 'x'.repeat(MAX_PATCH_BYTES)
    expect(isPatchTooLarge(big)).toBe(true)
  })

  it('toFileDiff 统一 status 到 created/updated/deleted', () => {
    expect(toFileDiff('a.ts', 'added', 3, 0, '+x\n').status).toBe('created')
    expect(toFileDiff('b.ts', 'modified', 1, 2, '+x\n-y\n').status).toBe('updated')
    expect(toFileDiff('c.ts', 'deleted', 0, 5, '-z\n').status).toBe('deleted')
  })

  it('toFileDiff 对大 patch 置空', () => {
    const big = 'x'.repeat(MAX_PATCH_BYTES)
    expect(toFileDiff('a.ts', 'modified', 1, 0, big).patch).toBe('')
  })
})