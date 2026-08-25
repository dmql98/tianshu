import type { TransportBroadcaster } from '../../transport/runtime.js'
import { messageStore } from '../../db/messageStore.js'
import { sessionStore } from '../../db/sessionStore.js'
import { spawnAndRunSubAgents, summarizeAndMerge, continueSubAgentWithMessage } from '../sub-agent.js'
import { disconnectMCPServer } from '../../tools/mcp-client.js'
import type { MCPClient } from '../../tools/mcp-client.js'
import type { LLMMessage, ProviderConfig } from '../../llm/client.js'
import type { InnerResult, SubAgentMessageRequestData, SubAgentBatchItem } from '../inner.js'
import { checkpointStore } from '../runtime/checkpoint-store.js'
import { planStore, goalStore } from '../plan/plan-store.js'
import { evaluateSubmission, type SubmissionCheckResult } from './completion-evaluator.js'
import { runStore } from '../runtime/run-store.js'
import { createResumedRun } from '../runtime/run-resume-service.js'
import { createDurableStream, createNoopBroadcastChannel, publishRunEvent } from '../runtime/run-event-store.js'
import { enqueueRun, isUserCancelled } from '../session-runner.js'
import { sessionLoop } from '../outer.js'
import type { SpawnOutcome } from '../sub-agent.js'

/**
 * Control router: handles the protocol-level outcomes of a model turn
 * (sub-agent delegation, task completion). Migrated from agent/outer.ts.
 */

export interface SubAgentOutcome {
  kind: 'continue'
  messages: LLMMessage[]
}

