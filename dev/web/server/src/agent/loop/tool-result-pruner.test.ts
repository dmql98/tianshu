/**
 * Run: npx tsx src/agent/loop/tool-result-pruner.test.ts
 */

import {
  PRUNE_MARKER,
  codePointLength,
  pruneText,
  pruneToolResultContent,
} from './tool-result-pruner.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

// ---- codePointLength is code-point aware (CJK / emoji) ---------------------
{
  assert(codePointLength('') === 0, 'empty string')
  assert(codePointLength('abc') === 3, 'ascii')
  assert(codePointLength('中文测试') === 4, 'CJK each one point')
  assert(codePointLength('a\u{1F600}b') === 3, 'emoji counts as one point (no surrogate split)')
  console.log('  OK codePointLength')
}

// ---- pruneText: over-threshold -> head + marker + tail ----------------------
{
  const big = 'a'.repeat(9000)
  const pruned = pruneText(big)
  assert(pruned !== null, 'over-threshold pruned')
  assert(pruned!.startsWith('a'.repeat(4096)), 'head kept')
  assert(pruned!.endsWith('a'.repeat(1024)), 'tail kept')
  assert(pruned!.includes(PRUNE_MARKER), 'marker present')
  assert(pruned!.length < 9000, 'result smaller than input')
  console.log('  OK pruneText head/marker/tail')
}
{
  assert(pruneText('x'.repeat(8192)) === null, 'at threshold not pruned')
  assert(pruneText('x'.repeat(100)) === null, 'below threshold not pruned')
  assert(pruneText('') === null, 'empty not pruned')
  console.log('  OK pruneText threshold gate')
}
{
  // CJK / emoji boundaries never split a surrogate pair.
  const emoji = '😀'.repeat(10000) // 10000 code points, > threshold
  const pruned = pruneText(emoji)
  assert(pruned !== null, 'emoji pruned')
  const cleaned = pruned!.replace(PRUNE_MARKER, '')
  for (const ch of cleaned) {
    assert(!isSurrogate(ch), 'no lone surrogate after prune')
  }
  console.log('  OK pruneText no surrogate split')
}
function isSurrogate(ch: string): boolean {
  const c = ch.codePointAt(0)!
  return c >= 0xd800 && c <= 0xdfff
}

// ---- pruneText determinism: same input -> same output ------------------------
{
  const big = ('data-'.repeat(3000) + '中文字符'.repeat(1200) + 'tail!'.repeat(300))
  const a = pruneText(big)!
  const b = pruneText(big)!
  assert(a === b, 'deterministic output bytes')
  console.log('  OK pruneText byte-stable')
}

// ---- pruneToolResultContent: prunes output/error fields, keeps pairing -------
{
  const content = JSON.stringify({ output: 'x'.repeat(9000), error: '' })
  const pruned = pruneToolResultContent(content)
  const parsed = JSON.parse(pruned)
  assert(parsed.output.startsWith('x'.repeat(4096)), 'output head kept')
  assert(parsed.output.includes(PRUNE_MARKER), 'output marker present')
  assert(parsed.error === '', 'error untouched')
  console.log('  OK pruneToolResultContent prunes output')
}
{
  const content = JSON.stringify({ output: 'ok', error: 'boom'.repeat(3000) })
  const pruned = pruneToolResultContent(content)
  const parsed = JSON.parse(pruned)
  assert(parsed.output === 'ok', 'small output untouched')
  assert(parsed.error.startsWith('boom'.repeat(1)) && parsed.error.includes(PRUNE_MARKER), 'error pruned')
  console.log('  OK pruneToolResultContent prunes error field')
}
{
  const small = JSON.stringify({ output: 'hello', error: '' })
  assert(pruneToolResultContent(small) === small, 'small content byte-identical (no rewrite)')
  console.log('  OK pruneToolResultContent byte-stable no-op')
}
{
  assert(pruneToolResultContent('not-json') === 'not-json', 'non-JSON untouched')
  assert(pruneToolResultContent('[1,2,3]') === '[1,2,3]', 'array untouched')
  assert(pruneToolResultContent('null') === 'null', 'null untouched')
  console.log('  OK pruneToolResultContent malformed content untouched')
}

console.log('ALL PRUNER TESTS PASSED')
