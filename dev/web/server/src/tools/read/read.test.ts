/**
 * Run: npx tsx src/tools/read/read.test.ts
 *
 * Regression coverage for the read tool's offset/limit handling:
 * the public JSON schema declares them as `number`, but the internal Zod
 * validator used to require `string` and rejected numeric input with
 * "expected string, received number". This script locks in the fix
 * (z.coerce.number()) and keeps backward compatibility for string input.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { tool } from './index.js'

let failed = false
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  OK ${name}`) }
  else { failed = true; console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`) }
}

// parse the "(N lines, showing A-B)" header and the numbered data lines
function parse(res: any) {
  const out: string = res.output || ''
  const head = out.split('\n')[0]
  const m = head.match(/showing (\d+)-(\d+)/)
  const range = m ? [Number(m[1]), Number(m[2])] : null
  const dataLines = out
    .split('\n')
    .filter((l: string) => /^\d+: /.test(l))
    .map((l: string) => Number(l.split(':')[0]))
  return { range, dataLines }
}

const dir = mkdtempSync(join(tmpdir(), 'tianshu-read-'))
const file = 'sample.txt'
const total = 50
writeFileSync(join(dir, file), Array.from({ length: total }, (_, i) => `line ${i + 1}`).join('\n'), 'utf-8')

// 1. REGRESSION: numeric offset/limit must pass (used to throw "expected string, received number")
// ToolModule.execute now types args as ToolArgs (string | number | boolean), so numeric
// offset/limit are accepted directly — exercising exactly the path that previously regressed.
{
  const res: any = await tool.execute({ path: file, offset: 10, limit: 5 }, { workspace: dir })
  check('numeric offset/limit does not error', !res.error, JSON.stringify(res))
  const { range, dataLines } = parse(res)
  check('numeric range is 10-14', !!range && range[0] === 10 && range[1] === 14, JSON.stringify(range))
  check('numeric data lines are 10..14', JSON.stringify(dataLines) === JSON.stringify([10, 11, 12, 13, 14]), JSON.stringify(dataLines))
}

// 2. backward compat: string offset/limit still works
{
  const res: any = await tool.execute({ path: file, offset: '10', limit: '5' }, { workspace: dir })
  check('string offset/limit does not error', !res.error, JSON.stringify(res))
  const { range } = parse(res)
  check('string range is 10-14', !!range && range[0] === 10 && range[1] === 14, JSON.stringify(range))
}

// 3. defaults when no offset/limit (50-line file, PAGE_SIZE 2000 -> shows 1-50)
{
  const res: any = await tool.execute({ path: file }, { workspace: dir })
  check('no offset/limit does not error', !res.error, JSON.stringify(res))
  const { range, dataLines } = parse(res)
  check('default range is 1-50', !!range && range[0] === 1 && range[1] === 50, JSON.stringify(range))
  check('default returns all 50 lines', dataLines.length === 50, String(dataLines.length))
}

// 4. validation still rejects invalid (negative) offset
{
  let threw = false
  try {
    await tool.execute({ path: file, offset: -5, limit: 5 }, { workspace: dir })
  } catch {
    threw = true
  }
  check('negative offset rejected', threw)
}

rmSync(dir, { recursive: true, force: true })
if (failed) { process.exit(1) } else { console.log('\n  ALL READ TESTS PASSED') }
