/**
 * Run: npx tsx src/agent/loop/loop-policy.test.ts
 */

import { estimateTokens, shouldCompact, shouldSnip, trimToolResults, systemMessageEnd } from './loop-policy.js'
import { detectDoomLoop, evaluateFinalAnswer } from './completion-evaluator.js'
import { selectEntries } from './context-compactor.js'
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
    asmCalls('c1'), toolMsg('c1'),
    asmCalls('c2'), toolMsg('c2'),
    asmCalls('c3'), toolMsg('c3'),
    asmCalls('c4'), toolMsg('c4', 'fresh output'),
  ]
  const trimmed = trimToolResults(messages)
  assert(trimmed === true, 'stale tool results trimmed')
  assert(JSON.parse(messages[2].content as string).output === '[trimmed]', 'c1 (4th turn) trimmed')
  assert(JSON.parse(messages[4].content as string).output === 'out', 'c2 (3rd turn) kept')
  assert(JSON.parse(messages[6].content as string).output === 'out', 'c3 kept')
  assert(JSON.parse(messages[8].content as string).output === 'fresh output', 'c4 kept')
  console.log('  OK trimToolResults keeps SNIP_KEEP_TOOL_TURNS recent turns')
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

console.log('ALL LOOP TESTS PASSED')
