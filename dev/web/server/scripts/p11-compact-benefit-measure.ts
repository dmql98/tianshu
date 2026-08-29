/**
 * P1-1 压缩收益测量：管理性压缩的触发次数与摘要 LLM 调用上界
 *
 * 对比两种行为：
 *   - 旧：阈值 0.75（COMPACT_THRESHOLD 原值）、每次 compactWithRetries 最多
 *     MAX_COMPACT_ATTEMPTS=2 次尝试、结束轮（final_answer 放行 / aborted /
 *     收敛 break）也照常执行回合后压缩（白付一次摘要）。
 *   - 新：阈值 0.85、回合后压缩 maxAttempts=1、snip+compact 块移到循环尾，
 *     结束轮直接跳出循环，不再白付。
 *
 * 用真实 shouldCompactTokens（provider 上报 token 口径，与 loop-engine 回合后
 * 调用一致）。压缩按上界估算：每次触发的摘要 LLM 调用数 = 该行为允许的重试
 * 上限（旧 2 / 新 1）。不做压缩后 token 回落的模拟，因此结果为「上界」——
 * 实际收益只可能更好。
 *
 * 运行：cd web/server && node node_modules/tsx/dist/cli.mjs scripts/p11-compact-benefit-measure.ts
 */

import {
  shouldCompactTokens,
  COMPACT_THRESHOLD,
  MAX_COMPACT_ATTEMPTS,
  DEFAULT_CONTEXT_WINDOW,
  type CompactPolicy,
} from '../src/agent/loop/loop-policy.js'

interface Scenario {
  label: string
  /** 会话开始时的历史上下文 token（provider 上报口径）。 */
  historyTokens: number
  /** 每轮新增 token（工具输出、消息等）。 */
  perTurnTokens: number
  /** 总轮数（最后一轮视为结束轮：final_answer 放行/break）。 */
  turns: number
  note: string
}

const OLD_THRESHOLD = 0.75
const OLD_ATTEMPTS = 2
const NEW_ATTEMPTS = 1

function runScenario(s: Scenario): void {
  const ctx = DEFAULT_CONTEXT_WINDOW
  const oldPolicy: CompactPolicy = { thresholdRatio: OLD_THRESHOLD, retainRatio: 0.16 }
  const newPolicy: CompactPolicy = { thresholdRatio: COMPACT_THRESHOLD, retainRatio: 0.16 }

  let running = s.historyTokens
  let preTriggers = 0
  let preEndTurnWaste = 0
  let postTriggers = 0

  for (let turn = 1; turn <= s.turns; turn++) {
    const projected = running + s.perTurnTokens
    const isEndTurn = turn === s.turns
    // 旧行为：结束轮也压。
    if (shouldCompactTokens(projected, ctx, oldPolicy)) {
      preTriggers++
      if (isEndTurn) preEndTurnWaste++
    }
    // 新行为：结束轮跳过（块在 final_answer/abort/break 之后）。
    if (!isEndTurn && shouldCompactTokens(projected, ctx, newPolicy)) {
      postTriggers++
    }
    running = projected
  }

  const oldUpper = preTriggers * OLD_ATTEMPTS
  const newUpper = postTriggers * NEW_ATTEMPTS
  const saved = oldUpper - newUpper

  console.log(`\n■ ${s.label}（${s.note}）`)
  console.log(`  历史 ${s.historyTokens.toLocaleString()} tok，每轮 +${s.perTurnTokens.toLocaleString()}，共 ${s.turns} 轮（末轮=结束轮）`)
  console.log(`  回合后压缩触发：旧(0.75) ${preTriggers} 次 | 新(0.85+跳过结束轮) ${postTriggers} 次`)
  console.log(`  其中结束轮白付（旧行为）：${preEndTurnWaste} 次`)
  console.log(`  摘要 LLM 调用上界：旧 ${preTriggers}×${OLD_ATTEMPTS}=${oldUpper} | 新 ${postTriggers}×${NEW_ATTEMPTS}=${newUpper}`)
  console.log(`  节省：${saved} 次摘要调用（${oldUpper > 0 ? ((saved / oldUpper) * 100).toFixed(0) : '—'}%）`)
}

try {
  console.log('P1-1 压缩收益测量（shouldCompactTokens=真实口径；阈值 0.75→0.85，回合后 maxAttempts 2→1，结束轮跳过）')
  console.log(`DEFAULT_CONTEXT_WINDOW=${DEFAULT_CONTEXT_WINDOW}，COMPACT_THRESHOLD=${COMPACT_THRESHOLD}，MAX_COMPACT_ATTEMPTS(安全阀路径)=${MAX_COMPACT_ATTEMPTS}`)

  runScenario({
    label: 'short-fresh',
    historyTokens: 2000,
    perTurnTokens: 1000,
    turns: 4,
    note: '短任务、历史很小，新旧都不该触发',
  })
  runScenario({
    label: 'resume-short-ask',
    historyTokens: 155_000,
    perTurnTokens: 1000,
    turns: 2,
    note: '长会话 resume 后小提问：155k 落在旧阈值上、新阈值下',
  })
  runScenario({
    label: 'mid-big-final',
    historyTokens: 20_000,
    perTurnTokens: 32_000,
    turns: 5,
    note: '末轮（final_answer）才越过阈值：旧行为白付一次摘要',
  })
  runScenario({
    label: 'long-session',
    historyTokens: 160_000,
    perTurnTokens: 8000,
    turns: 10,
    note: '长会话持续增长：旧 10/10 触发且含结束轮白付，新 8/10 且跳过结束轮',
  })
} catch (e) {
  console.error(e)
  process.exitCode = 1
}