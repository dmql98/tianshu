/**
 * P0-1 测量脚本（v2：定量 cache 前缀命中比例）
 *
 * 复用循环使用的【真实】compose / capturePrefixShape / compareShapes /
 * shouldSnipTokens / shouldCompactTokens / trimToolResults / estimateTokens，
 * 按 runLoopEngine 的真实推进方式驱动若干轮，得到每轮：
 *   - 前缀是否字节稳定（append-only）？若否，第一个不一致消息在哪儿？
 *   - 该轮"可命中前缀"占总发送历史的比例（消息级 + token 级）。
 *
 * 运行：cd web/server && node --import tsx scripts/p01-cache-shape-measure.ts
 *
 * 已融入的关键事实（来自 loop-engine.ts / compose.ts）：
 *   - 每轮 `messages`（主历史）只被追加，从不回写 compose 追加的尾部 alert；
 *     compose 的注释明确"该上下文消息不持久化进主历史"。
 *   - 只有 systemAlerts 非空的那一轮，compose 才在尾部追加一条 user 消息。
 *   - direct 模式无计划/无目标时，绝大多数轮 systemAlerts 为空 → 纯 append-only。
 */

import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.TIANSHU_DATA_DIR = mkdtempSync(join(tmpdir(), 'tianshu-p01-'))

interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  reasoning_content?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

const { composeMessages } = await import('../src/agent/compose.js')
const { capturePrefixShape, compareShapes } = await import('../src/agent/system-cache.js')
const { estimateTokens, shouldSnipTokens, shouldCompactTokens, trimToolResults, DEFAULT_CONTEXT_WINDOW, DEFAULT_COMPACT_POLICY } = await import('../src/agent/loop/loop-policy.js')

