/**
 * Run: npx tsx src/agent/loop/loop-policy.test.ts
 */

import { estimateTokens, shouldCompact, shouldSnip, shouldSnipTokens, trimToolResults, systemMessageEnd, resolveKeepTokens, resolveCompactPolicy, manualCompactThreshold, DEFAULT_COMPACT_POLICY } from './loop-policy.js'
import { detectDoomLoop, evaluateFinalAnswer } from './completion-evaluator.js'
import { selectEntries, compactHistory, capSummaryLength } from './context-compactor.js'
import { envInt } from '../../config.js'
import type { LLMMessage } from '../../llm/client.js'
import type { ToolCallRecord } from '../inner.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const toolRecord = (toolName: string, hasError: boolean, extra: Partial<ToolCallRecord> = {}): ToolCallRecord => ({ toolName, hasError, error: hasError ? 'boom' : undefined, ...extra })

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

  // P1-1: 0.85 threshold boundary — 2026 × 300B msg ≈ 160,054 tok: triggers
  // at the old 0.75 (150k) but must NOT trigger at 0.85 (170k).
  const boundary: LLMMessage[] = []
  for (let i = 0; i < 2026; i++) boundary.push(userMsg('x'.repeat(300)))
  assert(estimateTokens(boundary) === 160054, '2026x300 boundary estimate exact')
  assert(!shouldCompact(boundary), '160054 tok not compacted at 0.85 (was at 0.75)')

  // P2-1: snipRatio 来自 policy（默认回退 SNIP_RATIO=0.6），可被模型级 compact_snip_ratio 覆盖。
  assert(!shouldSnipTokens(100000, 200000), 'default snipRatio 0.6 not triggered at 100k/200k')
  assert(shouldSnipTokens(100000, 200000, { ...DEFAULT_COMPACT_POLICY, snipRatio: 0.4 }), 'policy snipRatio 0.4 triggers at 100k/200k')
  assert(!shouldSnipTokens(70000, 200000, { ...DEFAULT_COMPACT_POLICY, snipRatio: 0.4 }), 'policy snipRatio 0.4 not triggered at 70k/200k')
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
  assert(!detectDoomLoop([]).doomed, 'empty history not doomed')
  const threeErrors = [1, 2, 3].map(() => toolRecord('read', true))
  assert(!detectDoomLoop(threeErrors).doomed, '3 errors not enough')

  // Regression (session mt2i2ie348v2tb): a legitimate sequential workflow —
  // same tool, different args/results, all successful — must NOT be flagged.
  const exploration = [1, 2, 3, 4, 5, 6].map(i => toolRecord('bash', false, {
    args: `{"command":"step ${i}"}`, normalizedArgsHash: `a${i}`, resultHash: `r${i}`,
  }))
  assert(!detectDoomLoop(exploration).doomed, 'sequential exploration with distinct calls not doomed')

  // Identical spin: same tool + same args hash + same result hash.
  const spin = [1, 2, 3, 4, 5, 6].map(() => toolRecord('bash', false, {
    args: '{"command":"ls"}', normalizedArgsHash: 'a', resultHash: 'r',
  }))
  const spinVerdict = detectDoomLoop(spin)
  assert(spinVerdict.doomed && spinVerdict.kind === 'identical_calls', 'identical-call spin is doomed')
  assert(spinVerdict.doomed && spinVerdict.lastTool === 'bash' && spinVerdict.argsPreview.includes('ls'), 'verdict names the spinning tool and previews args')

  // Six consecutive failures remain doomed under all_failed.
  const sixErrors = [1, 2, 3, 4, 5, 6].map(() => toolRecord('bash', true))
  const errVerdict = detectDoomLoop(sixErrors)
  assert(errVerdict.doomed && errVerdict.kind === 'all_failed', '6 consecutive errors is doomed (all_failed)')

  // Legacy/synthetic records without hashes: repetition branch never fires.
  const legacy = [1, 2, 3, 4, 5, 6].map(() => toolRecord('write', false))
  assert(!detectDoomLoop(legacy).doomed, 'same-name records without hashes are not repetition-doomed')

  const mixed = [toolRecord('a', false), toolRecord('b', true), toolRecord('a', false), toolRecord('b', true), toolRecord('a', false), toolRecord('b', true)]
  assert(!detectDoomLoop(mixed).doomed, 'mixed history not doomed')
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
    bigCall('c0', 'x'.repeat(300)), // ~81 tokens（真实 token 口径）
    toolMsg('c0', 'y'.repeat(40)),  // ~18 tokens；预算 20 留下它但切掉它的调用
  ]
  const selected = selectEntries(messages, 20)
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
    toolMsg('b', 'zz'.repeat(40)), // ~28 tokens；预算 30 留下它但切掉更早消息
  ]
  const selected = selectEntries(messages, 30)
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

