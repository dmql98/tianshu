#!/usr/bin/env python3
# P1-2 方案 B：send_message_to_subagent 改为同步 barrier（对齐 delegate_to_agent），
# 删除 wakeParentSession 整套 sub_agent_callback wake 机制。
#
# 用法：python p12-apply-barrier.py
# 行尾策略：
#   control-router.ts    = 标准 CRLF (\r\n)：归一化 LF 后替换，写回 CRLF
#   control-registry.ts  = 双重 CRLF (\r\r\n)：归一化 LF 后替换，写回 \r\r\n
import io
import sys

def load_lf(path, line_end):
    with open(path, encoding='utf-8', newline='') as f:
        raw = f.read()
    return raw.replace(line_end, '\n'), line_end

def save_lf(path, text, line_end):
    out = text.replace('\n', line_end)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(out)

def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        print(f'FAIL [{label}]: expected 1 occurrence, found {n}')
        sys.exit(1)
    return text.replace(old, new)

ok = True

# ── 1. control-router.ts ──────────────────────────────────────────────
P1 = 'web/server/src/agent/loop/control-router.ts'
t1, le1 = load_lf(P1, '\r\n')

# 1a. 删除 wake 专用的 imports（runStore/createResumedRun/run-event-store/session-runner/sessionLoop）
t1 = replace_once(t1, """import { runStore } from '../runtime/run-store.js'
import { createResumedRun } from '../runtime/run-resume-service.js'
import { createDurableStream, createNoopBroadcastChannel, publishRunEvent } from '../runtime/run-event-store.js'
import { enqueueRun, isUserCancelled } from '../session-runner.js'
import { sessionLoop } from '../outer.js'
""", "", 'router-imports')

# 1b. 删除 WAKE_TERMINAL + wakeParentSession（含注释）
t1 = replace_once(t1, """const WAKE_TERMINAL = new Set([
  'completed', 'failed', 'cancelled', 'max_turns', 'budget_exhausted', 'interrupted',
])

/**
 * P3 补充：子代理结果回注后，唤醒父会话续跑一轮，让父 LLM 真正「看到」结果并
 * 整理成最终回复（对齐 dsh continuable / opencode session.background 的用户体验）。
 *
 * 唤醒 run 走 run-coordinator 按会话串行队列：
 * - 父会话空闲 → 立即执行；
 * - 父会话正在跑（用户新消息 / 长任务）→ 唤醒 run 自动排队，父 run 结束后
 *   由 coordinator 自动跟进执行（「子完成 → 排队 → 父跑完自动处理子结果」）。
 *
 * 防重复：同会话已有未终态的 sub_agent_callback 续跑（含排队中）则跳过。
 *
 * 续跑走 createResumedRun + sessionLoop 标准路径，通过 systemAlerts 注入系统提示
 * （compose 尾部 user 消息，不污染对话历史）。
 */
function wakeParentSession(input: {
  parentSessionId: string
  parentRunId: string
  targetCharacterId: string
  broadcaster: TransportBroadcaster
}): void {
  const { parentSessionId, parentRunId, targetCharacterId, broadcaster } = input
  try {
    // 用户已取消父会话（或父被级联取消）→ 不回注后自动唤醒，避免「我停了又把我拉起来」。
    if (isUserCancelled(parentSessionId)) return
    const pendingWake = runStore.listForSession(parentSessionId, 10)
      .find(r => r.resume_trigger === 'sub_agent_callback' && !WAKE_TERMINAL.has(r.status))
    if (pendingWake) return

    const resumed = createResumedRun({
      previousRunId: parentRunId,
      trigger: 'sub_agent_callback',
      instruction: '',
      createUserTurn: false,
    })
    const rawStream = createNoopBroadcastChannel(`sub-agent-wake-${resumed.run.id}`)
    publishRunEvent(rawStream, resumed.run.id, 'run.queued', {
      session_id: resumed.session.id,
      run_id: resumed.run.id,
      character_id: resumed.run.character_id,
      character_revision_id: resumed.run.character_revision_id,
      resumed_from_run_id: parentRunId,
      trigger: 'sub_agent_callback',
    })
    const durableStream = createDurableStream(rawStream, resumed.run.id)
    const wakeAlert = `[System] 本会话并行委托的子代理任务已全部结束（成功或失败），结果已分别回注到上方的 delegate_to_agent 工具消息。请逐一查看：\\n` +
      `- 全部成功：合并整理成完整答复（简报/总结/结论）输出给用户。\\n` +
      `- 部分失败（有卡片标记为 failed）：由你判断处理策略——若失败任务重要且可重试，可立即重新 delegate 一个子代理重试；若可接受部分结果或重试无意义，请向用户如实说明哪些成功、哪些失败及原因，必要时用 ask_user 询问用户是否继续。\\n` +
      `不要再输出「等待/稍候」之类的占位内容。`
    enqueueRun(resumed.session.id, resumed.run.id, async signal => {
      try {
        await sessionLoop(broadcaster, durableStream, resumed.session.id, signal, {
          run_id: resumed.run.id,
          systemAlerts: [wakeAlert],
        })
      } catch (error: any) {
        publishRunEvent(rawStream, resumed.run.id, 'run.failed', {
          session_id: resumed.session.id,
          run_id: resumed.run.id,
          error: error?.message || String(error),
        })
      }
    }, () => {
      publishRunEvent(rawStream, resumed.run.id, 'run.cancelled', {
        session_id: resumed.session.id,
        run_id: resumed.run.id,
        status: 'cancelled',
        reason: 'queue_cleared',
      })
    })
  } catch (err: any) {
    // 唤醒失败绝不能影响回注本身（回注在调用本函数前已完成）。
    console.warn(`[sub-agent] wake parent session ${parentSessionId} failed: ${err?.message || err}`)
  }
}

""", "", 'router-wake-fn')

