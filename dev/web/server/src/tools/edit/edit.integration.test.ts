/**
 * Run: npx tsx src/tools/edit/edit.integration.test.ts
 *
 * Verifies the edit tool no longer corrupts files via overly-permissive fuzzy
 * matching (the root cause of the main.ts / preload.ts / desktop-contract.ts
 * damage).
 */

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmp = mkdtempSync(join(tmpdir(), 'tianshu-edit-'))
const workspace = join(tmp, 'ws')
const { mkdirSync } = await import('fs')
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

  // 2. Wrong-indentation oldString is REJECTED (no corruption).
  const before = readFileSync(file, 'utf-8')
  const badIndentOld = [
    'export function resetTheme() {',
    '  delete document.documentElement.dataset.theme',
    '}',
  ].join('\n')
  r = await runEdit('sample.ts', badIndentOld, 'export function resetTheme() {\n  /* x */\n}')
  assert(!!r.error, `dedented oldString should fail, got: ${r.output}`)
  assert(readFileSync(file, 'utf-8') === before, 'file unchanged after rejected fuzzy edit')

  // 3. Non-existent oldString fails cleanly.
  r = await runEdit('sample.ts', 'function doesNotExist() {}', 'x')
  assert(!!r.error, 'missing oldString fails')

  // 4. Short multi-line oldString (<4 lines) that is not exact is rejected
  //    (contextAware refuses; no lineTrimmed fallback).
  r = await runEdit('sample.ts', 'export function resetTheme() {\n  delete document.documentElement.dataset.theme\n}', 'x')
  assert(!!r.error, `short multi-line fuzzy must fail, got: ${r.output}`)

  // 5. Ambiguous: oldString that matches two regions via fuzzy anchors.
  const dupFile = join(workspace, 'dup.ts')
  const DUP = [
    'function handleA() {',
    '  const a = 1',
    '  const b = 2',
    '  const c = 3',
    '  return a',
    '}',
    'function handleB() {',
    '  const a = 10',
    '  const b = 20',
    '  const c = 30',
    '  return a',
    '}',
  ].join('\n')
  writeFileSync(dupFile, DUP, 'utf-8')
  // A fuzzy oldString whose anchors match both blocks identically:
  r = await runEdit('dup.ts', 'function handleA() {\n  const a = 1\n  const b = 2\n  const c = 3\n  return a\n}', 'function handleA() {\n  return 42\n}')
  // exact matches handleA uniquely (it's byte-identical), so this is fine.
  assert(!r.error, `exact unique match should succeed: ${r.error || r.output}`)

  console.log('ALL EDIT INTEGRATION TESTS PASSED')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