// ---- P1-3: 保留预算按窗口缩放 + 重试递减 --------------------------------------
{
  const at = resolveKeepTokens(200000, 0)
  assert(at === 32000, `200k window → 16% = 32000 (got ${at})`)
  const attempt1 = resolveKeepTokens(200000, 1)
  assert(attempt1 === 16000, `200k window attempt 1 halves budget (got ${attempt1})`)
  const attempt2 = resolveKeepTokens(200000, 2)
  assert(attempt2 === 8000, `200k window attempt 2 halves again (got ${attempt2})`)
  const tiny = resolveKeepTokens(10000, 0)
  assert(tiny === 4000, `small window clamps to KEEP_TOKENS_MIN=4000 (got ${tiny})`)
  const huge = resolveKeepTokens(2_000_000, 0)
  assert(huge === 64000, `huge window clamps to KEEP_TOKENS_MAX=64000 (got ${huge})`)
  console.log('  OK P1-3 resolveKeepTokens scales with window, clamps, and decrements on retry')
}

// ---- P1-4: 按模型策略解析（阈值/保留比/摘要模型） ------------------------------
{
  const defaults = resolveCompactPolicy(null)
  assert(defaults.thresholdRatio === 0.85 && defaults.retainRatio === 0.16, 'defaults used when modelConfig absent')
  const perModel = resolveCompactPolicy({
    compact_threshold_ratio: 0.9,
    compact_retain_ratio: 0.2,
    compact_provider: 'prov_a',
    compact_model: 'summary-1',
  })
  assert(perModel.thresholdRatio === 0.9 && perModel.retainRatio === 0.2, 'per-model ratios honored')
  assert(perModel.summarizationProvider === 'prov_a' && perModel.summarizationModel === 'summary-1', 'per-model summarizer honored')
  const partial = resolveCompactPolicy({ compact_retain_ratio: 0.1 })
  assert(partial.thresholdRatio === 0.85 && partial.retainRatio === 0.1, 'partial override keeps defaults for the rest')
  console.log('  OK P1-4 resolveCompactPolicy honors per-model fields, falls back to defaults')
}

// ---- 硬约束: compactHistory 逐字节保留 system 前缀 ----------------------------
{
  const messages: LLMMessage[] = [
    { role: 'system', content: 'SYS_PROMPT_BYTES_1' },
    { role: 'system', content: 'SYS_PROMPT_BYTES_2' },
    userMsg('q0'), asm('a0'), userMsg('q1'), asm('a1'),
  ]
  const compacted = compactHistory(messages, '## Goal\n- x', messages.slice(2))
  const sysEnd = systemMessageEnd(compacted)
  const kept = compacted.slice(0, sysEnd).map(m => m.content)
  assert(kept[0] === 'SYS_PROMPT_BYTES_1', 'first system message byte-identical')
  assert(kept[1] === 'SYS_PROMPT_BYTES_2', 'second system message byte-identical')
  assert(typeof kept[2] === 'string' && kept[2].startsWith('[Compacted History]'), 'new summary appended inside system block')
  assert(compacted.length === messages.length + 1, 'summary message appended + recent tail re-appended')
  console.log('  OK hard-constraint: compactHistory preserves initial system prompt byte-identically')
}