# 1c. JSDoc 更新
t1 = replace_once(t1, """/**
 * P4: send_message_to_subagent — 给本会话已有的子会话续跑一个新 turn。
 * 与 delegate 同构的 fire-and-forget：立即回「已派发」，子会话跑完回注到
 * 本条 send_message 工具消息（同一条消息 running → success/error），
 * 完成后唤醒父会话整理结果。
 */""", """/**
 * P4: send_message_to_subagent — 给本会话已有的子会话续跑一个新 turn。
 * P1-2 同步 barrier（与 delegate_to_agent 同构）：父 Run 在本轮等待子会话
 * 续跑完成，完成后回注结果到工具消息，父 LLM 下一轮直接看到结果；
 * 不再 fire-and-forget + wake 新 Run（wakeParentSession 已删除，P1-2）。
 */""", 'router-jsdoc')

# 1d. 主体：fire-and-forget .then/.catch → await barrier
t1 = replace_once(t1, """  try {
    const dispatched = `[Sub-agent "${req.sub_session_id}" message dispatched] 新指令已进入该子会话执行队列，完成后将自动回传结果到本消息。`
    toolMessage = { role: 'tool', content: JSON.stringify({ output: dispatched }), tool_call_id: toolCallId }
    const parentMsg = messageStore.addMessage(session.id, {
      role: 'tool',
      content: JSON.stringify({ output: dispatched }),
      tool_name: 'send_message_to_subagent',
      tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
      tool_output: dispatched,
      tool_status: 'running',
    })
    stream?.emit('tool.started', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'send_message_to_subagent', tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
    })

    // fire-and-forget：续跑入队子会话 run-coordinator（自动串行），完成后回注。
    void continueSubAgentWithMessage({
      subSessionId: req.sub_session_id,
      message: req.message,
      parentRunId: runId,
      provider,
      model,
      strategyOverride: req.sub_strategy,
      broadcaster,
      stream,
    }).then(subResult => {
      const summary = summarizeAndMerge([subResult])
      // P4 体验补强：回注内容开头带上子会话 ID（放最前，避免被长结果截断掉），
      // 父 LLM 之后可凭它直接调 send_message_to_subagent 继续追问，无需用户复制。
      const subSessionLine = subResult.sub_session_id ? `Sub-session: ${subResult.sub_session_id}\\n\\n` : ''
      const summaryContent = `[Sub-agent "${subResult.agent_id}" message completed]\\n\\n${subSessionLine}Summary: ${summary.summary}\\n\\nConclusions:\\n${summary.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\\n')}`
      if (parentMsg && parentMsg.id != null) {
        messageStore.updateContent(parentMsg.id, JSON.stringify({ output: summaryContent }))
        messageStore.updateToolOutput(parentMsg.id, summaryContent)
        messageStore.updateToolStatus(parentMsg.id, 'success')
      }
      stream?.emit('tool.completed', {
        session_id: session.id, run_id: runId, tool_call_id: toolCallId,
        tool_name: 'send_message_to_subagent', tool_output: summaryContent,
        tool_status: 'success', duration_ms: 0,
      })
      stream?.emit('sub_agent.completed', {
        session_id: session.id, run_id: runId,
        sub_session_id: subResult.sub_session_id ?? null,
        target_character_id: subResult.agent_id,
        task: req.message,
        summary: summaryContent,
      })
      // 注入：唤醒父会话续跑，让父 LLM 把续跑结果整理成最终回复。
      wakeParentSession({
        parentSessionId: session.id,
        parentRunId: runId,
        targetCharacterId: subResult.agent_id,
        broadcaster,
      })
    }).catch((err: any) => {
      const errMsg = `Sub-agent message failed: ${err?.message || err}`
      if (parentMsg && parentMsg.id != null) {
        messageStore.updateContent(parentMsg.id, JSON.stringify({ error: errMsg }))
        messageStore.updateToolOutput(parentMsg.id, errMsg)
        messageStore.updateToolStatus(parentMsg.id, 'error')
      }
      stream?.emit('tool.completed', {
        session_id: session.id, run_id: runId, tool_call_id: toolCallId,
        tool_name: 'send_message_to_subagent', tool_output: errMsg,
        tool_status: 'error', duration_ms: 0,
      })
      wakeParentSession({
        parentSessionId: session.id,
        parentRunId: runId,
        targetCharacterId: req.sub_session_id,
        broadcaster,
      })
    })
  } catch (err: any) {
    const errMsg = `Sub-agent message failed: ${err.message || err}`
    toolMessage = { role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: toolCallId }
    messageStore.addMessage(session.id, {
      role: 'tool', content: JSON.stringify({ error: errMsg }),
      tool_name: 'send_message_to_subagent', tool_input: JSON.stringify({}),
      tool_output: errMsg, tool_status: 'error',
    })
    stream?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'send_message_to_subagent', tool_output: errMsg,
      tool_status: 'error', duration_ms: 0,
    })
  }
  return { kind: 'continue', messages: [toolMessage] }""", """  try {
    stream?.emit('tool.started', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'send_message_to_subagent', tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
    })

    // P1-2 同步 barrier：与 delegate_to_agent 同构——父 Run 在本轮等待子会话
    // 续跑完成（续跑入队子会话自己的 run-coordinator，自动串行），完成后
    // 回注工具结果，父 LLM 下一轮直接看到结果，不再需要 wake 新 Run。
    const subResult = await continueSubAgentWithMessage({
      subSessionId: req.sub_session_id,
      message: req.message,
      parentRunId: runId,
      provider,
      model,
      strategyOverride: req.sub_strategy,
      broadcaster,
      stream,
    })
    const summary = summarizeAndMerge([subResult])
    // P4 体验补强：回注内容开头带上子会话 ID（放最前，避免被长结果截断掉），
    // 父 LLM 之后可凭它直接调 send_message_to_subagent 继续追问，无需用户复制。
    const subSessionLine = subResult.sub_session_id ? `Sub-session: ${subResult.sub_session_id}\\n\\n` : ''
    const summaryContent = `[Sub-agent "${subResult.agent_id}" message completed]\\n\\n${subSessionLine}Summary: ${summary.summary}\\n\\nConclusions:\\n${summary.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\\n')}`
    toolMessage = { role: 'tool', content: JSON.stringify({ output: summaryContent }), tool_call_id: toolCallId }
    messageStore.addMessage(session.id, {
      role: 'tool',
      content: JSON.stringify({ output: summaryContent }),
      tool_name: 'send_message_to_subagent',
      tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
      tool_output: summaryContent,
      tool_status: 'success',
    })
    stream?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'send_message_to_subagent', tool_output: summaryContent,
      tool_status: 'success', duration_ms: 0,
    })
    stream?.emit('sub_agent.completed', {
      session_id: session.id, run_id: runId,
      sub_session_id: subResult.sub_session_id ?? null,
      target_character_id: subResult.agent_id,
      task: req.message,
      summary: summaryContent,
    })
  } catch (err: any) {
    const errMsg = `Sub-agent message failed: ${err?.message || String(err)}`
    toolMessage = { role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: toolCallId }
    messageStore.addMessage(session.id, {
      role: 'tool', content: JSON.stringify({ error: errMsg }),
      tool_name: 'send_message_to_subagent', tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
      tool_output: errMsg, tool_status: 'error',
    })
    stream?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'send_message_to_subagent', tool_output: errMsg,
      tool_status: 'error', duration_ms: 0,
    })
  }
  return { kind: 'continue', messages: [toolMessage] }""", 'router-body')

save_lf(P1, t1, '\r\n')
print('control-router.ts OK')

# ── 2. control-registry.ts（双重 CRLF \r\r\n）─────────────────────────
P2 = 'web/server/src/agent/loop/control-registry.ts'
t2, le2 = load_lf(P2, '\r\r\n')
t2 = replace_once(t2, """description: '给本会话已有的子 agent 续跑新轮（先 delegate_to_agent 建会话）；sub_session_id 照抄 "Sub-session: " 后的完整 ID。',""", """description: '给本会话已有的子 agent 续跑新轮（先 delegate_to_agent 建会话，执行完成后才返回结果）；sub_session_id 照抄 "Sub-session: " 后的完整 ID。',""", 'registry-desc')
save_lf(P2, t2, '\r\r\n')
print('control-registry.ts OK')

print('ALL OK')