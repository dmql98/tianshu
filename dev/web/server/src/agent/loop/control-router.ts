import type { Server, Socket } from 'socket.io'
import { messageStore } from '../../db/messageStore.js'
import { sessionStore } from '../../db/sessionStore.js'
import { spawnAndRunSubAgent, summarizeAndMerge } from '../sub-agent.js'
import { disconnectMCPServer } from '../../tools/mcp-client.js'
import type { MCPClient } from '../../tools/mcp-client.js'
import type { LLMMessage, ProviderConfig } from '../../llm/client.js'
import type { InnerResult, SubAgentRequestData } from '../inner.js'
import { checkpointStore } from '../runtime/checkpoint-store.js'
import { planStore, goalStore } from '../plan/plan-store.js'
import { evaluateSubmission, type SubmissionCheckResult } from './completion-evaluator.js'

/**
 * Control router: handles the protocol-level outcomes of a model turn
 * (sub-agent delegation, task completion). Migrated from agent/outer.ts.
 */

export interface SubAgentOutcome {
  kind: 'continue'
  messages: LLMMessage[]
}

export async function handleSubAgentRequest(input: {
  req: SubAgentRequestData
  result: InnerResult
  session: { id: string; character_id: string; parent_id?: string | null; provider_id?: string | null; workspace?: string | null; workspaces?: string | null; active_group?: string | null; current_strategy?: string | null; approval_mode?: string | null }
  provider: ProviderConfig
  model: string
  signal?: AbortSignal
  io?: Server
  socket?: Socket
  runId: string
  workspace: string | undefined
}): Promise<SubAgentOutcome> {
  const { req, result, session, provider, model, signal, io, socket, runId } = input
  const toolCallId = (result.toolCalls?.find(tc => tc.function.name === 'delegate_to_agent')?.id) || `delegate_${Date.now()}`
  let toolMessage: LLMMessage

  // Only top-level sessions may delegate: grandchildren are structurally
  // impossible even if a model fabricates the control call.
  if (session.parent_id) {
    const errMsg = 'Child agents cannot delegate another agent'
    toolMessage = { role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: toolCallId }
    messageStore.addMessage(session.id, {
      role: 'tool', content: JSON.stringify({ error: errMsg }),
      tool_name: 'delegate_to_agent', tool_input: JSON.stringify({}),
      tool_output: errMsg, tool_status: 'error',
    })
    socket?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'delegate_to_agent', tool_output: errMsg,
      tool_status: 'error', duration_ms: 0,
    })
    return { kind: 'continue', messages: [toolMessage] }
  }

  try {
    const subResult = await spawnAndRunSubAgent(
      req.task, req.target_character_id,
      session, provider, model,
      req.sub_strategy, signal, 0, io, socket, runId,
    )
    const summary = summarizeAndMerge([subResult])
    const summaryContent = `[Sub-agent "${req.target_character_id}" completed]\n\nSummary: ${summary.summary}\n\nConclusions:\n${summary.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    toolMessage = { role: 'tool', content: JSON.stringify({ output: summaryContent }), tool_call_id: toolCallId }
    messageStore.addMessage(session.id, {
      role: 'tool',
      content: JSON.stringify({ output: summaryContent }),
      tool_name: 'delegate_to_agent',
      tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
      tool_output: summaryContent,
      tool_status: 'success',
    })
    socket?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'delegate_to_agent', tool_output: summaryContent,
      tool_status: 'success', duration_ms: 0,
    })
  } catch (err: any) {
    const errMsg = `Sub-agent delegation failed: ${err.message || err}`
    toolMessage = { role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: toolCallId }
    messageStore.addMessage(session.id, {
      role: 'tool', content: JSON.stringify({ error: errMsg }),
      tool_name: 'delegate_to_agent', tool_input: JSON.stringify({}),
      tool_output: errMsg, tool_status: 'error',
    })
    socket?.emit('tool.completed', {
      session_id: session.id, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'delegate_to_agent', tool_output: errMsg,
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
  socket?: Socket
  messages: LLMMessage[]
}): Promise<AskUserOutcome> {
  const { question, result, sessionId, runId, socket, messages } = input
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
  socket?.emit('ask_user', { session_id: sessionId, run_id: runId, question: content })
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
  socket?: Socket
}): Promise<UpdatePlanStepOutcome> {
  const { result, sessionId, runId, socket } = input
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
    socket?.emit('tool.completed', {
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
  socket?.emit('tool.completed', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: 'update_plan_step', tool_output: output, tool_status: 'success', duration_ms: 0,
  })
  socket?.emit('plan.step.updated', {
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
  socket?: Socket
  goalId?: string | null
}): Promise<CreatePlanOutcome> {
  const { result, sessionId, runId, socket, goalId } = input
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
    socket?.emit('tool.completed', {
      session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'create_plan', tool_output: errMsg, tool_status: 'error', duration_ms: 0,
    })
    return { kind: 'continue', messages: [toolMessage], planCreated: false }
  }
  planStore.supersedeActive(sessionId)
  const plan = planStore.createPlan({
    session_id: sessionId,
    goal_id: goalId || null,
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
  socket?.emit('tool.completed', {
    session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
    tool_name: 'create_plan', tool_output: summary, tool_status: 'success', duration_ms: 0,
  })
  socket?.emit('plan.created', {
    session_id: sessionId, run_id: runId, plan_id: plan.id, version: plan.version,
    steps: req.steps.map((s, i) => ({ ordinal: i + 1, title: s.title, status: 'pending' })),
  })
  return { kind: 'continue', messages: [toolMessage], planCreated: true, planId: plan.id }
}

export interface GoalOutcome {
  kind: 'continue'
  messages: LLMMessage[]
}

function goalToolMessage(sessionId: string, runId: string, socket: Socket | undefined, name: string, toolCallId: string, output: string, error?: string): LLMMessage {
  const message: LLMMessage = { role: 'tool', content: JSON.stringify(error ? { output: '', error } : { output }), tool_call_id: toolCallId }
  messageStore.addMessage(sessionId, {
    role: 'tool', content: JSON.stringify(error ? { output: '', error } : { output }),
    tool_name: name, tool_input: JSON.stringify({ call_id: toolCallId }),
    tool_output: output, tool_status: error ? 'error' : 'success',
  })
  socket?.emit('tool.completed', {
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
  socket?: Socket
}): GoalOutcome {
  const { result, sessionId, runId, socket } = input
  const goalCall = result.toolCalls?.find(tc => tc.function.name === 'create_goal')
  const toolCallId = goalCall?.id || `goal_${Date.now()}`
  const req = result.goalRequest
  if (!req || !req.outcome) {
    const errMsg = 'create_goal rejected: outcome is required'
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'create_goal', toolCallId, errMsg, errMsg)] }
  }
  const active = goalStore.listForSession(sessionId).find(g => g.status === 'active' || g.status === 'paused')
  if (active) {
    const errMsg = `create_goal rejected: 已有进行中的目标「${active.outcome}」（${active.status}）。先 complete_goal 完成它，或暂停后再创建。`
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'create_goal', toolCallId, errMsg, errMsg)] }
  }
  const goal = goalStore.create({
    session_id: sessionId,
    outcome: req.outcome,
    constraints: req.constraints || null,
    verification: req.verification || null,
    budget_tokens: req.budget_tokens ?? null,
  })
  const summary = `已创建目标：${goal.outcome}${goal.verification ? `\n验证标准：${goal.verification}` : ''}`
  socket?.emit('goal.created', {
    session_id: sessionId, run_id: runId, goal_id: goal.id, status: goal.status,
    outcome: goal.outcome, verification: goal.verification,
  })
  return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'create_goal', toolCallId, summary)] }
}

/** get_goal: report the session's active (or latest) goal state to the model. */
export function handleGetGoal(input: {
  result: InnerResult
  sessionId: string
  runId: string
  socket?: Socket
}): GoalOutcome {
  const { result, sessionId, runId, socket } = input
  const goalCall = result.toolCalls?.find(tc => tc.function.name === 'get_goal')
  const toolCallId = goalCall?.id || `goal_get_${Date.now()}`
  const goals = goalStore.listForSession(sessionId)
  const active = goals.find(g => g.status === 'active' || g.status === 'paused')
  if (!active) {
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'get_goal', toolCallId, '当前会话没有进行中的目标。需要长期目标时用 create_goal 创建。')] }
  }
  const output = `目标：${active.outcome}` +
    (active.constraints ? `\n约束：${active.constraints}` : '') +
    (active.verification ? `\n验证标准：${active.verification}` : '') +
    `\n状态：${active.status}` +
    (active.budget_tokens ? `\n预算：${goalStore.usedTokens(active)} / ${active.budget_tokens} tokens` : '')
  return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'get_goal', toolCallId, output)] }
}

/** complete_goal: mark the active goal completed (idempotent). Emits goal.status.changed. */
export function handleCompleteGoal(input: {
  result: InnerResult
  sessionId: string
  runId: string
  socket?: Socket
}): GoalOutcome {
  const { result, sessionId, runId, socket } = input
  const goalCall = result.toolCalls?.find(tc => tc.function.name === 'complete_goal')
  const toolCallId = goalCall?.id || `goal_done_${Date.now()}`
  // Latest goal (list is created_at DESC). Idempotent when already completed.
  const latest = goalStore.listForSession(sessionId)[0] || null
  if (!latest) {
    const errMsg = 'complete_goal rejected: 当前会话没有进行中的目标'
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'complete_goal', toolCallId, errMsg, errMsg)] }
  }
  if (latest.status === 'completed') {
    return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'complete_goal', toolCallId, '目标已完成（幂等）')] }
  }
  goalStore.update(latest.id, { status: 'completed' })
  socket?.emit('goal.status.changed', {
    session_id: sessionId, run_id: runId, goal_id: latest.id, status: 'completed',
  })
  const summary = result.goalCompleteSummary ? `\n摘要：${result.goalCompleteSummary}` : ''
  return { kind: 'continue', messages: [goalToolMessage(sessionId, runId, socket, 'complete_goal', toolCallId, `目标已完成：${latest.outcome}${summary}`)] }
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
  socket?: Socket
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
  const { result, sessionId, runId, socket, messages, mode, goal } = input
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
  if (!check.accepted) {
    const rejected = `submit_result 被拒绝：\n${check.unmet.map(u => `- ${u}`).join('\n')}\n\n请继续执行并重新提交结果。`
    const toolMessage: LLMMessage = { role: 'tool', content: JSON.stringify({ error: rejected }), tool_call_id: toolCallId }
    messageStore.addMessage(sessionId, {
      role: 'tool', content: JSON.stringify({ error: rejected }),
      tool_name: 'submit_result', tool_input: JSON.stringify({ call_id: toolCallId }),
      tool_output: rejected, tool_status: 'error',
    })
    socket?.emit('tool.completed', {
      session_id: sessionId, run_id: runId, tool_call_id: toolCallId,
      tool_name: 'submit_result', tool_output: rejected, tool_status: 'error', duration_ms: 0,
    })
    return { kind: 'continue', messages: [toolMessage], check }
  }

  // Emit summary as assistant delta so the client's streaming renders it
  if (socket && sessionId && summaryOutput) {
    socket.emit('message.delta', { session_id: sessionId, run_id: runId, delta: '\n\n' + summaryOutput })
  }

  // Goal mode: an accepted submission completes the active goal (idempotent).
  if (mode === 'goal' && goal && goal.status !== 'completed') {
    const updated = goalStore.update(goal.id, { status: 'completed' })
    if (updated) {
      socket?.emit('goal.status.changed', {
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
  socket?.emit('run.completed', { session_id: sessionId, run_id: runId, status: 'task_complete' })

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
