/**
 * Run: npx tsx src/tools/utils.test.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { assertPathSafe, normalizePathForPlatform, workspaceApprovalRoot } from './utils.js'

if (process.platform === 'win32') {
  const workspace = 'C:\\Users\\example\\project'
  const normalized = normalizePathForPlatform('/c/Users/example/project')
  if (normalized !== workspace) throw new Error(`unexpected normalized path: ${normalized}`)
  assertPathSafe('/c/Users/example/project', [workspace])

  let escaped = false
  try {
    assertPathSafe('/d/outside', [workspace])
  } catch {
    escaped = true
  }
  if (!escaped) throw new Error('a different Git Bash drive must not be authorized')
}

const approvalFixture = mkdtempSync(join(tmpdir(), 'tianshu-approval-root-'))
try {
  const folder = join(approvalFixture, 'folder with spaces')
  const file = join(folder, '新建 文本文档.txt')
  mkdirSync(folder)
  writeFileSync(file, 'test')
  if (workspaceApprovalRoot(file) !== folder) throw new Error('file approval must use its containing directory')
  if (workspaceApprovalRoot(folder) !== folder) throw new Error('directory approval must keep the requested directory')
  if (workspaceApprovalRoot(join(folder, 'future.txt')) !== folder) throw new Error('new file approval must use its containing directory')
  if (workspaceApprovalRoot(file) !== dirname(file)) throw new Error('approval root mismatch')
} finally {
  rmSync(approvalFixture, { recursive: true, force: true })
}

console.log('  OK platform path normalization preserves workspace authorization boundaries')