// ---- P2-7: 摘要长度保险按节截断 ----------------------------------------------
{
  const big = '## Goal\n- a\n' + '## Progress\n- ' + 'y'.repeat(12000)
  const capped = capSummaryLength(big)
  assert(capped.endsWith('(truncated)'), 'over-cap summary marked truncated')
  assert(capped.includes('## Goal') && capped.includes('## Progress'), 'section headers kept')
  const small = '## Goal\n- done'
  assert(capSummaryLength(small) === small, 'under-cap summary untouched')
  console.log('  OK P2-7 capSummaryLength bounds summary, keeps section headers')
}

// ---- P0-1: trimToolResults 剪近期窗口内超大工具结果 --------------------------
{
  const messages: LLMMessage[] = [
    userMsg('hi'),
    asmCalls('c1'), toolMsg('c1', 'b'.repeat(40)),       // turn 4 → stale, small → 不动
    asmCalls('c2'), toolMsg('c2', 'c'.repeat(20000)),   // turn 3 → recent oversized → 剪枝
    asmCalls('c3'), toolMsg('c3', 'fresh'),              // turn 2 → recent small → 保留
    asmCalls('c4'), toolMsg('c4', 'out'),                // turn 1 → recent small → 保留
  ]
  const trimmed = trimToolResults(messages)
  assert(trimmed.pruned === true, 'recent oversized result pruned')
  const c2 = JSON.parse(messages[4].content as string)
  assert(typeof c2.output === 'string' && c2.output.includes('工具输出中部已省略'), 'recent oversized c2 head/tail pruned')
  assert(JSON.parse(messages[2].content as string).output === 'b'.repeat(40), 'stale small kept untouched')
  assert(JSON.parse(messages[6].content as string).output === 'fresh', 'recent small kept')
  assert(JSON.parse(messages[8].content as string).output === 'out', 'newest kept')
  console.log('  OK P0-1 trimToolResults prunes recent oversized tool result')
}

// ---- P0-1b: selectEntries 边界救援（最后一条超大工具结果单独超预算）----------
{
  const messages: LLMMessage[] = []
  for (let i = 0; i < 5; i++) {
    messages.push(userMsg(`q${i}`))
    messages.push(asmCalls(`c${i}`))
    messages.push(toolMsg(`c${i}`))
  }
  messages.push(asmCalls('clast'))
  messages.push(toolMsg('clast', 'x'.repeat(100000)))   // ~25k tokens，单独超预算
  const selected = selectEntries(messages, 10000)
  assert(!!selected, 'boundary rescue: selection happens instead of undefined')
  assert(selected!.head.length > 0 && selected!.recent.length > 0, 'head & recent non-empty')
  assert(selected!.recent.some(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('工具输出中部已省略')),
    'oversized last tool result pruned into recent')
  const lastOriginal = messages[messages.length - 1].content as string
  assert(lastOriginal.includes('x'.repeat(100000)), 'original array untouched (full result kept)')
  const compacted = compactHistory(messages, '## Goal\n- x', selected!.recent)
  assert(estimateTokens(compacted) < estimateTokens(messages), 'compacted shrinks below original (shrinkVerified holds)')
  console.log('  OK P0-1b selectEntries boundary rescue prunes oversized last tool result')
}

