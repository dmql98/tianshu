/**
 * P1-3 CPU 增量缓存测量：estimateTokens / capturePrefixShape / compareShapes / stableArgsHash
 *
 * 目标：量化这四个纯 CPU 函数在一轮（一次 LLM 往返 + 本地处理后处理）里的真实耗时
 * 与占比，判断是否值得做 P1-3 原计划的「增量缓存」。
 *
 * 四个场景（消息规模按真实会话建模，type 与 loop-engine/inner 调用点同源）：
 *   - fresh-short     短会话起步（6 条消息，~0.6k tok）
 *   - long-160k       长会话（2026 个工具轮 ≈ 4053 条消息，~170k tok，复用 P1-1
 *                     2026×300 场景的规模；工具结果以 ASCII JSON 为主、助手文本含
 *                     CJK，贴近真实 file/log 密集会话）
 *   - compact-after   压缩刚结束（system + 摘要 2 条 + 最近 12 轮 ≈ 27 条消息）
 *   - subagent-inject 子代理回注后（P1-2 场景：父 assistant 行被 submit_result 的
 *                     updateContent 就地改写 + 追加 continueSubAgentWithMessage
 *                     的工具调用与回注结果）
 *
 * 每轮实际调用次数（按 loop-engine.ts / inner.ts 调用点统计）：
 *   - estimateTokens    主路径 3 次/轮（loop-engine.ts:282 compose 后阈值检查 +
 *                       632/633 尾部投影；209 每 5 轮一次 → +0.2）；snip 触发时
 *                       再 +2（635/638）→ 5.2/轮
 *   - capturePrefixShape + compareShapes  2 次/轮（310/312，会话首轮前无 prev 只有 1 次）
 *   - stableArgsHash    每执行工具 ~2 次（inner.ts:487 参数哈希 + 481/482 结果哈希）
 *                       典型工具轮 4 个工具 → 4×2=8 次/轮
 *
 * 占比基准：一轮以 LLM 往返为主。取 5s（常见多轮长会话）为基准，另附 1s（极快模型）
 * 悲观口径；绝对毫秒数可自行按实际模型延迟换算。
 *
 * 运行：cd web/server && node node_modules/tsx/dist/cli.mjs scripts/p13-cpu-measure.ts
 */

import { estimateTokens, stableArgsHash } from '../src/agent/loop/loop-policy.js'
import type { LLMMessage } from '../src/llm/client.js'
import {
  capturePrefixShape,
  compareShapes,
  type PrefixShape,
} from '../src/agent/system-cache.js'

// ── 工具集（固定，与 session 长度无关；模拟真实 20 个工具的 schema） ──
const FIXED_TOOLS: unknown[] = Array.from({ length: 20 }, (_, i) => ({
  type: 'function',
  function: {
    name: `tool_${String(i).padStart(2, '0')}`,
    description: `第 ${i + 1} 个工具：执行与任务相关的操作并把结果写回。`.repeat(3),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标路径' },
        detail: { type: 'string', description: '详细说明' },
        offset: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['path'],
    },
  },
}))

// ── 典型 stableArgsHash 输入 ──
const TYPICAL_ARGS = {
  path: 'src/module_17.ts',
  detail: '修复 lint 错误并补充单元测试，确保不破坏既有行为',
  offset: 0,
  limit: 200,
}
const OUTCOME_SLICE_2000 = 'D'.repeat(2000)

// ── 场景构造 ──
function makeFreshShort(): LLMMessage[] {
  return [
    { role: 'system', content: '你是一个文件操作助手，只做用户要求的改动。'.repeat(20) },
    { role: 'user', content: '读取 src/a.ts 并总结前 100 行' },
    {
      role: 'assistant',
      content: '好的，我来读取文件。',
      tool_calls: [{
        id: 'call_0', type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/a.ts', limit: 100 }) },
      }],
    },
    { role: 'tool', tool_call_id: 'call_0', content: JSON.stringify({ ok: true, data: 'A'.repeat(120) }) },
    { role: 'assistant', content: '文件已读取，共 120 字符，没有异常。' },
    { role: 'user', content: '继续' },
  ]
}

