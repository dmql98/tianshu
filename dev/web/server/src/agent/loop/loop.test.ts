/**
 * Run: npx tsx src/agent/loop/loop-policy.test.ts
 */

import { estimateTokens, shouldCompact, shouldSnip, trimToolResults, systemMessageEnd } from './loop-policy.js'
import { detectDoomLoop, evaluateFinalAnswer } from './completion-evaluator.js'
import { selectEntries } from './context-compactor.js'
import { envInt } from '../../config.js'
import type { LLMMessage } from '../../llm/client.js'
import type { ToolCallRecord } from '../inner.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const toolRecord = (toolName: string, hasError: boolean): ToolCallRecord => ({ toolName, hasError, error: hasError ? 'boom' : undefined })

function asm(content: string): LLMMessage { return { role: 'assistant', content } }
function toolMsg(callId: string, output = 'out'): LLMMessage { return { role: 'tool', content: JSON.stringify({ output }), tool_call_id: callId } }
function asmCalls(callId: string): LLMMessage { return { role: 'assistant', content: 'thinking', tool_calls: [{ id: callId, type: 'function', function: { name: 'read', arguments: '{}' } }] } }
function userMsg(content: string): LLMMessage { return { role: 'user', content } }

// ---- trimToolResults keeps only the most recent tool turns ----------------
{
  const messages: LLMMessage[] = [
    userMsg('hi'),
    asmCalls('c1'), toolMsg('c1', 'x'.repeat(9000)),
    asmCalls('c2'), toolMsg('c2'),
    asmCalls('c3'), toolMsg('c3'),
    asmCalls('c4'), toolMsg('c4', 'fresh output'),
  ]
  const trimmed = trimToolResults(messages)
  assert(trimmed.pruned === true, 'stale oversized tool result pruned')
  const c1 = JSON.parse(messages[2].content as string)
  assert(typeof c1.output === 'string' && c1.output.startsWith('x'.repeat(4096)), 'c1 head kept')
  assert(c1.output.includes('工具输出中部已省略'), 'c1 prune marker present')
  assert(c1.output.endsWith('x'.repeat(1024)), 'c1 tail kept')
  assert(JSON.parse(messages[4].content as string).output === 'out', 'c2 (3rd turn) kept')
  assert(JSON.parse(messages[6].content as string).output === 'out', 'c3 kept')
  assert(JSON.parse(messages[8].content as string).output === 'fresh output', 'c4 kept')
  console.log('  OK trimToolResults prunes stale turns keeping head/tail')
}
{
  // Small stale results are no longer nuked to "[trimmed]" (P0-1).
  const messages: LLMMessage[] = [
    userMsg('hi'),
    asmCalls('c1'), toolMsg('c1'),
    asmCalls('c2'), toolMsg('c2'),
    asmCalls('c3'), toolMsg('c3'),
    asmCalls('c4'), toolMsg('c4'),
  ]
  const trimmed = trimToolResults(messages)
  assert(trimmed.pruned === false, 'no oversized stale result, nothing trimmed')
  assert(JSON.parse(messages[2].content as string).output === 'out', 'small stale result kept untouched')
  console.log('  OK small stale tool results kept (no [trimmed] nuke)')
}
{
  // P0-4: trimmedUntilId reports the max pruned __dbId for DB write-back.
  const messages: LLMMessage[] = [
    userMsg('hi'),
    asmCalls('c1'), toolMsg('c1', 'x'.repeat(9000)),
    asmCalls('c2'), toolMsg('c2'),
    asmCalls('c3'), toolMsg('c3'),
    asmCalls('c4'), toolMsg('c4'),
  ]
  ;(messages[2] as any).__dbId = 101
  ;(messages[4] as any).__dbId = 102
  const trimmed = trimToolResults(messages)
  assert(trimmed.pruned === true, 'pruned with ids')
  assert(trimmed.trimmedUntilId === 101, 'max pruned __dbId reported')
  console.log('  OK P0-4 trimmedUntilId watermark reported')
}

