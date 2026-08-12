/**
 * Run: npx tsx src/tools/edit/edit.integration.test.ts
 *
 * End-to-end checks for the edit tool against real files on disk:
 *   - exact edits apply
 *   - whitespace/indentation drift still resolves to the REAL block (never
 *     byte-corrupting surrounding content)
 *   - BOM is preserved on rewrite
 *   - CRLF files keep CRLF line endings
 *   - ambiguous / missing oldStrings fail cleanly
 *   - a directory target is rejected
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmp = mkdtempSync(join(tmpdir(), 'tianshu-edit-'))
const workspace = join(tmp, 'ws')
mkdirSync(workspace, { recursive: true })

const { tool } = await import('./index.js')

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

const ctx = { workspace, workspaces: [workspace], allowedRoots: [] as string[] } as any

async function runEdit(file: string, oldString: string, newString: string, extra: any = {}) {
  return tool.execute(
    { path: file, oldString, newString, ...extra },
    ctx,
  ) as Promise<{ output?: string; error?: string }>
}

try {
  const file = join(workspace, 'sample.ts')
  const GOOD = [
    'export function resetTheme() {',
    '    delete document.documentElement.dataset.theme',
    '}',
    '',
    'export function applyTheme(t: Theme) {',
    '    document.documentElement.dataset.theme = t.id',
    '}',
  ].join('\n')
  writeFileSync(file, GOOD, 'utf-8')

  // 1. Exact edit works.
  let r = await runEdit('sample.ts', 'export function applyTheme(t: Theme) {', 'export function applyTheme(t: Theme, force = false) {')
  assert(!r.error && /Applied edit/.test(r.output || ''), `exact edit: ${r.error || r.output}`)

  // 2. Dedented oldString now resolves to the REAL block: the surrounding
  //    sibling block must stay byte-identical (no corruption).
  const siblingBefore = readFileSync(file, 'utf-8').split('\n').slice(3).join('\n')
  const badIndentOld = [
    'export function resetTheme() {',
    '  delete document.documentElement.dataset.theme',
    '}',
  ].join('\n')
  r = await runEdit('sample.ts', badIndentOld, 'export function resetTheme() {\n    /* x */\n}')
  assert(!r.error, `dedented oldString should resolve: ${r.error || r.output}`)
  const after = readFileSync(file, 'utf-8')
  assert(after.includes('    /* x */'), 'replacement applied')
  assert(!after.includes('delete document.documentElement.dataset.theme'), 'old block removed')
  assert(after.split('\n').slice(3).join('\n') === siblingBefore, 'sibling block untouched')

  // 3. Non-existent oldString fails cleanly.
  r = await runEdit('sample.ts', 'function doesNotExist() {}', 'x')
  assert(!!r.error, 'missing oldString fails')

  // 4. replaceAll replaces every occurrence.
  writeFileSync(file, 'foo()\nfoo()\nfoo()\n', 'utf-8')
  r = await runEdit('sample.ts', 'foo()', 'bar()', { replaceAll: 'true' })
  assert(!r.error && (r.output || '').includes('3 occurrences'), `replaceAll: ${r.error || r.output}`)
  assert(readFileSync(file, 'utf-8') === 'bar()\nbar()\nbar()\n', 'replaceAll content')

  // 5. Ambiguous (two identical blocks) without replaceAll fails.
  writeFileSync(file, 'fn()\nfn()\n', 'utf-8')
  r = await runEdit('sample.ts', 'fn()', 'bar()')
  assert(!!r.error && /multiple matches/i.test(r.error), `ambiguous should fail: ${r.error}`)

  // 6. CRLF file: LF-typed oldString matches and CRLF is preserved.
  const crlfFile = join(workspace, 'crlf.txt')
  writeFileSync(crlfFile, 'a=1\r\nb=2\r\nc=3\r\n', 'utf-8')
  r = await runEdit('crlf.txt', 'b=2', 'b=20')
  assert(!r.error, `crlf edit: ${r.error || r.output}`)
  assert(readFileSync(crlfFile, 'utf-8') === 'a=1\r\nb=20\r\nc=3\r\n', 'crlf preserved')

  // 7. BOM file: first-line edit keeps the BOM.
  const bomFile = join(workspace, 'bom.txt')
  writeFileSync(bomFile, '\uFEFFhello\nworld\n', 'utf-8')
  r = await runEdit('bom.txt', 'hello', 'HELLO')
  assert(!r.error, `bom edit: ${r.error || r.output}`)
  const raw = readFileSync(bomFile, 'utf-8')
  assert(raw.charCodeAt(0) === 0xFEFF && raw.startsWith('\uFEFFHELLO'), 'bom preserved')

  // 8. Directory target is rejected.
  const dirFile = join(workspace, 'subdir')
  mkdirSync(dirFile, { recursive: true })
  r = await runEdit('subdir', 'x', 'y')
  assert(!!r.error && /directory/i.test(r.error), `directory rejected: ${r.error}`)

  console.log('ALL EDIT INTEGRATION TESTS PASSED')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}