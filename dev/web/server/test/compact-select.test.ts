import { describe, it } from 'vitest'
import assert from 'node:assert'
import { selectEntries } from '../src/agent/loop/context-compactor.js'
import { estimateTokens, resolveKeepTokens, DEFAULT_COMPACT_POLICY, DEFAULT_CONTEXT_WINDOW } from '../src/agent/loop/loop-policy.js'
import type { LLMMessage } from '../src/llm/client.js'

// 复现“会话爆满但点压缩永远显示无需压缩”的根因：
// 旧实现 selectEntries 用被简化的序列化文本做预算累加，工具结果被压成
// 'success'（约 7 token），导致工具密集会话在预算累加中几乎不占空间，
// 整体被当作“都在近端”，split=0、head 为空，于是 didCompact=false。
// 修复后预算按消息真实 token 累加，工具密集会话也能正确切分出 head。
describe('selectEntries — tool-heavy large session', () => {
  it('splits a ~190k tool-heavy conversation into head+recent (bug repro)', () => {
    const big = 'x'.repeat(1900 * 4) // ~1900 tokens of plain (non-CJK) text
    const conversation: LLMMessage[] = []
    for (let i = 0; i < 100; i++) {
      conversation.push({ role: 'user', content: `step ${i}` })
      conversation.push({
        role: 'assistant',
        content: `did ${i}`,
        tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'bash', arguments: '{}' } }],
      })
      conversation.push({ role: 'tool', tool_call_id: `c${i}`, content: `output ${i}\n${big}` })
    }
    const total = estimateTokens(conversation)
    const budget = resolveKeepTokens(DEFAULT_CONTEXT_WINDOW, 0, DEFAULT_COMPACT_POLICY)
    assert(total > DEFAULT_CONTEXT_WINDOW * 0.9, `sanity: built a large session (${total} tokens)`)

    const selected = selectEntries(conversation, budget)
    assert(selected, 'selected should not be undefined')
    assert(
      selected!.head.length > 0,
      `head must be non-empty for a ${total}-token session (budget ${budget}); otherwise compact reports "nothing to compact"`,
    )
    assert(selected!.recent.length > 0, 'recent must be non-empty')
    const headTokens = estimateTokens(selected!.head)
    assert(headTokens > 0 && headTokens < total, 'head should be a strict subset of the conversation')
  })
})

describe('selectEntries — boundary rescue (P0-1/P0-2)', () => {
  it('keeps compaction alive when the last message alone exceeds the budget', () => {
    const conversation: LLMMessage[] = []
    for (let i = 0; i < 5; i++) {
      conversation.push({ role: 'user', content: `step ${i}` })
      conversation.push({ role: 'assistant', content: `did ${i}`, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'bash', arguments: '{}' } }] })
      conversation.push({ role: 'tool', tool_call_id: `c${i}`, content: JSON.stringify({ output: `output ${i}\n${'x'.repeat(1900 * 4)}` }) })
    }
    // 最后一条：超大工具结果，单独就超过预算（旧行为：repair 返回 0 → selectEntries
    // 返回 undefined → 压缩永不触发 → 会话直到溢出）。
    conversation.push({ role: 'assistant', content: 'last call', tool_calls: [{ id: 'clast', type: 'function', function: { name: 'read', arguments: '{}' } }] })
    conversation.push({ role: 'tool', tool_call_id: 'clast', content: JSON.stringify({ output: 'x'.repeat(100000) }) })
    const selected = selectEntries(conversation, 10000)
    assert(selected, 'must not return undefined (no-compact deadlock)')
    assert(selected!.head.length > 0 && selected!.recent.length > 0, 'head and recent non-empty')
    assert(
      selected!.recent.some(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('工具输出中部已省略')),
      'oversized recent tool result head/tail pruned',
    )
  })
})
