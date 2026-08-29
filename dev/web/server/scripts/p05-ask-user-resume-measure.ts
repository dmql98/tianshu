/**
 * P0-3 项 5 前置测量：ask_user resume 的成本量化
 *
 * 问题：ask_user 后用户回答经 POST /runs/:id/inputs 走 createResumedRun →
 * 新 Run 从 DB 全量 buildInitialMessages 重建上下文。层次 1 设想：ask_user 时
 * 把内存态 messages 存 checkpoint，resume 直接读回，跳过全量重建。
 *
 * 本脚本用【真实】buildInitialMessages / composeMessages / capturePrefixShape /
 * compareShapes / messageStore，模拟 ask_user → 回答 → resume 的完整路径，回答：
 *   1. resume 后上下文相对旧 Run 结束时上下文是否纯 append-only（provider 前缀
 *      缓存能否命中）？——决定 resume 的 LLM 侧成本。
 *   2. 跨 Run 全量重建耗时（真实代价）vs 层次 1（序列化存/读 messages）耗时。
 *   3. 大会话（~150 轮）是否线性放大重建成本；@file 引用在 P0-1 memo 下第二次
 *      重建是否显著变快（反映真实同一进程内 resume）。
 *
 * 运行：cd web/server && node node_modules/tsx/dist/cli.mjs scripts/p05-ask-user-resume-measure.ts
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
process.env.TIANSHU_DATA_DIR = mkdtempSync(join(tmpdir(), 'tianshu-p05-'))

const { getDb } = await import('../src/db/schema.js')
const { sessionStore } = await import('../src/db/sessionStore.js')
const { messageStore } = await import('../src/db/messageStore.js')
const { buildInitialMessages } = await import('../src/agent/loop/context-builder.js')
const { composeMessages } = await import('../src/agent/compose.js')
const { capturePrefixShape, compareShapes } = await import('../src/agent/system-cache.js')

interface ToolDef { type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }
// 与旧 Run 一致的 tools 清单（capturePrefixShape 需要 tools 计算 toolsHash）。
const TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'read', description: 'Read a file from the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'bash', description: 'Execute a shell command in the workspace.', parameters: { type: 'object', properties: { command: { type: 'string' } } } } },
  { type: 'function', function: { name: 'submit_result', description: '提交最终结果。', parameters: { type: 'object', properties: { summary: { type: 'string' } } } } },
]

const SYSTEM_PROMPT = [
  '## Character\n你是一名严谨的执行助手。',
  '## Available Skill Packages\n- software-engineering（软件工程）',
]

interface LLMMessage { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }

function seedSession(sessionId: string, toolRounds: number): string {
  getDb().prepare('PRAGMA foreign_keys = ON').run()
  sessionStore.create({ id: sessionId, character_id: 'general' })
  // 首条用户消息带 @file 引用（触发 expandContextReferences；文件用 scripts 自身）。
  messageStore.addMessage(sessionId, {
    role: 'user',
    content: `请分析这个脚本：@file:${join('scripts', 'p05-ask-user-resume-measure.ts')}`,
  })
  for (let r = 0; r < toolRounds; r++) {
    const callId = `call_${r}`
    messageStore.addMessage(sessionId, {
      role: 'assistant',
      content: `第 ${r} 轮我想先读一下再决定（round ${r}）。`,
      tool_input: JSON.stringify([{ id: callId, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: `a${r}.txt` }) } }]),
    })
    messageStore.addMessage(sessionId, {
      role: 'tool',
      content: JSON.stringify({ output: `lines_${r}_${'x'.repeat(Math.min(r, 200))}`, error: '' }),
      tool_name: 'read',
      tool_input: JSON.stringify({ call_id: callId, args: { path: `a${r}.txt` } }),
      tool_output: `lines_${r}_${'x'.repeat(Math.min(r, 200))}`,
      tool_status: 'success',
    })
  }
  // ask_user：assistant 调用 + handleAskUser 落库形态的 tool 结果。
  messageStore.addMessage(sessionId, {
    role: 'assistant',
    content: '我需要向用户确认一下。',
    tool_input: JSON.stringify([{ id: 'ask_1', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ question: '方案 A 还是 B？' }) } }]),
  })
  messageStore.addMessage(sessionId, {
    role: 'tool',
    content: JSON.stringify({ output: '[asked user] 方案 A 还是 B？' }),
    tool_name: 'ask_user',
    tool_input: JSON.stringify({ call_id: 'ask_1' }),
    tool_output: '[asked user] 方案 A 还是 B？',
    tool_status: 'success',
  })
  return sessionId
}

async function measure(label: string, toolRounds: number): Promise<void> {
  const sessionId = `sess_${label.replace(/[^a-z0-9]/gi, '')}`
  seedSession(sessionId, toolRounds)
  const rows = messageStore.getMessagesAfter(sessionId, 0, 100000)
  const base = {
    characterId: sessionId,
    systemPrompt: SYSTEM_PROMPT,
    memory: null,
    compactionSummary: null,
    compactionUntilId: 0,
    trimmedUntilId: 0,
    providerBaseUrl: 'https://example.invalid/v1',
    cap: { supportsVision: false, supportsFiles: false },
    workspace: process.cwd(),
    activeSkills: [],
  }

  // 旧 Run 结束：内存态 messages（真实全量构建一次 = 旧 Run 本身也是这样做）。
  const t0 = performance.now()
  const oldMsgs = await buildInitialMessages({ ...base, rows })
  const tOldBuild = performance.now() - t0
  const composedOld = composeMessages(oldMsgs, {})
  const shapeOld = capturePrefixShape(composedOld, TOOLS as never)

  // 用户回答落库（runs.ts：createUserTurn 写入的 instruction 消息）。
  messageStore.addMessage(sessionId, {
    role: 'user',
    content: '用户回答了之前的问题（问题：方案 A 还是 B？）：\n选 A，继续。',
  })

  // resume：真实路径 = 再次全量 buildInitialMessages（含 P0-1 memo 命中效果）。
  const rows2 = messageStore.getMessagesAfter(sessionId, 0, 100000)
  const t1 = performance.now()
  const newMsgs = await buildInitialMessages({ ...base, rows: rows2 })
  const tRebuild = performance.now() - t1
  const composedNew = composeMessages(newMsgs, {})
  const shapeNew = capturePrefixShape(composedNew, TOOLS as never)
  const diffs = compareShapes(shapeOld, shapeNew)
  const firstDiff = shapeNew.historyItems.findIndex((it, i) => shapeOld.historyItems[i] !== it)
  const prefixShare = firstDiff < 0 ? 1 : firstDiff / shapeNew.historyItems.length

  // 层次 1 对(std)：序列化 内存态 oldMsgs + 追加回答，parse 读回。
  const serializable = [...oldMsgs, { role: 'user', content: '用户回答了之前的问题：\n选 A，继续。' }] as LLMMessage[]
  const t2 = performance.now()
  const json = JSON.stringify(serializable)
  const tSerialize = performance.now() - t2
  const t3 = performance.now()
  JSON.parse(json) as unknown
  const tParse = performance.now() - t3

  const approxTok = (msgs: unknown[]): number => msgs.reduce((a, m: any) => a + Math.ceil(((m.content || '') as string).length / 2) + 16, 0)

  console.log(`\n■ ${label}（toolRounds=${toolRounds}，DB 消息 ${rows2.length} 条）`)
  console.log(`  旧 Run 结束上下文：${oldMsgs.length} 条消息，≈${approxTok(oldMsgs)} tok`)
  console.log(`  前缀一致性（resume vs 旧 Run）：${diffs.length === 0 ? '纯 append-only ✅ provider 前缀缓存可命中' : `BREAK（${diffs.join('; ')}）`}`)
  if (firstDiff >= 0) console.log(`    首个不一致位置：消息 #${firstDiff}（可复用前缀 ${(prefixShare * 100).toFixed(1)}%）`)
  console.log(`  全量重建耗时（真实 resume）：${tRebuild.toFixed(1)} ms`)
  console.log(`    其中旧 Run 首次构建：${tOldBuild.toFixed(1)} ms（P0-1 memo：@file 第二次命中 → 本项更小）`)
  console.log(`  层次 1 序列化/读回耗时：stringify ${tSerialize.toFixed(2)} ms + parse ${tParse.toFixed(2)} ms（checkpoint 大小 ${(json.length / 1024).toFixed(1)} KB）`)
  const saved = tRebuild - (tSerialize + tParse)
  console.log(`  层次 1 相对全量重建节省：${saved >= 0 ? saved.toFixed(1) : (saved * -1).toFixed(0)} ms（${saved >= 0 ? (saved / tRebuild * 100).toFixed(0) : '—'}%）`)
}

try {
  console.log('P0-3 项 5 前置测量：ask_user resume 成本（真实 buildInitialMessages / compose / shape）')
  await measure('small', 10)
  await measure('medium', 50)
  await measure('large', 150)
} finally {
  try { rmSync(process.env.TIANSHU_DATA_DIR!, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* Windows 偶发占用 */ }
}