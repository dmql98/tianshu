/**
 * Run: npx tsx src/agent/loop/context-builder.test.ts
 */

import { restoreAssistantToolCalls, rowToLLMMessage, fixOrphanToolCalls, assembleStaticPrompt, toolResultIsError } from './context-builder.js'
import { resolveProviderFormat } from '../attachments.js'
import { PRUNE_MARKER } from './tool-result-pruner.js'
import type { LLMMessage } from '../../llm/client.js'

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

// ── P0-4: 加载时按 trimmed_until_id 恢复剪枝后 content ──────────────────────
const cap = { supportsVision: false, supportsFiles: false }
const format = resolveProviderFormat('http://localhost:9999/v1')
const toolRow = (id: number, output: string): any => ({
  id, session_id: 's', role: 'tool',
  content: JSON.stringify({ output, error: '' }),
  reasoning_content: null,
  tool_name: 'read',
  tool_input: JSON.stringify({ call_id: `c${id}`, args: '{}' }),
  tool_output: output, tool_status: 'success', attachments: null,
  token_speed: null, turn_id: null, run_id: null, status: 'active',
  supersedes_message_id: null, created_at: Date.now(),
})
const big = 'x'.repeat(9000)
{
  const m = rowToLLMMessage(toolRow(101, big), 's', cap, format, 200)
  const parsed = JSON.parse(m!.content as string)
  check('P0-4 row <= trimmed_until_id pruned on load',
    typeof parsed.output === 'string' && parsed.output.includes(PRUNE_MARKER))
  check('P0-4 pruned row keeps tool_call_id', m!.tool_call_id === 'c101')
}
{
  const m = rowToLLMMessage(toolRow(101, big), 's', cap, format, 0)
  const parsed = JSON.parse(m!.content as string)
  check('P0-4 row beyond watermark untouched', parsed.output === big)
}
{
  const m = rowToLLMMessage(toolRow(101, 'small output'), 's', cap, format, 200)
  const parsed = JSON.parse(m!.content as string)
  check('P0-4 small stale row unchanged', parsed.output === 'small output')
}
{
  // 幂等：已含标记的 content 再次加载不再变化。
  const first = rowToLLMMessage(toolRow(101, big), 's', cap, format, 200)!.content as string
  const second = rowToLLMMessage(toolRow(101, big), 's', cap, format, 200)!.content as string
  check('P0-4 reload is idempotent', first === second)
}

// ── P1-2: 结构化 is_error 判定（新列优先，旧数据回退字符串解析）──────────────
{
  check('P1-2 is_error=1 → error', toolResultIsError({ is_error: 1, content: JSON.stringify({ output: 'x', error: '' }) }) === true)
  check('P1-2 is_error=0 → not error (content 不参与判定)', toolResultIsError({ is_error: 0, content: JSON.stringify({ output: '', error: 'legacy text' }) }) === false)
  check('P1-2 旧数据 is_error=null → 解析 content.error', toolResultIsError({ is_error: null, content: JSON.stringify({ output: '', error: 'boom' }) }) === true)
  check('P1-2 旧数据无 error → false', toolResultIsError({ is_error: null, content: JSON.stringify({ output: 'ok' }) }) === false)
  check('P1-2 非法 content → false', toolResultIsError({ is_error: null, content: 'not-json' }) === false)
  console.log('  OK P1-2 toolResultIsError new/old forms')
}
{
  // content 缺失时从结构化列重建。
  const m = rowToLLMMessage({
    ...toolRow(201, ''),
    content: '',
    tool_output: 'file content here',
    is_error: 0,
  }, 's', cap, format, 0)
  const parsed = JSON.parse(m!.content as string)
  check('P1-2 空 content 从 tool_output 重建 output', parsed.output === 'file content here' && parsed.error === '')
  const mErr = rowToLLMMessage({
    ...toolRow(202, ''),
    content: '',
    tool_output: 'no such file',
    is_error: 1,
  }, 's', cap, format, 0)
  const parsedErr = JSON.parse(mErr!.content as string)
  check('P1-2 空 content + is_error=1 重建 error 字段', parsedErr.output === '' && parsedErr.error === 'no such file')
  console.log('  OK P1-2 content reconstruction from structured columns')
}

// ── P2-1: system prompt 工具清单默认省略，可开关 ──────────────────────────────
{
  const charMeta = { id: 'test-char', name: 'test', skills: [] as string[] } as any
  const charContent = { soul: '测试人格', user: '测试用户' }
  const toolDefs = [{ type: 'function', function: { name: 'read', description: 'Read a file', parameters: {} } }]
  const p = assembleStaticPrompt(charMeta, charContent, toolDefs, '/ws')
  const pText = p.join('\n\n')
  check('P2-1 工具清单不进 system 文本（工具经 API tools 参数下发）', !pText.includes('## Available Tools') && !pText.includes('read'))
  check('P2-1 其他 section 保留', pText.includes('## Character') && pText.includes('## Workspace'))
  check('P2-1 静态提示按组装顺序拆分为独立 system 块', p[0].startsWith('## Character') && p[1].startsWith('## User Info') && p[p.length - 1].startsWith('## Workspace'))
  console.log('  OK P2-1 tools listing removed')
}

// ── P2-3: fixOrphanToolCalls 幂等移除孤儿调用 ────────────────────────────────
const userMsg = (c: string): LLMMessage => ({ role: 'user', content: c })
const toolMsg = (callId: string, output = 'out'): LLMMessage => ({ role: 'tool', content: JSON.stringify({ output }), tool_call_id: callId })
function asmWithCalls(callIds: string[]): LLMMessage {
  return {
    role: 'assistant', content: 'thinking',
    tool_calls: callIds.map(id => ({ id, type: 'function' as const, function: { name: 'read', arguments: '{}' } })),
  }
}
{
  // 孤儿调用被移除；完整配对不动；两次调用结果一致（幂等）。
  const messages: LLMMessage[] = [
    userMsg('q0'),
    asmWithCalls(['ok', 'orphan']),
    toolMsg('ok'),
    userMsg('q1'),
  ]
  fixOrphanToolCalls(messages)
  check('P2-3 孤儿调用从消息移除', messages[1].tool_calls?.length === 1 && messages[1].tool_calls![0].id === 'ok')
  check('P2-3 完整配对保留', messages[2].role === 'tool' && messages[2].tool_call_id === 'ok')
  const snapshot = JSON.stringify(messages)
  fixOrphanToolCalls(messages)
  check('P2-3 再次调用结果一致（幂等）', JSON.stringify(messages) === snapshot)
  console.log('  OK P2-3 orphan call removed, idempotent')
}
{
  // 全部调用都是孤儿 → 消息不再携带 tool_calls。
  const messages: LLMMessage[] = [userMsg('q0'), asmWithCalls(['a', 'b']), userMsg('q1')]
  fixOrphanToolCalls(messages)
  check('P2-3 全孤儿调用清空 tool_calls', messages[1].tool_calls === undefined)
  console.log('  OK P2-3 all-orphan call cleared')
}

if (failed) { process.exit(1) } else { console.log('\n  ALL CONTEXT BUILDER TESTS PASSED') }