// ---- estimateTokens / thresholds -------------------------------------------
{
  const short: LLMMessage[] = [userMsg('hello world')]
  const long: LLMMessage[] = []
  for (let i = 0; i < 2500; i++) long.push(userMsg('x'.repeat(300)))
  assert(!shouldCompact(short) && !shouldSnip(short), 'short context stays under thresholds')
  assert(shouldCompact(long), 'long context triggers compaction')
  assert(shouldSnip(long), 'long context triggers snip')
  assert(estimateTokens([]) === 0, 'empty context zero tokens')
  console.log('  OK token estimation and thresholds')
}

// ---- systemMessageEnd -------------------------------------------------------
{
  const messages: LLMMessage[] = [
    { role: 'system', content: 'sys1' },
    { role: 'system', content: 'sys2' },
    userMsg('u'),
  ]
  assert(systemMessageEnd(messages) === 2, 'system block length detected')
  console.log('  OK systemMessageEnd')
}

// ---- detectDoomLoop ----------------------------------------------------------
{
  assert(!detectDoomLoop([]), 'empty history not doomed')
  assert(!detectDoomLoop([toolRecord('read', true), toolRecord('read', true), toolRecord('read', true)]), '3 errors not enough')
  const sixErrors = [1, 2, 3, 4, 5, 6].map(() => toolRecord('bash', true))
  assert(detectDoomLoop(sixErrors), '6 consecutive errors is doomed')
  const repeating = [1, 2, 3, 4, 5, 6].map(() => toolRecord('write', false))
  assert(detectDoomLoop(repeating), '6 same-tool calls is doomed')
  const mixed = [toolRecord('a', false), toolRecord('b', true), toolRecord('a', false), toolRecord('b', true), toolRecord('a', false), toolRecord('b', true)]
  assert(!detectDoomLoop(mixed), 'mixed history not doomed')
  console.log('  OK detectDoomLoop semantics preserved')
}

// ---- evaluateFinalAnswer ------------------------------------------------------
{
  assert(evaluateFinalAnswer('done', []).shouldStop === true, 'text answer stops')
  const keepGoing = evaluateFinalAnswer('', [toolRecord('read', false)])
  assert(keepGoing.shouldStop === false && keepGoing.reason === 'no_text_with_tools', 'empty text with tool history keeps working')
  assert(evaluateFinalAnswer('', []).shouldStop === true, 'empty turn with no tools stops')
  console.log('  OK final-answer evaluation')
}

// ---- selectEntries does not break tool_calls/tool pairs ----------------------
{
  const messages: LLMMessage[] = []
  for (let i = 0; i < 60; i++) {
    messages.push(userMsg(`question ${i}`))
    messages.push(asmCalls(`c${i}`))
    messages.push(toolMsg(`c${i}`))
    messages.push(asm(`answer ${i}`))
  }
  // Tiny budget forces a split inside the history
  const selected = selectEntries(messages, 40)
  assert(!!selected, 'selection happened')
  assert(selected.head.length > 0 && selected.recent.length > 0, 'head/recent split')
  assert(!(selected.recent[0].role === 'tool'), 'recent never starts with an orphan tool response')
  const recentIds = new Set(selected.recent.filter(m => m.tool_call_id).map(m => m.tool_call_id))
  for (const m of selected.recent) {
    if (m.role === 'tool') assert(recentIds.has(m.tool_call_id!), 'tool response has its call within recent')
  }
  console.log('  OK selectEntries keeps tool_calls/tool pairs intact')
}

