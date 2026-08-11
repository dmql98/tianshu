/**
 * Run: npx tsx src/tools/write/write.test.ts
 */

import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { tool } from './index.js'

let failed = false
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  OK ${name}`) }
  else { failed = true; console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`) }
}

const dir = mkdtempSync(join(tmpdir(), 'tianshu-write-'))

// parent directory auto-creation
{
  const res = await tool.execute({ path: 'a/b/c/file.txt', content: 'hello' }, { workspace: dir })
  check('auto-creates parent dirs', existsSync(join(dir, 'a', 'b', 'c', 'file.txt')), JSON.stringify(res))
  check('writes content', readFileSync(join(dir, 'a', 'b', 'c', 'file.txt'), 'utf-8') === 'hello')
  check('returns metadata', (res.metadata as any)?.status === 'updated' && (res.metadata as any)?.path === 'a/b/c/file.txt')
}

// identical write is no-op, not conflict
{
  const res = await tool.execute({ path: 'a/b/c/file.txt', content: 'hello' }, { workspace: dir })
  check('identical write is noop', (res.metadata as any)?.status === 'noop', JSON.stringify(res))
  check('noop does not error', !res.error, JSON.stringify(res))
}

// update existing file
{
  const res = await tool.execute({ path: 'a/b/c/file.txt', content: 'hello2' }, { workspace: dir })
  check('update succeeds', (res.metadata as any)?.status === 'updated')
  check('update persists', readFileSync(join(dir, 'a', 'b', 'c', 'file.txt'), 'utf-8') === 'hello2')
}

// BOM preserved on update
{
  const bomPath = join(dir, 'bom.txt')
  writeFileSync(bomPath, '\uFEFForiginal', 'utf-8')
  const res = await tool.execute({ path: 'bom.txt', content: 'changed' }, { workspace: dir })
  const raw = readFileSync(bomPath, 'utf-8')
  check('BOM preserved after update', raw.charCodeAt(0) === 0xFEFF && raw.slice(1) === 'changed', JSON.stringify(raw.split('')))
}

// path escape rejected (assertPathSafe throws)
{
  let threw = false
  try {
    await tool.execute({ path: '../outside.txt', content: 'x' }, { workspace: dir, workspaces: [dir] })
  } catch { threw = true }
  check('path escape rejected', threw)
}

rmSync(dir, { recursive: true, force: true })
if (failed) { process.exit(1) } else { console.log('\n  ALL WRITE TESTS PASSED') }