function makeLongSession(): LLMMessage[] {
  const msgs: LLMMessage[] = [
    { role: 'system', content: '你是一名资深软件工程师，负责在天枢项目里闭环开发任务。'.repeat(60) },
  ]
  const TURNS = 2026
  for (let i = 0; i < TURNS; i++) {
    const name = i % 3 === 0 ? 'read_file' : i % 3 === 1 ? 'exec_command' : 'edit_file'
    msgs.push({
      role: 'assistant',
      content: `第 ${i + 1} 轮：检查问题并继续推进。`,
      tool_calls: [{
        id: `call_${i}`, type: 'function',
        function: {
          name,
          arguments: JSON.stringify({ path: `src/module_${i % 50}.ts`, offset: i, limit: 200 }),
        },
      }],
    })
    msgs.push({
      role: 'tool',
      tool_call_id: `call_${i}`,
      content: JSON.stringify({ ok: true, data: 'R'.repeat(300) }),
    })
  }
  return msgs
}

function makeCompacted(): LLMMessage[] {
  const msgs: LLMMessage[] = [
    { role: 'system', content: '你是一名资深软件工程师，负责在天枢项目里闭环开发任务。'.repeat(60) },
    { role: 'user', content: '[上下文压缩摘要] 已完成 P0-1～P1-2 六项优化，剩余 P1-3 待测量。'.repeat(80) },
    { role: 'assistant', content: '压缩完成，以下为保留的最近对话。' },
  ]
  for (let i = 0; i < 12; i++) {
    msgs.push({
      role: 'assistant',
      content: `最近轮 ${i + 1}：继续处理。`,
      tool_calls: [{
        id: `recent_${i}`, type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: `src/recent_${i}.ts`, limit: 200 }) },
      }],
    })
    msgs.push({
      role: 'tool',
      tool_call_id: `recent_${i}`,
      content: JSON.stringify({ ok: true, data: 'C'.repeat(300) }),
    })
  }
  return msgs
}

function makeSubagentInject(base: LLMMessage[]): LLMMessage[] {
  const msgs = base.map(m => ({ ...m }))
  // P1-2 场景：submit_result 的 updateContent 就地改写一条 assistant 行。
  for (const m of msgs) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      m.content = '该行内容被就地更新（updateContent）。'
      break
    }
  }
  // 追加 continueSubAgentWithMessage 调用与子代理回注结果。
  msgs.push({
    role: 'assistant',
    content: '等待子代理完成后继续。',
    tool_calls: [{
      id: 'call_sub', type: 'function',
      function: {
        name: 'continueSubAgentWithMessage',
        arguments: JSON.stringify({ call_id: 'call_sub', message: '阅读并总结 src/analyze.ts' }),
      },
    }],
  })
  msgs.push({
    role: 'tool',
    tool_call_id: 'call_sub',
    content: JSON.stringify({ ok: true, summary: '已完成阅读与总结，结论：无需改动。'.repeat(20) }),
  })
  return msgs
}

// ── 计时工具 ──
let sink = 0 // 挡住 V8 对纯函数的死代码消除

function timeN(fn: () => void, n: number): number {
  for (let i = 0; i < Math.min(50, n); i++) fn()
  const start = process.hrtime.bigint()
  for (let i = 0; i < n; i++) fn()
  const end = process.hrtime.bigint()
  return Number(end - start) / 1e6 / n // ms/次
}

function fmtUs(ms: number): string {
  return ms < 0.01 ? `${(ms * 1000).toFixed(1)}µs` : `${ms.toFixed(3)}ms`
}

interface ScenarioResult {
  label: string
  nMsgs: number
  tok: number
  estMs: number
  shapeMs: number
  cmpMs: number
  argsHashMs: number
  outcomeHashMs: number
}

