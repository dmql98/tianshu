import { replace } from './matchers.js'
import { strict as assert } from 'assert'

let passed = 0
function ok(name: string, cond: unknown) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed++
  console.log(`  OK ${name}`)
}

// --- Exact match is preferred and works ---
{
  const code = 'const x = 1\nconst y = 2\n'
  const r = replace(code, 'const y = 2', 'const y = 20')
  assert.strictEqual(r.method, 'exact')
  assert.strictEqual(r.index, code.indexOf('const y = 2'))
  assert.strictEqual(r.next, 'const x = 1\nconst y = 20\n')
  ok('exact match is preferred', true)
}

// --- CRLF: LF-typed oldString matches a CRLF file and CRLF is preserved ---
{
  const code = 'const a = 1\r\nconst b = 2\r\nconst c = 3\r\n'
  const r = replace(code, 'const b = 2', 'const b = 20')
  assert.strictEqual(r.next, 'const a = 1\r\nconst b = 20\r\nconst c = 3\r\n')
  assert.strictEqual(r.method, 'exact')
  ok('CRLF preserved + LF oldString matched', true)
}

// --- Ambiguous (multiple identical blocks) is refused without replaceAll ---
{
  const code = 'foo()\nfoo()\n'
  assert.throws(() => replace(code, 'foo()', 'bar()'), /multiple matches/i)
  const r = replace(code, 'foo()', 'bar()', true)
  assert.strictEqual(r.next, 'bar()\nbar()\n')
  assert.strictEqual(r.count, 2)
  ok('ambiguous refused; replaceAll replaces all', true)
}

// --- LineTrimmed: wrong-indentation oldString resolves to the REAL block ---
{
  const code = [
    'export function resetTheme() {',
    '    delete document.documentElement.dataset.theme',
    '}',
    '',
    'export function applyTheme(t: Theme) {',
    '    document.documentElement.dataset.theme = t.id',
    '}',
  ].join('\n')
  const dedented = [
    'export function resetTheme() {',
    '  delete document.documentElement.dataset.theme',
    '}',
  ].join('\n')
  const r = replace(code, dedented, 'export function resetTheme() {\n    /* x */\n}')
  assert.strictEqual(r.method, 'lineTrimmed')
  assert.ok(r.next.includes('    /* x */'), 'replaced with provided newString')
  assert.ok(r.next.includes('export function applyTheme'), 'sibling block untouched')
  ok('dedented oldString resolves to real block', true)
}

// --- Nested indented block: dedented oldString still resolves ---
{
  const code = 'function outer() {\n    if (x) {\n        doA()\n        doB()\n    }\n}\n'
  const r = replace(code, 'if (x) {\n  doA()\n  doB()\n}', 'if (x) { doAll() }')
  assert.ok(r.next.startsWith('function outer() {\n'), 'outer preserved')
  assert.ok(r.next.includes('if (x) { doAll() }'), 'inner replaced')
  assert.ok(r.next.endsWith('}\n'), 'outer close preserved')
  ok('nested indented block resolves', true)
}

// --- BlockAnchor: line-count drift between anchors tolerated ---
{
  const code = [
    'function outer() {',
    '  const a = 1',
    '  const b = 2',
    '  const c = 3',
    '  return x',
    '}',
  ].join('\n')
  // find is missing the b-line: LineTrimmed needs exact count, BlockAnchor doesn't.
  const find = [
    'function outer() {',
    '  const a = 1',
    '  const c = 3',
    '  return x',
    '}',
  ].join('\n')
  const r = replace(code, find, 'function outer() { return 0 }')
  assert.strictEqual(r.method, 'blockAnchor')
  assert.ok(r.next.includes('function outer() { return 0 }'))
  ok('blockAnchor tolerates line-count drift', true)
}

// --- ContextAware: first/last anchors + tolerant middle ---
{
  const code = [
    'function handle() {',
    '  const a = 100',
    '  const b = 200',
    '  const c = 300',
    '  const d = 400',
    '  return total',
    '}',
  ].join('\n')
  // 2 of 4 middle lines differ -> BlockAnchor (0.65) fails, ContextAware (0.5) passes.
  const drifted = [
    'function handle() {',
    '  const a = 100',
    '  return zzzzzzz()',
    '  return qqqqqqq()',
    '  const d = 400',
    '  return total',
    '}',
  ].join('\n')
  const r = replace(code, drifted, 'function handle() { return 42 }')
  assert.strictEqual(r.method, 'contextAware')
  assert.ok(r.next.includes('return 42'))
  ok('contextAware tolerates middle drift', true)
}

// --- WhitespaceNormalized: internal whitespace collapse ---
{
  const code = 'const x =  "a";\n'
  const r = replace(code, 'const x = "a";', 'const y = "b";')
  assert.strictEqual(r.method, 'whitespaceNormalized')
  assert.strictEqual(r.next, 'const y = "b";\n')
  ok('whitespaceNormalized collapses internal whitespace', true)
}

// --- Not found throws a clear error ---
{
  assert.throws(() => replace('const x = 1\n', 'function missing() {}', 'x'), /Could not find oldString/i)
  ok('missing oldString throws', true)
}

// --- Empty oldString and identical strings throw ---
{
  assert.throws(() => replace('abc', '', 'x'), /cannot be empty/i)
  assert.throws(() => replace('abc', 'x', 'x'), /identical/i)
  ok('empty/identical guards', true)
}

// --- Single-line exact edit stays proportionate ---
{
  const big = 'function a() {\n' + Array.from({ length: 30 }, () => '  const v = 1').join('\n') + '\n}\n'
  const r = replace(big, 'function a() {', 'function a() { x }')
  assert.strictEqual(r.method, 'exact')
  assert.strictEqual(r.length, 'function a() {'.length)
  ok('single-line exact stays proportionate', true)
}

console.log(`\nALL MATCHER TESTS PASSED (${passed})`)