// ---- P0-2: budget split landing between a call and its result is repaired ----
function assertBalancedSeq(msgs: LLMMessage[], label: string): void {
  const results = new Set(msgs.filter(m => m.role === 'tool' && m.tool_call_id).map(m => m.tool_call_id!))
  const calls = new Set<string>()
  for (const m of msgs) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) if (tc.id) calls.add(tc.id!)
    }
  }
  for (const id of results) assert(calls.has(id), `${label}: result ${id} has its call`)
  for (const id of calls) assert(results.has(id), `${label}: call ${id} has its result`)
}
{
  // recent[0] would be a tool result whose call was cut into head -> repair
  const bigCall = (callId: string, content: string): LLMMessage =>
    ({ role: 'assistant', content, tool_calls: [{ id: callId, type: 'function', function: { name: 'read', arguments: '{}' } }] })
  const messages: LLMMessage[] = [
    userMsg('q0'),
    bigCall('c0', 'x'.repeat(300)), // token-heavy: 50+ tokens
    toolMsg('c0', 'y'.repeat(40)),  // ~10 tokens; budget 12 keeps it but not its call
  ]
  const selected = selectEntries(messages, 12)
  assert(!!selected && selected.head.length > 0, 'repair keeps some head')
  assertBalancedSeq(selected.recent, 'tool-first crossing')
  assert(selected.recent[0]?.role === 'assistant' || selected.recent[0]?.role === 'user',
    'recent does not start with orphan tool response')
  console.log('  OK P0-2 tool-first cut repaired')
}
{
  // multi-call assistant: only some results land in recent -> repair pulls them together
  const multiCall = (callIds: string[]): LLMMessage => ({
    role: 'assistant', content: 'plan',
    tool_calls: callIds.map(id => ({ id, type: 'function' as const, function: { name: 'read', arguments: '{}' } })),
  })
  const messages: LLMMessage[] = [
    userMsg('q0'),
    multiCall(['a', 'b']),
    toolMsg('a', 'yy'.repeat(6)), // small-ish
    toolMsg('b', 'zz'.repeat(40)), // heavier tail
  ]
  const selected = selectEntries(messages, 10)
  assert(!!selected, 'selection happened')
  assertBalancedSeq(selected.recent, 'multi-call split')
  assert(selected.recent.some(m => m.role === 'assistant' && m.tool_calls?.length === 2),
    'multi-call assistant moved wholesale into recent')
  console.log('  OK P0-2 multi-call assistant stays intact')
}
{
  // permanent orphans (no matching pair anywhere) must not block compaction
  const messages: LLMMessage[] = [
    userMsg('q0'),
    asmCalls('c0'), toolMsg('c0'),
    userMsg('q1'),
    // 幽灵调用：全量会话中都没有它的结果。若不按中性处理，会把整段都拖进 recent。
    { role: 'assistant', content: 'orphan call', tool_calls: [{ id: 'ghost', type: 'function', function: { name: 'read', arguments: '{}' } }] },
  ]
  const selected = selectEntries(messages, 12)
  assert(!!selected && selected.head.length > 0, 'orphan call does not force everything into recent')
  assert(selected.recent.some(m => m.tool_calls?.some(tc => tc.id === 'ghost')),
    'ghost call stays in recent (harmless)')
  console.log('  OK P0-2 permanent orphans treated as neutral')
}

// ---- P2-2: envInt 读取非负整数环境变量 ---------------------------------------
{
  const KEY = 'TSS_TEST_ENVINT'
  const prev = process.env[KEY]
  try {
    process.env[KEY] = '42'
    assert(envInt(KEY, 7) === 42, 'env value read')
    process.env[KEY] = 'not-a-number'
    assert(envInt(KEY, 7) === 7, 'invalid env falls back')
    process.env[KEY] = '-3'
    assert(envInt(KEY, 7) === 7, 'negative env falls back')
    delete process.env[KEY]
    assert(envInt(KEY, 7) === 7, 'missing env falls back')
  } finally {
    if (prev === undefined) delete process.env[KEY]
    else process.env[KEY] = prev
  }
  console.log('  OK P2-2 envInt threshold config')
}

console.log('ALL LOOP TESTS PASSED')