function measureScenario(
  label: string,
  mk: () => LLMMessage[],
): ScenarioResult {
  const msgs = mk()
  const tok = estimateTokens(msgs)
  const big = msgs.length > 500 // 长短场景用不同迭代数控制总时长
  const nEst = big ? 300 : 2000
  const nShape = big ? 300 : 1000
  const nHash = 5000

  const estMs = timeN(() => { sink += estimateTokens(msgs) }, nEst)
  const shape = capturePrefixShape(msgs, FIXED_TOOLS)
  const shapeMs = timeN(() => { sink += capturePrefixShape(msgs, FIXED_TOOLS).historyHash.length }, nShape)
  // 真实轮间差异 = 追加一条消息：compareShapes 走 append-only 扫描全量历史项。
  const shapeCur: PrefixShape = {
    systemHash: shape.systemHash,
    toolsHash: shape.toolsHash,
    historyHash: 'x' + shape.historyHash,
    historyItems: [...shape.historyItems, 'user:h'],
    historyIndexes: [...shape.historyIndexes, shape.historyIndexes.length],
  }
  const cmpMs = timeN(() => { sink += compareShapes(shape, shapeCur).length }, nShape)
  const argsHashMs = timeN(() => { sink += stableArgsHash(TYPICAL_ARGS).length }, nHash)
  const outcomeHashMs = timeN(() => { sink += stableArgsHash(OUTCOME_SLICE_2000).length }, nHash)

  const perTurnTypical = estMs * 3.2 + (shapeMs + cmpMs) + argsHashMs * 4 + outcomeHashMs * 4
  const perTurnSnip = estMs * 5.2 + (shapeMs + cmpMs) + argsHashMs * 4 + outcomeHashMs * 4

  console.log(`\n■ ${label}：${msgs.length} 条消息，estimateTokens ≈ ${tok.toLocaleString()} tok`)
  console.log(`  单次调用：estimateTokens ${fmtUs(estMs)} | capturePrefixShape ${fmtUs(shapeMs)} | compareShapes ${fmtUs(cmpMs)} | stableArgsHash(参数) ${fmtUs(argsHashMs)} | stableArgsHash(结果 2k) ${fmtUs(outcomeHashMs)}`)
  console.log(`  每轮合计（典型，3.2×est + 2×shape + 8×hash）：${perTurnTypical.toFixed(3)} ms`)
  console.log(`  每轮合计（snip 触发，5.2×est）：${perTurnSnip.toFixed(3)} ms`)
  console.log(`  占整轮比例（典型；参考 5s LLM 往返）：${(perTurnTypical / 5000 * 100).toFixed(3)}%  | 悲观口径（参考 1s）：${(perTurnTypical / 1000 * 100).toFixed(3)}%`)

  return { label, nMsgs: msgs.length, tok, estMs, shapeMs, cmpMs, argsHashMs, outcomeHashMs }
}

try {
  console.log('P1-3 CPU 增量缓存测量（estimateTokens / capturePrefixShape / compareShapes / stableArgsHash）')
  console.log('工具 schema 固定 20 个；stableArgsHash 参数 ~150 字符、结果分片 2000 字符。')

  const results: ScenarioResult[] = []
  results.push(measureScenario('fresh-short', makeFreshShort))
  results.push(measureScenario('long-160k', makeLongSession))
  results.push(measureScenario('compact-after', makeCompacted))
  results.push(measureScenario('subagent-inject', () => makeSubagentInject(makeLongSession())))

  console.log('\n── 汇总（单次调用，µs/ms） ──')
  for (const r of results) {
    console.log(`  ${r.label.padEnd(15)} msgs=${String(r.nMsgs).padStart(5)} tok=${String(r.tok).padStart(6)}  est=${fmtUs(r.estMs).padStart(10)} shape=${fmtUs(r.shapeMs).padStart(10)} cmp=${fmtUs(r.cmpMs).padStart(10)} hash(参数)=${fmtUs(r.argsHashMs).padStart(10)} hash(结果)=${fmtUs(r.outcomeHashMs).padStart(10)}`)
  }
  console.log(`\nsink=${sink}（防优化哨兵）`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
}