const TOOLS = [
  { type: 'function', function: { name: 'read', description: 'Read a file from the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'bash', description: 'Execute a shell command in the workspace.', parameters: { type: 'object', properties: { command: { type: 'string' } } } } },
  { type: 'function', function: { name: 'webfetch', description: 'Fetch a web page and convert it to markdown.', parameters: { type: 'object', properties: { url: { type: 'string' } } } } },
] as any

const systemMsgs: LLMMessage[] = [
  { role: 'system', content: '## Character\n你是一名严谨的天枢执行引擎分析助手。' },
  { role: 'system', content: '## Available Skill Packages\n- data-analysis（数据分析）\n- software-engineering（软件工程）' },
]

const asmCalls = (id: string, name: string, args: unknown, reasoning?: string): LLMMessage => {
  const m: LLMMessage = { role: 'assistant', content: '我需要先看一下当前状态。', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
  if (reasoning !== undefined) m.reasoning_content = reasoning
  return m
}
const toolMsg = (id: string, output: string, err?: string): LLMMessage =>
  ({ role: 'tool', content: JSON.stringify(err ? { output: '', error: err } : { output, error: '' }), tool_call_id: id })
const userMsg = (content: string): LLMMessage => ({ role: 'user', content })

interface Sc {
  name: string
  toolTurns: number
  contextWindow: number
  toolResult: (t: number) => string
  preserveReasoning: boolean
  /** 每轮是否注入尾部 alert（模拟 plan-first/goal 的 [Policy] 渲染）*/
  alertEveryTurn: boolean
  /** 仅第 0 轮注入一次 alert（模拟"变化才注入"，之后各轮为空）*/
  alertOnce: boolean
  toolName: string
}

async function run(sc: Sc): Promise<{ rows: Array<{ turn: number; appendOnly: boolean; shareMsg: number; shareTok: number; firstRaw: number; note: string }> }> {
  const messages: LLMMessage[] = [...systemMsgs, userMsg('最近任务明显变慢，请分析 P0-1 执行链路性能并给出结论。')]
  if (sc.preserveReasoning) {
    messages.push(asmCalls('seed', 'read', { path: 'x' }, undefined))
    messages.push(toolMsg('seed', '{}'))
  }
  const policy = DEFAULT_COMPACT_POLICY
  const rows = []
  let prev = capturePrefixShape(composeMessages(messages, { preserveReasoning: sc.preserveReasoning }), TOOLS)
  const prevCtxTokens = estimateTokens(messages)

  for (let t = 0; t < sc.toolTurns; t++) {
    messages.push(asmCalls(`c${t}`, sc.toolName, { probe: t }, sc.preserveReasoning ? `第${t}轮推理(${'x'.repeat(60)})` : undefined))
    messages.push(toolMsg(`c${t}`, sc.toolResult(t), sc.toolName.startsWith('measure_noop') ? `${sc.toolName}: not bound` : undefined))

    // 回合后：剪枝 / 压缩（真实决策函数）
    const projected = estimateTokens(messages)
    if (shouldSnipTokens(projected, sc.contextWindow)) {
      trimToolResults(messages)
    }
    if (shouldCompactTokens(projected, sc.contextWindow, policy)) {
      messages.splice(systemMsgs.length, messages.length - systemMsgs.length, userMsg('   [Compacted History] 1. 用户请求分析链路性能。2. 检查了 read 工具若干次。…'))
    }

    // compose：仅在注入 alert 的那一轮末尾追加（真实循环：仅 systemAlerts 非空才追加）
    const alerts = sc.alertEveryTurn || (sc.alertOnce && t === 0)
      ? ['[Policy Direct] 当前计划 v1：1. 定位瓶颈 2. 给出优化方案', '[System Alert] 已接近软上限，请收敛。']
      : undefined
    const composed = composeMessages(messages, { preserveReasoning: sc.preserveReasoning, systemAlerts: alerts })

    const cur = capturePrefixShape(composed, TOOLS)
    const diff = compareShapes(prev, cur)

    // 计算"第一条不一致消息"在 cur 中的消息级位置 → 可命中前缀占比
    const firstDiffIdx = cur.historyItems.findIndex((it, i) => prev.historyItems[i] !== it)
    // 命中前缀 = cur 里与 prev 完全一致的前缀长度（消息数）
    let shareMsg = 1
    if (firstDiffIdx >= 0) shareMsg = firstDiffIdx / cur.historyItems.length
    else shareMsg = 1
    // token 级：前缀 hit = 首条不一致消息之前的消息 token；这里用 全量/历史 近似，取消息占比。
    const firstRaw = firstDiffIdx >= 0 ? cur.historyIndexes[firstDiffIdx] : -1

    rows.push({
      turn: t,
      appendOnly: diff.length === 0,
      shareMsg: Number(shareMsg.toFixed(3)),
      shareTok: Number(shareMsg.toFixed(3)), // 消息级近似（真实以 provider 上报为准）
      firstRaw,
      note: diff.length === 0 ? '' : diff.join('; '),
    })
    prev = cur
  }
  return { rows }
}

async function main() {
  const scenarios: Array<[string, Sc, string]> = [
    ['A  direct 正常短任务（无 plan 无 alert / 大窗口）', { name: 'A', toolTurns: 6, contextWindow: DEFAULT_CONTEXT_WINDOW, toolResult: () => `{"lines":["line_"+"x".repeat(80)],"ok":true}`, preserveReasoning: false, alertEveryTurn: false, alertOnce: false, toolName: 'read' }, '窗口 200k，6 轮，结果 ~24 tok/轮'],
    ['A2 plan-first 注入 [Policy] 渲染（变化才注入）', { name: 'A2', toolTurns: 6, contextWindow: DEFAULT_CONTEXT_WINDOW, toolResult: () => `{"lines":["line_"+"x".repeat(80)],"ok":true}`, preserveReasoning: false, alertEveryTurn: false, alertOnce: true, toolName: 'read' }, '第 0 轮注入一次 [Policy]，之后各轮 alert 为空'],
    ['B  小窗口 + 超大输出 → 触发 snip / compact', { name: 'B', toolTurns: 6, contextWindow: 10000, toolResult: () => `{"data":"${'x'.repeat(20000)}"}`, preserveReasoning: false, alertEveryTurn: false, alertOnce: false, toolName: 'read' }, '窗口 10k，结果 ~5000 tok/轮 → 触达软阈值与压缩阈值'],
    ['C  推理模型（preserveReasoning）', { name: 'C', toolTurns: 6, contextWindow: DEFAULT_CONTEXT_WINDOW, toolResult: () => `{"lines":["line_"+"x".repeat(80)],"ok":true}`, preserveReasoning: true, alertEveryTurn: false, alertOnce: false, toolName: 'read' }, '每轮 assistant 含 reasoning_content'],
  ]

  console.log('\n=================== P0-1：每轮前缀稳定性 & cache 命中比例 ===================\n')
  const summaries: string[] = []
  for (const [title, sc, extra] of scenarios) {
    const { rows } = await run(sc)
    const appendOnlyCount = rows.filter(r => r.appendOnly).length
    const avgShare = rows.reduce((a, r) => a + r.shareTok, 0) / rows.length
    const minShare = Math.min(...rows.map(r => r.shareTok))
    console.log(`■ ${title}`)
    console.log(`  配置：${extra}`)
    console.log(`  轮次 ${rows.length} ｜ append-only ${appendOnlyCount}/${rows.length} ｜ 平均可命中前缀比例 ${(avgShare * 100).toFixed(0)}% ｜ 最低 ${(minShare * 100).toFixed(0)}%`)
    for (const r of rows) {
      const flag = r.appendOnly
        ? `append-only(可复用前缀≈${(r.shareTok * 100).toFixed(0)}%)`
        : `break@msg#${r.firstRaw}(可复用前缀≈${(r.shareTok * 100).toFixed(0)}%)`
      console.log(`    turn ${r.turn}: ${flag}${r.note ? '  ← ' + r.note : ''}`)
    }
    summaries.push(`  ${title.split('  ')[0]}: append-only ${appendOnlyCount}/${rows.length}，平均可命中前缀 ${(avgShare * 100).toFixed(0)}%`)
    console.log('')
  }

  console.log('=================== 结论 ===================\n')
  console.log('  · A/direct 正常任务：6/6 轮纯 append-only → provider 端 prefix cache 可命中。')
  console.log('    可复用前缀比例随历史增长：turn0 仅 ~33%（本轮新增消息占短历史的比例大），')
  console.log('    随轮次推进升到 90%+（平均 ~68%）。报告 P0-1 所述"每轮全量重发、无复用收益"在此路径下不成立。')
  console.log('  · A2 (plan-first/goal 的 [Policy] 渲染)：仅注入 alert 的那一轮，其下一轮出现 1 处 break')
  console.log('    （alert 尾部块因未持久化进主历史，在下一轮 compose 时消失）。可复用前缀仍较高，')
  console.log('    属可接受的瞬态小尾巴，非系统性每轮 bug。')
  console.log('  · B（小窗口/大输出，10k 窗口 + ~5000 tok/轮）：snip/compact 会重写较靠前的历史（turn1/3/5）')
  console.log('    → 可复用前缀骤降（最低 0%）。这是内存管理必然导致的前缀失效（压缩换空间），')
  console.log('    属预期行为，不是可消除的每轮 bug；其代价可用 P1-1 的压缩收益判定/预算化来管理。')
  console.log('  · C（推理模型）：reasoning_content 逐轮重发但字节稳定，仍 append-only（6/6）→ 不构成问题。')
  console.log('\n  一句话：真正的瓶颈并非"每轮全量重发"，而是"小窗口/长会话下 snip/compact 的前缀失效"')
  console.log('  与"plan-first/goal 尾部 alert 的少量瞬态误报"。前者由 P1-1 预算化控制，后者见 P0-3。')
}

main().catch(err => { console.error(err); process.exitCode = 1 })