const WAKE_TERMINAL = new Set([
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
    const wakeAlert = `[System] 本会话并行委托的子代理任务已全部结束（成功或失败），结果已分别回注到上方的 delegate_to_agent 工具消息。请逐一查看：\n` +
      `- 全部成功：合并整理成完整答复（简报/总结/结论）输出给用户。\n` +
      `- 部分失败（有卡片标记为 failed）：由你判断处理策略——若失败任务重要且可重试，可立即重新 delegate 一个子代理重试；若可接受部分结果或重试无意义，请向用户如实说明哪些成功、哪些失败及原因，必要时用 ask_user 询问用户是否继续。\n` +
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

export async function handleSubAgentBatchRequest(input: {
  batch: SubAgentBatchItem[]
  result: InnerResult
  session: { id: string; character_id: string; parent_id?: string | null; provider_id?: string | null; workspace?: string | null; workspaces?: string | null; active_group?: string | null; targets?: string | null; current_strategy?: string | null; approval_mode?: string | null }
  provider: ProviderConfig
  model: string
  broadcaster: TransportBroadcaster
  stream: TransportBroadcaster
  runId: string
}): Promise<SubAgentOutcome> {
  const { batch, result, session, provider, model, broadcaster, stream, runId } = input
  const toolMessages: LLMMessage[] = []

  // Only top-level sessions may delegate: grandchildren are structurally
  // impossible even if a model fabricates the control call.
  if (session.parent_id) {
    const errMsg = 'Child agents cannot delegate another agent'
    for (const item of batch) {
      toolMessages.push({ role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: item.toolCallId })
      messageStore.addMessage(session.id, {
        role: 'tool', content: JSON.stringify({ error: errMsg }),
        tool_name: 'delegate_to_agent', tool_input: JSON.stringify({}),
        tool_output: errMsg, tool_status: 'error',
      })
      stream?.emit('tool.completed', {
        session_id: session.id, run_id: runId, tool_call_id: item.toolCallId,
        tool_name: 'delegate_to_agent', tool_output: errMsg,
        tool_status: 'error', duration_ms: 0,
      })
    }
    return { kind: 'continue', messages: toolMessages }
  }

  // P5 同步 barrier：逐个 emit tool.started（前端先出 N 张「执行中」卡片），
  // 然后并行拉起所有子会话（成功/失败都收集），全部完成后 emit tool.completed +
  // 落库 tool 结果，父 run 恢复循环 → 父 LLM 看到全部结果再继续回复。
  for (const item of batch) {
    stream?.emit('tool.started', {
      session_id: session.id, run_id: runId, tool_call_id: item.toolCallId,
      tool_name: 'delegate_to_agent', tool_input: JSON.stringify({ call_id: item.toolCallId, args: item.data }),
    })
  }

  const outcomes = await Promise.all(batch.map(item =>
    spawnAndRunSubAgents({
      task: item.data.task,
      targetCharacterId: item.data.target_character_id,
      parentSession: session,
      provider,
      model,
      strategyOverride: item.data.sub_strategy,
      broadcaster,
      stream,
      runId,
    }).then((outcome): { item: SubAgentBatchItem; outcome: SpawnOutcome } => ({ item, outcome })),
  ))

  for (const { item, outcome } of outcomes) {
    const ok = !outcome.error && !!outcome.subResult
    const subResult = outcome.subResult
    const finalContent = ok && subResult
      ? (() => {
          const summary = summarizeAndMerge([subResult])
          const subSessionLine = subResult.sub_session_id ? `Sub-session: ${subResult.sub_session_id}\n\n` : ''
          return `[Sub-agent "${item.data.target_character_id}" completed]\n\n${subSessionLine}Summary: ${summary.summary}\n\nConclusions:\n${summary.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
        })()
      : `[Sub-agent "${item.data.target_character_id}" failed]\n\nError: ${outcome.error || 'unknown'}${subResult?.sub_session_id ? `\n\nSub-session: ${subResult.sub_session_id}` : ''}`

    // 落库 tool 结果（刷新可见）+ 前端卡片完成事件。
    messageStore.addMessage(session.id, {
      role: 'tool',
      content: JSON.stringify({ output: finalContent }),
      tool_name: 'delegate_to_agent',
      tool_input: JSON.stringify({ call_id: item.toolCallId, args: item.data }),
      tool_output: finalContent,
      tool_status: ok ? 'success' : 'error',
    })
    toolMessages.push({ role: 'tool', content: JSON.stringify({ output: finalContent }), tool_call_id: item.toolCallId })
    stream?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: item.toolCallId,
      tool_name: 'delegate_to_agent', tool_output: finalContent,
      tool_status: ok ? 'success' : 'error', duration_ms: 0,
    })
    stream?.emit('sub_agent.completed', {
      session_id: session.id, run_id: runId,
      sub_session_id: subResult?.sub_session_id ?? null,
      target_character_id: item.data.target_character_id,
      task: item.data.task,
      summary: finalContent,
    })
  }

  return { kind: 'continue', messages: toolMessages }
}

export interface SubAgentMessageOutcome {
  kind: 'continue'
  messages: LLMMessage[]
}

/**
 * P4: send_message_to_subagent — 给本会话已有的子会话续跑一个新 turn。
 * 与 delegate 同构的 fire-and-forget：立即回「已派发」，子会话跑完回注到
 * 本条 send_message 工具消息（同一条消息 running → success/error），
 * 完成后唤醒父会话整理结果。
 */
export async function handleSubAgentMessageRequest(input: {
  req: SubAgentMessageRequestData
  result: InnerResult
  session: { id: string; character_id: string; parent_id?: string | null; provider_id?: string | null; workspace?: string | null; workspaces?: string | null; active_group?: string | null; targets?: string | null; current_strategy?: string | null; approval_mode?: string | null }
  provider: ProviderConfig
  model: string
  broadcaster: TransportBroadcaster
  stream: TransportBroadcaster
  runId: string
}): Promise<SubAgentMessageOutcome> {
  const { req, result, session, provider, model, broadcaster, stream, runId } = input
  const toolCallId = (result.toolCalls?.find(tc => tc.function.name === 'send_message_to_subagent')?.id) || `sendmsg_${Date.now()}`
  let toolMessage: LLMMessage

  // 层级硬控：子会话不能给其他子会话发消息（结构上不可能，防模型伪造）。
  if (session.parent_id) {
    const errMsg = 'Child agents cannot send messages to another sub-agent'
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
    return { kind: 'continue', messages: [toolMessage] }
  }

  try {
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
      const subSessionLine = subResult.sub_session_id ? `Sub-session: ${subResult.sub_session_id}\n\n` : ''
      const summaryContent = `[Sub-agent "${subResult.agent_id}" message completed]\n\n${subSessionLine}Summary: ${summary.summary}\n\nConclusions:\n${summary.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
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
  return { kind: 'continue', messages: [toolMessage] }
}

export interface SubmitResultOutcome {
  kind: 'continue' | 'done'
  messages: LLMMessage[]
  check?: SubmissionCheckResult
  disconnected?: MCPClient[]
  status?: 'task_complete'
  totalInputTokens?: number
  totalOutputTokens?: number
  totalCacheHitTokens?: number
  totalCacheMissTokens?: number
}

export interface AskUserOutcome {
  kind: 'continue'
  messages: LLMMessage[]
}

/**
 * ask_user: persist the question as a checkpoint, surface it to the client,
 * and complete the protocol turn with a tool response so the model loop stays
 * structurally valid. The persisted checkpoint is the resume anchor for a
 * later user answer (resume flow pending — see handoff doc).
 */
export async function handleAskUser(input: {
  question: string
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
  messages: LLMMessage[]
}): Promise<AskUserOutcome> {
  const { question, result, sessionId, runId, stream, messages } = input
  const askCall = result.toolCalls?.find(tc => tc.function.name === 'ask_user')
  const toolCallId = askCall?.id || `ask_${Date.now()}`
  const content = question || '需要您确认'
  const toolMessage: LLMMessage = {
    role: 'tool',
    content: JSON.stringify({ output: `[asked user] ${content}` }),
    tool_call_id: toolCallId,
  }
  messageStore.addMessage(sessionId, {
    role: 'tool',
    content: JSON.stringify({ output: `[asked user] ${content}` }),
    tool_name: 'ask_user',
    tool_input: JSON.stringify({ call_id: toolCallId }),
    tool_output: `[asked user] ${content}`,
    tool_status: 'success',
  })
  checkpointStore.create(runId, {
    reason: 'ask_user',
    pendingRequest: JSON.stringify({ question: content }),
  })
  stream?.emit('ask_user', { session_id: sessionId, run_id: runId, question: content })
  return { kind: 'continue', messages: [toolMessage] }
}
export interface CreatePlanOutcome {
  kind: 'continue'
  messages: LLMMessage[]
  planCreated: boolean
  planId?: string
}

export interface UpdatePlanStepOutcome {
  kind: 'continue'
  messages: LLMMessage[]
  updated: boolean
}

/** Persist a step transition before broadcasting its durable RunEvent. */
export async function handleUpdatePlanStep(input: {
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
}): Promise<UpdatePlanStepOutcome> {
  const { result, sessionId, runId, stream } = input
  const updateCall = result.toolCalls?.find(tc => tc.function.name === 'update_plan_step')
  const toolCallId = updateCall?.id || `plan_step_${Date.now()}`
  const req = result.planStepUpdate
  const activePlan = planStore.getActive(sessionId)
  const step = activePlan && Number.isInteger(req?.ordinal) && (req?.ordinal || 0) > 0
    ? planStore.steps(activePlan.id).find(item => item.ordinal === req!.ordinal)
    : null

  let error: string | null = null
  if (!activePlan) error = 'update_plan_step rejected: no active plan'
  else if (!req || !Number.isInteger(req.ordinal) || req.ordinal < 1) error = 'update_plan_step rejected: ordinal must be a positive integer'
  else if (!step) error = `update_plan_step rejected: step ${req.ordinal} does not belong to the active plan`
  else if (req.status === 'completed' && step.depends_on) {
    const dependency = planStore.steps(activePlan.id).find(item => item.title === step.depends_on)
    if (dependency && dependency.status !== 'completed' && dependency.status !== 'skipped') {
      error = `update_plan_step rejected: dependency "${dependency.title}" is not completed`
    }
  }

  if (error || !activePlan || !step || !req) {
    const message = error || 'update_plan_step rejected'
    const toolMessage: LLMMessage = { role: 'tool', content: JSON.stringify({ error: message }), tool_call_id: toolCallId }
    messageStore.addMessage(sessionId, {
      role: 'tool', content: JSON.stringify({ error: message }), tool_name: 'update_plan_step',
      tool_input: JSON.stringify({ call_id: toolCallId, args: req || {} }), tool_output: message, tool_status: 'error',
    })
    stream?.emit('tool.completed', {
      session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'update_plan_step', tool_output: message, tool_status: 'error', duration_ms: 0,
    })
    return { kind: 'continue', messages: [toolMessage], updated: false }
  }

  const updated = planStore.setStepStatus(step.id, req.status, req.evidence || null)!
  const plan = planStore.get(activePlan.id)!
  const output = `计划步骤 ${updated.ordinal} 已更新为 ${updated.status}${updated.evidence ? `：${updated.evidence}` : ''}`
  const toolMessage: LLMMessage = { role: 'tool', content: JSON.stringify({ output }), tool_call_id: toolCallId }
  messageStore.addMessage(sessionId, {
    role: 'tool', content: JSON.stringify({ output }), tool_name: 'update_plan_step',
    tool_input: JSON.stringify({ call_id: toolCallId, args: req }), tool_output: output, tool_status: 'success',
  })
  stream?.emit('tool.completed', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: 'update_plan_step', tool_output: output, tool_status: 'success', duration_ms: 0,
  })
  stream?.emit('plan.step.updated', {
    session_id: sessionId, run_id: runId, plan_id: activePlan.id,
    plan_status: plan.status, step: updated,
  })
  return { kind: 'continue', messages: [toolMessage], updated: true }
}

/**
 * create_plan: supersede the active plan and persist the new one with its
 * steps. Emits plan.created so clients can render the step list.
 */
export async function handleCreatePlan(input: {
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
  goalId?: string | null
  mode?: 'direct' | 'plan_first' | 'goal'
}): Promise<CreatePlanOutcome> {
  const { result, sessionId, runId, stream, goalId, mode } = input
  const planCall = result.toolCalls?.find(tc => tc.function.name === 'create_plan')
  const toolCallId = planCall?.id || `plan_${Date.now()}`
  const req = result.planRequest
  if (!req || req.steps.length === 0) {
    const errMsg = 'create_plan rejected: steps must be a non-empty array'
    const toolMessage: LLMMessage = { role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: toolCallId }
    messageStore.addMessage(sessionId, {
      role: 'tool', content: JSON.stringify({ error: errMsg }),
      tool_name: 'create_plan', tool_input: JSON.stringify({ call_id: toolCallId }),
      tool_output: errMsg, tool_status: 'error',
    })
    stream?.emit('tool.completed', {
      session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'create_plan', tool_output: errMsg, tool_status: 'error', duration_ms: 0,
    })
    return { kind: 'continue', messages: [toolMessage], planCreated: false }
  }
  planStore.supersedeActive(sessionId)
  // Goal mode: reuse create_plan's goal/verification as the single goal
  // declaration (no separate forced create_goal). Auto-link a goal object so
  // the [Goal] re-anchor, final-answer gate and budget/pause keep working.
  let resolvedGoalId = goalId || null
  if (!resolvedGoalId && mode === 'goal' && req.goal) {
    const created = goalStore.create({
      session_id: sessionId,
      outcome: req.goal,
      verification: req.verification || null,
    })
    resolvedGoalId = created.id
    stream?.emit('goal.created', {
      session_id: sessionId,
      run_id: runId,
      goal_id: created.id,
      status: created.status,
      outcome: created.outcome,
      verification: created.verification,
    })
  }
  const plan = planStore.createPlan({
    session_id: sessionId,
    goal_id: resolvedGoalId,
    steps: req.steps,
  })
  const stepCount = planStore.steps(plan.id).length
  const summary = `已创建计划 v${plan.version}（${stepCount} 步）:\n${req.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}`
  const toolMessage: LLMMessage = { role: 'tool', content: JSON.stringify({ output: summary }), tool_call_id: toolCallId }
  messageStore.addMessage(sessionId, {
    role: 'tool', content: JSON.stringify({ output: summary }),
    tool_name: 'create_plan', tool_input: JSON.stringify({ call_id: toolCallId }),
    tool_output: summary, tool_status: 'success',
  })
  stream?.emit('tool.completed', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: 'create_plan', tool_output: summary, tool_status: 'success', duration_ms: 0,
  })
  stream?.emit('plan.created', {
    session_id: sessionId, run_id: runId, plan_id: plan.id, version: plan.version,
    steps: req.steps.map((s, i) => ({ ordinal: i + 1, title: s.title, status: 'pending' })),
  })
  return { kind: 'continue', messages: [toolMessage], planCreated: true, planId: plan.id }
}

export interface GoalOutcome {
  kind: 'continue'
  messages: LLMMessage[]
}

function goalToolMessage(sessionId: string, runId: string, stream: TransportBroadcaster | undefined, name: string, toolCallId: string, output: string, error?: string): LLMMessage {
  const message: LLMMessage = { role: 'tool', content: JSON.stringify(error ? { output: '', error } : { output }), tool_call_id: toolCallId }
  messageStore.addMessage(sessionId, {
    role: 'tool', content: JSON.stringify(error ? { output: '', error } : { output }),
    tool_name: name, tool_input: JSON.stringify({ call_id: toolCallId }),
    tool_output: output, tool_status: error ? 'error' : 'success',
  })
  stream?.emit('tool.completed', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: name, tool_output: output, tool_status: error ? 'error' : 'success', duration_ms: 0,
  })
  return message
}

/**
 * create_goal: create the session's goal (rejects when an active goal exists).
 * Emits goal.created so clients can render the goal card live.
 */
export function handleCreateGoal(input: {
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
}): GoalOutcome {
  const { result, sessionId, runId, stream } = input
  const goalCall = result.toolCalls?.find(tc => tc.function.name === 'create_goal')
  const toolCallId = goalCall?.id || `goal_${Date.now()}`
  const req = result.goalRequest
  if (!req || !req.outcome) {
    const errMsg = 'create_goal rejected: outcome is required'
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'create_goal', toolCallId, errMsg, errMsg)] }
  }
  const active = goalStore.listForSession(sessionId).find(g => g.status === 'active' || g.status === 'paused')
  if (active) {
    const errMsg = `create_goal rejected: 已有进行中的目标「${active.outcome}」（${active.status}）。先 complete_goal 完成它，或暂停后再创建。`
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'create_goal', toolCallId, errMsg, errMsg)] }
  }
  const goal = goalStore.create({
    session_id: sessionId,
    outcome: req.outcome,
    constraints: req.constraints || null,
    verification: req.verification || null,
    budget_tokens: req.budget_tokens ?? null,
  })
  const summary = `已创建目标：${goal.outcome}${goal.verification ? `\n验证标准：${goal.verification}` : ''}`
  stream?.emit('goal.created', {
    session_id: sessionId, run_id: runId, goal_id: goal.id, status: goal.status,
    outcome: goal.outcome, verification: goal.verification,
  })
  return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'create_goal', toolCallId, summary)] }
}

