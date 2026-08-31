/**
 * Run: npx tsx src/tools/write/write.test.ts
 */

import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
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
  check('returns metadata', (res.metadata as any)?.status === 'created' && (res.metadata as any)?.path === 'a/b/c/file.txt')
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

// 方案 A：onOutput 进度回调（任何写入都会在收尾时补一条进度；大文件会多次）
{
  const chunks: string[] = []
  const res = await tool.execute(
    { path: 'progress.txt', content: 'hello progress' },
    { workspace: dir, onOutput: (c) => chunks.push(c) },
  )
  check('onOutput progress emitted', chunks.length >= 1 && chunks.some(c => c.includes('written')), JSON.stringify(chunks))
  check('progress write persists', readFileSync(join(dir, 'progress.txt'), 'utf-8') === 'hello progress')
  check('progress returns metadata', (res.metadata as any)?.status === 'created')
}

// 方案 A：中途中止（signal.aborted 在写入前触发 → 抛错 + 不残留临时文件 + 不产生目标）
{
  const ac = new AbortController()
  ac.abort()
  let threw = false
  try {
    await tool.execute({ path: 'aborted.txt', content: 'never' }, { workspace: dir, signal: ac.signal })
  } catch { threw = true }
  check('abort throws', threw)
  check('abort leaves no target', !existsSync(join(dir, 'aborted.txt')))
  // 中止后临时文件不应残留
  const leftovers = readdirSync(dir).filter(f => f.endsWith('.tmp'))
  check('abort cleans temp files', leftovers.length === 0, JSON.stringify(leftovers))
}

rmSync(dir, { recursive: true, force: true })
if (failed) { process.exit(1) } else { console.log('\n  ALL WRITE TESTS PASSED') }
