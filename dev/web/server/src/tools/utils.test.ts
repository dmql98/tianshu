/**
 * Run: npx tsx src/tools/utils.test.ts
 */

import { assertPathSafe, normalizePathForPlatform } from './utils.js'

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

console.log('  OK platform path normalization preserves workspace authorization boundaries')