/** get_goal: report the session's active (or latest) goal state to the model. */
export function handleGetGoal(input: {
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
}): GoalOutcome {
  const { result, sessionId, runId, stream } = input
  const goalCall = result.toolCalls?.find(tc => tc.function.name === 'get_goal')
  const toolCallId = goalCall?.id || `goal_get_${Date.now()}`
  const goals = goalStore.listForSession(sessionId)
  const active = goals.find(g => g.status === 'active' || g.status === 'paused')
  if (!active) {
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'get_goal', toolCallId, '当前会话没有进行中的目标。需要长期目标时用 create_goal 创建。')] }
  }
  const output = `目标：${active.outcome}` +
    (active.constraints ? `\n约束：${active.constraints}` : '') +
    (active.verification ? `\n验证标准：${active.verification}` : '') +
    `\n状态：${active.status}` +
    (active.budget_tokens ? `\n预算：${goalStore.usedTokens(active)} / ${active.budget_tokens} tokens` : '')
  return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'get_goal', toolCallId, output)] }
}

/** complete_goal: mark the active goal completed (idempotent). Emits goal.status.changed. */
export function handleCompleteGoal(input: {
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
}): GoalOutcome {
  const { result, sessionId, runId, stream } = input
  const goalCall = result.toolCalls?.find(tc => tc.function.name === 'complete_goal')
  const toolCallId = goalCall?.id || `goal_done_${Date.now()}`
  // Latest goal (list is created_at DESC). Idempotent when already completed.
  const latest = goalStore.listForSession(sessionId)[0] || null
  if (!latest) {
    const errMsg = 'complete_goal rejected: 当前会话没有进行中的目标'
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'complete_goal', toolCallId, errMsg, errMsg)] }
  }
  if (latest.status === 'completed') {
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'complete_goal', toolCallId, '目标已完成（幂等）')] }
  }
  goalStore.update(latest.id, { status: 'completed' })
  stream?.emit('goal.status.changed', {
    session_id: sessionId, run_id: runId, goal_id: latest.id, status: 'completed',
  })
  const summary = result.goalCompleteSummary ? `\n摘要：${result.goalCompleteSummary}` : ''
  return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, stream, 'complete_goal', toolCallId, `目标已完成：${latest.outcome}${summary}`)] }
}