// ---- P0-2b: selectEntries 中段切分（最后一条超大纯文本） ---------------------
{
  const big = 'x'.repeat(100000)
  const originalLen = Array.from('huge ' + big).length
  const messages: LLMMessage[] = [
    userMsg('q0'), asm('a0'),
    userMsg('q1'), asm('a1'),
    userMsg('huge ' + big),   // ~25k tokens，最后一条
  ]
  const selected = selectEntries(messages, 10000)
  assert(!!selected && selected!.head.length > 0 && selected!.recent.length > 0, 'split gives head & recent')
  const users = [...selected!.head, ...selected!.recent].filter((m): m is LLMMessage & { content: string } => m.role === 'user' && typeof m.content === 'string')
  const totalUserLen = users.reduce((s, m) => s + m.content.length, 0)
  assert(totalUserLen >= originalLen - 4, `split preserves ~all user text (${totalUserLen} vs ${originalLen})`)
  assert(selected!.head.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('huge ')),
    'head part keeps the message prefix')
  console.log('  OK P0-2b selectEntries splits oversized pure-text last message')
}

// ---- P1-1: repair 膨胀时最新 user 保底回 recent ------------------------------
{
  const messages: LLMMessage[] = [
    userMsg('q0'), asm('a0'),
    userMsg('keep'), asm('aKeep'),
    userMsg('intent'),
    { role: 'assistant', content: 'x'.repeat(39800), tool_calls: [{ id: 'c99', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    toolMsg('c99', 'y'.repeat(60000)),
  ]
  // 动态构造预算：不加 intent 时 recent 刚好在预算内，加上 intent 就超 → intent 被划进 head；
  // 但 intent 到末尾 < 1.25×预算 → P1-1 允许拉回，随后 P0-1 剪掉大结果。
  const recentWithoutIntent = estimateTokens(messages.slice(5))
  const budget = recentWithoutIntent + 1
  const selected = selectEntries(messages, budget)
  assert(!!selected, 'selection happens')
  assert(selected!.recent.some(m => m.role === 'user' && m.content === 'intent'),
    'latest user message preserved in recent (P1-1 floor)')
  assert(messages[4].content === 'intent', 'original messages untouched')
  console.log('  OK P1-1 latest user intent kept in recent under repair inflation')
}

// ---- P2: COMPACT_RESERVED 旋钮 ----------------------------------------------
{
  const w = 200000
  assert(resolveKeepTokens(w, 0) === 32000, 'default: no reserved, 16% = 32000')
  assert(resolveKeepTokens(w, 0, undefined, 180000) === 20000, 'reserved 180k caps recent to 20k')
  const attempt1 = resolveKeepTokens(w, 1, undefined, 180000)
  assert(attempt1 === 10000, 'reserved still halves on retry (20000>>1 = 10000)')
  assert(resolveKeepTokens(50000, 0, undefined, 49000) === 4000, 'reserved clamps to KEEP_TOKENS_MIN floor')
  console.log('  OK P2 COMPACT_RESERVED caps recent budget below window-reserved, default off')
}

// ---- 手动压缩触发阈值：min(窗口×35%, 绝对下限 170k) --------------------------
{
  assert(manualCompactThreshold(200000) === 70000, '200k window: relative 35% wins (70k)')
  assert(manualCompactThreshold(128000) === 44800, '128k window: relative 35% wins (44.8k)')
  assert(manualCompactThreshold(1_000_000) === 170000, '1M window: absolute floor wins (170k)')
  assert(manualCompactThreshold(2_000_000) === 170000, '2M window: absolute floor wins (170k)')
  console.log('  OK manual compact threshold = min(window x 35%, 170k absolute floor)')
}

// ---- 手动压缩保留预算：按自动重试第 1 档减半（更激进） ------------------------
{
  assert(resolveKeepTokens(1_000_000, 1) === 32000, '1M manual keep = 64k >> 1 = 32k')
  assert(resolveKeepTokens(200000, 1) === 16000, '200k manual keep = 32k >> 1 = 16k')
  assert(resolveKeepTokens(50000, 1) === 4000, 'small window clamps to KEEP_TOKENS_MIN')
  console.log('  OK manual compact keep = auto keep halved, clamped to KEEP_TOKENS_MIN')
}

console.log('ALL LOOP TESTS PASSED')
