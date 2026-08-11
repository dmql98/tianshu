/**
 * Run: npx tsx src/agent/tool-call-normalizer.test.ts
 */

import { normalizeToolCalls, buildInvalidToolCall } from './tool-call-normalizer.js'
import type { ToolCall } from '../llm/client.js'

function tc(id: string, name: string, args: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: args } }
}

let failed = false
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  OK ${name}`) }
  else { failed = true; console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`) }
}

// valid object passes
{
  const r = normalizeToolCalls([tc('c1', 'read', '{"path":"a.txt"}')])
  check('valid JSON object accepted', r.ok === true && r.calls.length === 1 && r.calls[0].function.arguments.path === 'a.txt')
}

// invalid JSON (accident case) -> failure with snippet, no canonical call
{
  const r = normalizeToolCalls([tc('c1', 'write', '{"content":"REM ----')])
  check('invalid JSON detected as invalid_json', !r.ok && r.kind === 'invalid_json')
  check('invalid JSON yields no canonical call', r.calls.length === 0)
  if (!r.ok) check('invalid JSON carries truncated snippet', r.failures[0].kind === 'invalid_json' && r.failures[0].snippet.length > 0)
}

// array arguments -> shape error
{
  const r = normalizeToolCalls([tc('c1', 'read', '[1,2,3]')])
  check('array arguments rejected as invalid_shape', !r.ok && r.kind === 'invalid_shape')
}

// null arguments -> shape error
{
  const r = normalizeToolCalls([tc('c1', 'read', 'null')])
  check('null arguments rejected as invalid_shape', !r.ok && r.kind === 'invalid_shape')
}

// string arguments -> shape error
{
  const r = normalizeToolCalls([tc('c1', 'read', '"just a string"')])
  check('string arguments rejected as invalid_shape', !r.ok && r.kind === 'invalid_shape')
}

// missing id
{
  const r = normalizeToolCalls([tc('', 'read', '{}')])
  check('missing id rejected', !r.ok && r.kind === 'missing_identity')
}

// duplicate ids
{
  const r = normalizeToolCalls([tc('c1', 'read', '{}'), tc('c1', 'read', '{}')])
  check('duplicate id rejected', !r.ok && r.kind === 'missing_identity')
}

// mixed valid + invalid: valid kept, failure recorded
{
  const r = normalizeToolCalls([tc('c1', 'read', '{"path":"a"}'), tc('c2', 'write', '{"content":')])
  check('mixed batch keeps valid call', !r.ok && r.calls.length === 1 && r.calls[0].id === 'c1')
  check('mixed batch reports invalid call', !r.ok && r.failures.length === 1 && r.failures[0].kind === 'invalid_json')
}

// synthetic invalid tool call is always valid JSON
{
  const r = normalizeToolCalls([tc('c1', 'write', '{"content":')])
  if (!r.ok) {
    const { canonical } = buildInvalidToolCall('c1', r.failures[0])
    const raw = JSON.stringify(canonical)
    check('invalid_tool_call canonical is JSON-safe', raw.includes('invalid_tool_call') && (() => { try { JSON.parse(JSON.stringify(canonical)); return true } catch { return false } })())
    check('invalid_tool_call carries original tool name', canonical.function.arguments.original_tool === 'write')
  } else {
    check('synthetic invalid call constructed', false, 'expected failure')
  }
}

if (failed) { process.exit(1) } else { console.log('\n  ALL TOOL-CALL NORMALIZER TESTS PASSED') }
