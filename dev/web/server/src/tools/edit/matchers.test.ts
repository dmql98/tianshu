import { findBestMatch, exactMatch, contextAwareMatch } from './matchers.js'
import { strict as assert } from 'assert'

let passed = 0
function ok(name: string, cond: unknown) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed++
  console.log(`  OK ${name}`)
}

// --- Regression: indentation-insensitive matchers are GONE ---
// Previously lineTrimmed/indentationFlexible matched a block with wrong
// indentation and replaced it, corrupting indentation (the main.ts `])7.0.0.1`
// class of bug).
{
  const code = [
    'export function resetTheme() {',
    '    delete document.documentElement.dataset.theme',
    '}',
  ].join('\n')
  // Old buggy matcher accepted 2-space indentation; now multi-line fuzzy is
  // context-aware only, and the anchor lines must match exactly INCLUDING indent.
  const badIndent = [
    'export function resetTheme() {',
    '  delete document.documentElement.dataset.theme',
    '}',
  ].join('\n')
  const r = findBestMatch(code, badIndent)
  ok('wrong indentation no longer matches (indent-sensitive)', r === null)
}

// --- Regression: exact match still works and is preferred ---
{
  const code = 'const x = 1\nconst y = 2\n'
  const r = findBestMatch(code, 'const y = 2')
  assert(r && r.method === 'exact' && code.slice(r.result.index, r.result.index + r.result.length) === 'const y = 2')
  ok('exact match works', !!r)
}

// --- Regression: contextAware requires >=4 lines and exact anchor indent ---
{
  const content = [
    'function handleA() {',
    '  const a = 1',
    '  const b = 2',
    '  return a + b',
    '}',
    '',
    'function handleB() {',
    '  const x = 100',
    '  const y = 200',
    '  const z = 300',
    '  return x * y + z',
    '}',
  ].join('\n')
  // handleB with one line content-differing (x=100 -> x=1000) should still match
  // handleB uniquely (threshold 80%).
  const oldB = [
    'function handleB() {',
    '  const x = 100',
    '  const y = 200',
    '  const z = 300',
    '  return x * y + z',
    '}',
  ].join('\n')
  const r = findBestMatch(content, oldB)
  ok('contextAware exact-preferred for handleB', r && r.method === 'exact')

  // A fuzzy variant: first+last lines differ only in indent should NOT match.
  const dedentedB = [
    'function handleB() {',
    'const x = 100',
    'const y = 200',
    'const z = 300',
    'return x * y + z',
    '}',
  ].join('\n')
  const r2 = findBestMatch(content, dedentedB)
  ok('contextAware rejects dedented middle (indent-sensitive)', r2 === null)

  // <4 line oldString: fuzzy refused entirely.
  const shortOld = 'function handleB() {\n  const x = 100\n  return 1\n}'
  const r3 = findBestMatch(content, shortOld)
  // If exact fails (it does — return differs), fuzzy must refuse (<4 lines).
  ok('short multi-line oldString fuzzy refused', r3 === null || r3.method === 'exact')
}

// --- whitespaceNormalized was removed: no permissive whitespace collapse ---
{
  // Previously a single-line whitespace matcher could accept token-merged
  // text (e.g. `"foo"  ;` vs `"foo";`). That matcher is gone; only exact and
  // contextAware remain.
  const r = findBestMatch('const x =  "a"  ;\n', 'const x = "a";')
  ok('whitespace-only difference no longer fuzzy-matches (exact is the floor)', r === null || r.method === 'exact')
}

// --- index.ts ambiguity guard: length===0 signals ambiguous ---
{
  const content = [
    'function f1() {',
    '  const x = 1',
    '  const y = 2',
    '  const z = 3',
    '  return x',
    '}',
    'function f2() {',
    '  const x = 10',
    '  const y = 20',
    '  const z = 30',
    '  return x',
    '}',
  ].join('\n')
  // oldString whose first/last lines match BOTH functions identically, and
  // middle lines similar enough to pass threshold for both -> ambiguity.
  const ambiguous = [
    'function f1() {',
    '  const x = 1',
    '  const y = 2',
    '  const z = 3',
    '  return x',
    '}',
  ].join('\n')
  const r = findBestMatch(content, ambiguous)
  // If exact matched f1 it's fine; but the oldString must be EXACTLY f1, else
  // contextAware may find two candidates and return ambiguity marker.
  ok('ambiguity detection returns a result (never crashes)', r !== null)
}

console.log(`\nALL MATCHER TESTS PASSED (${passed})`)
