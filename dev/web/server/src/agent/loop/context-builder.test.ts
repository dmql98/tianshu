/**
 * Run: npx tsx src/agent/loop/context-builder.test.ts
 */

import { restoreAssistantToolCalls } from './context-builder.js'

let failed = false
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  OK ${name}`) }
  else { failed = true; console.error(`  FAIL ${name}${detail ? ': ' + detail : ''}`) }
}

function row(toolInput: string): any {
  return {
    id: 1, session_id: 's', role: 'assistant', content: 'hi',
    reasoning_content: null, tool_input: toolInput, tool_output: null,
    tool_status: null, attachments: null, token_speed: null,
    turn_id: null, run_id: null, status: 'active', supersedes_message_id: null,
    created_at: Date.now(),
  }
}

// valid history passes through unchanged
{
  const m = restoreAssistantToolCalls(row(JSON.stringify([
    { id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a.txt"}' } },
  ])))
  check('valid history preserved', m?.tool_calls?.length === 1 && m.tool_calls[0].function.name === 'read')
}

// half-serialized arguments (accident) -> rewritten to invalid_tool_call, JSON-safe
{
  const m = restoreAssistantToolCalls(row(JSON.stringify([
    { id: 'c1', type: 'function', function: { name: 'write', arguments: '{"content":"REM ----' } },
  ])))
  const call = m?.tool_calls?.[0]
  check('malformed args rewritten to invalid_tool_call', call?.function.name === 'invalid_tool_call')
  check('rewritten arguments are valid JSON', (() => {
    try { JSON.parse(call!.function.arguments); return true } catch { return false }
  })())
  check('original tool name preserved in args', !!(call?.function.arguments.includes('write')))
}

// array arguments rewritten
{
  const m = restoreAssistantToolCalls(row(JSON.stringify([
    { id: 'c1', type: 'function', function: { name: 'read', arguments: '[1,2]' } },
  ])))
  check('array args rewritten', m?.tool_calls?.[0]?.function.name === 'invalid_tool_call')
}

// mixed valid + invalid: valid kept, invalid rewritten
{
  const m = restoreAssistantToolCalls(row(JSON.stringify([
    { id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } },
    { id: 'c2', type: 'function', function: { name: 'write', arguments: '{"content":' } },
  ])))
  check('mixed: valid call kept', m?.tool_calls?.length === 2 && m.tool_calls[0].function.name === 'read')
  check('mixed: invalid call rewritten', m?.tool_calls?.[1]?.function.name === 'invalid_tool_call')
  check('mixed: marked sanitized', (m as any)?.__sanitized === true)
}

if (failed) { process.exit(1) } else { console.log('\n  ALL HISTORY SANITIZER TESTS PASSED') }