export interface SubmitResultOutcome {
  kind: 'continue' | 'done'
  messages: LLMMessage[]
  check?: SubmissionCheckResult
  disconnected?: MCPClient[]
}

export async function handleTaskComplete(input: {
  result: InnerResult
  sessionId: string
  runId: string
  stream: TransportBroadcaster
  messages: LLMMessage[]
  mcpClients: Map<string, MCPClient>
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens: number
  totalCacheMissTokens: number
  mode: 'direct' | 'plan_first' | 'goal'
  planCompleted: boolean
  unmetSteps: Array<{ ordinal: number; title: string }>
  goalVerification?: string | null
  goal?: { id: string; status: string } | null
}): Promise<SubmitResultOutcome> {
  const { result, sessionId, runId, stream, messages, mode, goal } = input
  const summaryOutput = result.taskCompleteSummary || ''
  const evidence = result.evidence || []

  // CompletionEvaluator gate: Plan-first requires completed steps; Goal
  // requires concrete evidence against the verification standard.
  const check = evaluateSubmission({
    mode,
    planCompleted: input.planCompleted,
    unmetSteps: input.unmetSteps,
    goalVerification: input.goalVerification,
    summary: summaryOutput,
    evidence,
  })
  const submitCall = result.toolCalls?.find(tc => tc.function.name === 'submit_result')
  const toolCallId = submitCall?.id || `complete_${Date.now()}`
  // inner.ts no longer emits tool.started for submit_result (it is a control
  // action, not a real tool), so the loop owns its tool lifecycle here: announce
  // it so the client renders a submit card with a consistent running→completed
  // transition instead of a leftover "running"/error state.
  stream?.emit('tool.started', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: 'submit_result', tool_input: JSON.stringify({ call_id: toolCallId }),
  })
  if (!check.accepted) {
    const rejected = `submit_result 被拒绝：\n${check.unmet.map(u => `- ${u}`).join('\n')}\n\n请继续执行并重新提交结果。`
    const toolMessage: LLMMessage = { role: 'tool', content: JSON.stringify({ error: rejected }), tool_call_id: toolCallId }
    messageStore.addMessage(sessionId, {
      role: 'tool', content: JSON.stringify({ error: rejected }),
      tool_name: 'submit_result', tool_input: JSON.stringify({ call_id: toolCallId }),
      tool_output: rejected, tool_status: 'error',
    })
    stream?.emit('tool.completed', {
      session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'submit_result', tool_output: rejected, tool_status: 'error', duration_ms: 0,
    })
    return { kind: 'continue', messages: [toolMessage], check }
  }

  // Emit summary as assistant delta so the client's streaming renders it
  if (stream && sessionId && summaryOutput) {
    stream.emit('message.delta', { session_id: sessionId, run_id: runId, delta: '\n\n' + summaryOutput })
  }

  // Goal mode: an accepted submission completes the active goal (idempotent).
  if (mode === 'goal' && goal && goal.status !== 'completed') {
    const updated = goalStore.update(goal.id, { status: 'completed' })
    if (updated) {
      stream?.emit('goal.status.changed', {
        session_id: sessionId, run_id: runId, goal_id: goal.id, status: 'completed',
      })
    }
  }
  // Update the last assistant message content with the summary for DB persistence
  if (summaryOutput && sessionId) {
    const msgs = messageStore.getMessages(sessionId, 100000)
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        messageStore.updateContent(msgs[i].id, (msgs[i].content || '') + '\n\n' + summaryOutput)
        break
      }
    }
  }
  // Surface the submission as a completed tool card (success) so the client
  // shows the result summary instead of a leftover "running"/error state.
  stream?.emit('tool.completed', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: 'submit_result', tool_output: summaryOutput || '结果已提交',
    tool_status: 'success', duration_ms: 0,
  })

  messages.push({
    role: 'tool',
    content: JSON.stringify({ output: summaryOutput }),
    tool_call_id: toolCallId,
  })
  messageStore.addMessage(sessionId, {
    role: 'tool',
    content: JSON.stringify({ output: summaryOutput }),
    tool_name: 'submit_result',
    tool_input: JSON.stringify({ call_id: toolCallId }),
    tool_output: summaryOutput,
    tool_status: 'success',
  })
  stream?.emit('run.completed', { session_id: sessionId, run_id: runId, status: 'task_complete' })

  const session = sessionStore.getById(sessionId)
  if (session && (input.totalInputTokens > 0 || input.totalOutputTokens > 0)) {
    // Accumulate cache tokens across runs (previously overwritten with the
    // last run's totals, skewing cache_hit_ratio for the whole session).
    const hit = (session.cache_hit_tokens || 0) + input.totalCacheHitTokens
    const miss = (session.cache_miss_tokens || 0) + input.totalCacheMissTokens
    sessionStore.update(sessionId, {
      input_tokens: (session.input_tokens || 0) + input.totalInputTokens,
      output_tokens: (session.output_tokens || 0) + input.totalOutputTokens,
      cache_hit_tokens: hit,
      cache_miss_tokens: miss,
      cache_hit_ratio: hit + miss > 0 ? ((hit / (hit + miss)) * 100).toFixed(1) : 'N/A',
    })
  }

  const disconnected: MCPClient[] = []
  for (const [, client] of input.mcpClients) {
    await disconnectMCPServer(client).catch(() => {})
    disconnected.push(client)
  }

  return {
    kind: 'done',
    status: 'task_complete',
    messages: [],
    totalInputTokens: input.totalInputTokens,
    totalOutputTokens: input.totalOutputTokens,
    totalCacheHitTokens: input.totalCacheHitTokens,
    totalCacheMissTokens: input.totalCacheMissTokens,
    disconnected,
  }
}
