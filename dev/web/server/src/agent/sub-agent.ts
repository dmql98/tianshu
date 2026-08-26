import { characterMetaStore, type CharacterRecord } from '../db/characterStore.js'
import { characterContentStore } from '../character/store.js'
import { sessionStore } from '../db/sessionStore.js'
import { innerLoop, type InnerResult } from './inner.js'
import { getCharacterToolDefinitions } from '../tools/definitions.js'
import { buildSkillIndex } from './skill-loader.js'
import type { LLMMessage, ProviderConfig } from '../llm/client.js'
import type { TransportBroadcaster } from '../transport/runtime.js'
import { normalizeStrategy, type Strategy, type StrategyInput } from './strategy.js'
import { randomUUID } from 'crypto'
import { getDb } from '../db/schema.js'
import { messageStore } from '../db/messageStore.js'
import { turnStore } from '../db/turnStore.js'
import { runStore } from './runtime/run-store.js'
import { createDurableStream, publishRunEvent, unwrapDurableStream } from './runtime/run-event-store.js'
import { enqueueRun } from './session-runner.js'
import { buildInitialMessages, resolveWorkspace } from './loop/context-builder.js'
import { resolveCapability } from './attachments.js'
import { sessionSkillStore } from './session-skill-store.js'

const MAX_DEPTH = 1
export const MAX_INSTANCES = 5

/** P5: instances 参数归一化（1-5 整数，非法回退 1）。 */
export function clampInstances(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_INSTANCES)
}

/** P5: 子会话 ID 生成（instanceSeq 用于同源并行区分，避免同毫秒撞 ID）。 */
export function buildSubSessionId(
  parentSessionId: string,
  targetCharacterId: string,
  ts: number,
  instanceSeq?: number,
): string {
  const seq = instanceSeq !== undefined ? `_${instanceSeq}` : ''
  return `sub_${parentSessionId}_${targetCharacterId}_${ts}${seq}`
}

export interface SubResult {
  summary: string
  key_files: string[]
  conclusions: string[]
  agent_id: string
  /** 子会话 id（P3 后台化：父需回注/前端跳转子会话）。 */
  sub_session_id?: string
}

export interface SubSummary {
  summary: string
  key_files: string[]
  conclusions: string[]
}

export function validateSubAgentTarget(
  targetsRaw: string | null | undefined,
  target: CharacterRecord,
  parentCharacterId: string,
): void {
  if (target.role !== 'sub' && target.role !== 'both') {
    throw new Error(`目标角色 "${target.name}" 不具备 sub 能力 (role=${target.role})`)
  }
  if (target.id === parentCharacterId) return
  const allowed = (() => {
    if (!targetsRaw) return []
    try { const p = JSON.parse(targetsRaw); return Array.isArray(p) ? p : [] } catch { return [] }
  })()
  if (!allowed.includes(target.id)) {
    throw new Error(`委托被禁止: 目标角色 "${target.name}" 不在可委托列表 targets 中`)
  }
}

export function summarizeAndMerge(results: SubResult[], maxTokens = 2000): SubSummary {
  const parts: string[] = []
  const allFiles = new Set<string>()
  const allConclusions: string[] = []

  for (const r of results) {
    const summary = r.summary.length > maxTokens / results.length
      ? r.summary.slice(0, Math.floor(maxTokens / results.length)) + '...'
      : r.summary
    parts.push(`[${r.agent_id}]\n${summary}`)
    for (const f of r.key_files) allFiles.add(f)
    allConclusions.push(...r.conclusions)
  }

  return {
    summary: parts.join('\n\n---\n\n'),
    key_files: [...allFiles],
    conclusions: allConclusions,
  }
}

/** 子代理系统提示组装（spawn 首轮 / continue 续跑共用）。 */
function buildSubAgentSystemPrompt(
  targetChar: CharacterRecord,
  charContent: { soul: string; user: string; memory: string },
  taskHeader: string,
  hasTools: boolean,
): string {
  const systemParts: string[] = []
  if (charContent.soul) systemParts.push(`## Character\n${charContent.soul}`)
  if (charContent.user) systemParts.push(`## User Info\n${charContent.user}`)
  if (charContent.memory) systemParts.push(`## Memory\n${charContent.memory}`)
  systemParts.push(`## Delegated Task\n${taskHeader}`)
  const subSkillIndex = buildSkillIndex(targetChar)
  if (subSkillIndex.length > 0) {
    systemParts.push(`## Available Skills\n${subSkillIndex.map(s => s.listing).join('\n')}`)
  }
  if (hasTools) {
    systemParts.push(
      "# Tool-use enforcement\n" +
      "You MUST use your tools to take action \u2014 do not describe what you would do " +
      "without actually doing it. Execute tool calls immediately.\n" +
      "# Finishing the job\n" +
      "Keep working until you have produced the requested result. Report honestly " +
      "if a tool fails. Never fabricate output.\n" +
      "# Parallel tool calls\n" +
      "Batch independent read-only calls together instead of one per turn.\n" +
      "# Verification\n" +
      "Before finalizing: verify correctness and back claims with tool output."
    )
  }
  return systemParts.join('\n\n')
}

/** 子代理 run 执行：入队 + innerLoop 多轮循环（spawn 首轮 / continue 续跑共用）。 */
function runSubAgentLoop(input: {
  subSessionId: string
  childRunId: string
  taskId: string
  messages: LLMMessage[]
  toolDefs: any[]
  provider: ProviderConfig
  model: string
  targetChar: CharacterRecord
  workspace: string | undefined
  workspaces: string[] | undefined
  broadcaster?: TransportBroadcaster
  childStream: TransportBroadcaster
}): Promise<InnerResult> {
  const { subSessionId, childRunId, taskId, messages, toolDefs, provider, model, targetChar, workspace, workspaces, broadcaster, childStream } = input
  return new Promise<InnerResult>((resolve, reject) => {
    enqueueRun(subSessionId, childRunId, async childSignal => {
      try {
        getDb().prepare("UPDATE agent_tasks SET status = 'running', updated_at = ? WHERE id = ?")
          .run(Date.now(), taskId)
        childStream.emit('run.started', {
          session_id: subSessionId,
          run_id: childRunId,
          context_window: 0,
        })
        let last: InnerResult | null = null
        const maxTurns = Math.max(1, targetChar.maxSteps || 50)
        for (let childTurn = 1; childTurn <= maxTurns && !childSignal.aborted; childTurn++) {
          last = await innerLoop(
            messages,
            toolDefs.length > 0 ? toolDefs : undefined,
            provider,
            model,
            targetChar.id,
            workspace,
            broadcaster,
            childStream,
            subSessionId,
            childSignal,
            { run_id: childRunId },
            childTurn,
            undefined,
            workspaces,
          )
          messages.push(...last.messages)
          if (last.type === 'final_answer' || last.type === 'submit_result' || last.type === 'error' || last.type === 'aborted') break
          if (last.type === 'sub_agent_request' || last.type === 'sub_agent_message_request') {
            throw new Error('Child agents cannot delegate another agent')
          }
        }
        if (!last) throw new Error('Child run produced no result')
        if (last.type === 'error') throw new Error(last.error || 'Child run failed')
        const terminalStatus = childSignal.aborted ? 'cancelled' : 'completed'
        childStream.emit('run.completed', {
          session_id: subSessionId,
          run_id: childRunId,
          status: terminalStatus,
        })
        resolve(last)
      } catch (error: any) {
        childStream.emit('run.failed', {
          session_id: subSessionId,
          run_id: childRunId,
          error: error.message || String(error),
        })
        reject(error)
      }
    })
  })
}

export async function spawnAndRunSubAgent(
  task: string,
  targetCharacterId: string,
  parentSession: { id: string; character_id: string; provider_id?: string | null; workspace?: string | null; workspaces?: string | null; active_group?: string | null; targets?: string | null; current_strategy?: string | null; approval_mode?: string | null },
  provider: ProviderConfig,
  model: string,
  strategyOverride?: StrategyInput,
  signal?: AbortSignal,
  depth = 0,
  broadcaster?: TransportBroadcaster,
  stream?: TransportBroadcaster,
  runId?: string,
  instanceSeq?: number,
  onSpawned?: (subSessionId: string) => void,
): Promise<SubResult> {
  if (depth >= MAX_DEPTH) {
    throw new Error(`Sub-agent 递归深度 (${depth}) 超过 MAX_DEPTH (${MAX_DEPTH})`)
  }
  if (!runId) throw new Error('Sub-agent delegation requires a persisted parent Run')

  const targetChar = characterMetaStore.getById(targetCharacterId)
  if (!targetChar) throw new Error(`Target character not found: ${targetCharacterId}`)

  validateSubAgentTarget(parentSession.targets, targetChar, parentSession.character_id)

  const charContent = characterContentStore.get(targetCharacterId)
  const subStrategy: Strategy = normalizeStrategy(
    strategyOverride || parentSession.current_strategy || parentSession.approval_mode || targetChar.default_strategy,
  )

  const subSessionId = buildSubSessionId(parentSession.id, targetCharacterId, Date.now(), instanceSeq)
  const parentWorkspaces = parentSession.workspaces || (parentSession.workspace ? JSON.stringify([parentSession.workspace]) : null)
  const childSession = sessionStore.create({
    id: subSessionId,
    character_id: targetCharacterId,
    title: `Sub: ${task.slice(0, 80)}`,
    model,
    provider_id: parentSession.provider_id || undefined,
    workspace: parentSession.workspace || undefined,
    workspaces: parentWorkspaces,
    parent_id: parentSession.id,
    targets: parentSession.targets || undefined,
    current_strategy: subStrategy,
    approval_mode: subStrategy,
  })
  // P5 批次聚合：子会话创建后立即注册 pending（不等待子跑完），
  // 供 control-router 的「全部完成才唤醒」判断使用。
  onSpawned?.(subSessionId)

  const turn = turnStore.create(subSessionId, 'agent_task')
  const childRun = runStore.create(childSession, {
    parentRunId: runId || null,
    turnId: turn.id,
    source: 'agent_task',
    maxTurns: targetChar.maxSteps,
  })
  const userMessage = messageStore.addMessage(subSessionId, {
    role: 'user',
    content: task,
    turn_id: turn.id,
    run_id: childRun.id,
  })
  turnStore.attachUserMessage(turn.id, userMessage.id)
  const taskId = `atask_${randomUUID()}`
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO agent_tasks (
      id, parent_run_id, child_session_id, child_run_id, target_character_id,
      task, expected_output, mode, status, result, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'foreground', 'queued', NULL, NULL, ?, ?)
  `).run(taskId, runId, subSessionId, childRun.id, targetCharacterId, task, now, now)

  if (stream) {
    stream.emit('sub_agent.started', {
      session_id: parentSession.id,
      run_id: runId,
      sub_session_id: subSessionId,
      target_character_id: targetCharacterId,
      task,
    })
  }

  // Child sessions never receive delegation capability, so grandchildren are
  // impossible even if the model fabricates the control call.
  const toolDefs = getCharacterToolDefinitions(targetChar.tools)
    .filter(tool => tool.function.name !== 'delegate_to_agent')
  const hasTools = toolDefs.length > 0

  const systemPrompt = buildSubAgentSystemPrompt(
    targetChar,
    charContent,
    `You are being delegated a sub-task by a parent agent. Complete the following task and report your findings.\n\nTask: ${task}`,
    hasTools,
  )

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ]

  const effectiveTools = toolDefs

  const subWorkspaces = parentSession.workspaces ? (() => { try { return JSON.parse(parentSession.workspaces) as string[] } catch { return undefined } })() : undefined
  const rawStream = stream ? unwrapDurableStream(stream) : undefined
  if (!rawStream) throw new Error('Sub-agent requires an active event channel')
  publishRunEvent(rawStream, childRun.id, 'run.queued', {
    session_id: subSessionId,
    run_id: childRun.id,
    character_id: targetCharacterId,
    character_revision_id: childRun.character_revision_id,
    parent_run_id: runId,
  })
  const childStream = createDurableStream(rawStream, childRun.id)

  const innerResult = await runSubAgentLoop({
    subSessionId,
    childRunId: childRun.id,
    taskId,
    messages,
    toolDefs: effectiveTools,
    provider,
    model,
    targetChar,
    workspace: parentSession.workspace || undefined,
    workspaces: subWorkspaces,
    broadcaster,
    childStream,
  })

  const summary = innerResult.fullText || innerResult.error || 'No output'
  const hasError = !!innerResult.error
  getDb().prepare(`
    UPDATE agent_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?
  `).run(hasError ? 'failed' : 'completed', hasError ? null : summary, innerResult.error || null, Date.now(), taskId)

  return {
    summary,
    key_files: [],
    conclusions: hasError ? [`Error: ${innerResult.error}`] : [summary],
    agent_id: targetCharacterId,
    sub_session_id: subSessionId,
  }
}

export interface SpawnSubAgentsInput {
  task: string
  targetCharacterId: string
  parentSession: Parameters<typeof spawnAndRunSubAgent>[2]
  provider: ProviderConfig
  model: string
  strategyOverride?: StrategyInput
  broadcaster?: TransportBroadcaster
  stream?: TransportBroadcaster
  runId: string
}

/** 单个子任务的执行结果（成功或失败都返回，不 throw——barrier 需要逐个 settle）。 */
export interface SpawnOutcome {
  subResult?: SubResult
  error?: string
}

/**
 * 委托入口（P5 同步 barrier）：每个 delegate_to_agent 拉起一个子会话，
 * 成功/失败都返回 outcome；失败时尽力携带 sub_session_id（若子会话已创建）。
 */
export async function spawnAndRunSubAgents(input: SpawnSubAgentsInput): Promise<SpawnOutcome> {
  const spawned: { id?: string } = {}
  const onSpawned = (sid: string) => {
    spawned.id = sid
  }
  try {
    const subResult = await spawnAndRunSubAgent(
      input.task,
      input.targetCharacterId,
      input.parentSession,
      input.provider,
      input.model,
      input.strategyOverride,
      undefined,
      0,
      input.broadcaster,
      input.stream,
      input.runId,
      undefined,
      onSpawned,
    )
    return { subResult }
  } catch (err: any) {
    return {
      error: err?.message || String(err),
      subResult: spawned.id
        ? { summary: '', key_files: [], conclusions: [], agent_id: input.targetCharacterId, sub_session_id: spawned.id }
        : undefined,
    }
  }
}

/**
 * P4: 在已有子会话续跑一个新 turn（send_message_to_subagent）。
 *
 * 与 spawnAndRunSubAgent 的区别：
 * - 不新建子会话：沿用 subSessionId 的既有历史（从 DB 重建，含首轮 user/assistant/tool 消息）；
 * - 追加一条 user 消息（message）作为新指令；
 * - 新 turn + 新 run（source=agent_task），入队子会话 run-coordinator（自动串行排队）；
 * - system 提示改用「继续委托会话」模板，首轮 Task 仍在历史中，上下文完整。
 */
export async function continueSubAgentWithMessage(input: {
  subSessionId: string
  message: string
  parentRunId: string
  provider: ProviderConfig
  model: string
  strategyOverride?: StrategyInput
  broadcaster?: TransportBroadcaster
  stream?: TransportBroadcaster
}): Promise<SubResult> {
  const { subSessionId, message, parentRunId, provider, model, strategyOverride, broadcaster, stream } = input
  if (!subSessionId || !message) throw new Error('Sub-agent message requires sub_session_id and message')
  if (!parentRunId) throw new Error('Sub-agent message requires a persisted parent Run')

  const subSession = sessionStore.getById(subSessionId)
  if (!subSession) throw new Error(`Sub-agent session not found: ${subSessionId}`)
  if (!subSession.parent_id) throw new Error(`Session "${subSessionId}" is not a sub-agent session`)

  const targetChar = characterMetaStore.getById(subSession.character_id)
  if (!targetChar) throw new Error(`Target character not found: ${subSession.character_id}`)
  const charContent = characterContentStore.get(subSession.character_id)

  // 子会话同样无 delegate/send_message 能力（层级硬控终点节点）。
  const toolDefs = getCharacterToolDefinitions(targetChar.tools)
    .filter(tool => tool.function.name !== 'delegate_to_agent' && tool.function.name !== 'send_message_to_subagent')
  const hasTools = toolDefs.length > 0

  const subStrategy: Strategy = normalizeStrategy(
    strategyOverride || subSession.current_strategy || subSession.approval_mode || targetChar.default_strategy,
  )

  // 新 turn + 新 run（同一子会话续跑）。
  const turn = turnStore.create(subSessionId, 'agent_task')
  const childRun = runStore.create(subSession, {
    parentRunId,
    turnId: turn.id,
    source: 'agent_task',
    maxTurns: targetChar.maxSteps,
  })
  const userMessage = messageStore.addMessage(subSessionId, {
    role: 'user',
    content: message,
    turn_id: turn.id,
    run_id: childRun.id,
  })
  turnStore.attachUserMessage(turn.id, userMessage.id)

  const taskId = `atask_${randomUUID()}`
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO agent_tasks (
      id, parent_run_id, child_session_id, child_run_id, target_character_id,
      task, expected_output, mode, status, result, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'continue', 'queued', NULL, NULL, ?, ?)
  `).run(taskId, parentRunId, subSessionId, childRun.id, targetChar.id, message, now, now)

  if (stream) {
    stream.emit('sub_agent.started', {
      session_id: subSession.parent_id,
      run_id: parentRunId,
      sub_session_id: subSessionId,
      target_character_id: targetChar.id,
      task: message,
    })
  }

  const subWorkspaces = subSession.workspaces ? (() => { try { return JSON.parse(subSession.workspaces) as string[] } catch { return undefined } })() : undefined
  const rawStream = stream ? unwrapDurableStream(stream) : undefined
  if (!rawStream) throw new Error('Sub-agent requires an active event channel')
  publishRunEvent(rawStream, childRun.id, 'run.queued', {
    session_id: subSessionId,
    run_id: childRun.id,
    character_id: targetChar.id,
    character_revision_id: childRun.character_revision_id,
    parent_run_id: parentRunId,
  })
  const childStream = createDurableStream(rawStream, childRun.id)

  // 从 DB 重建子会话完整上下文（首轮消息全部落库），system 用「继续委托」模板。
  const cap = resolveCapability(model, undefined)
  const rows = messageStore.getMessagesAfter(subSessionId, subSession.compaction_until_id || 0, 100000)
  const systemPrompt = buildSubAgentSystemPrompt(
    targetChar,
    charContent,
    'You are a sub-agent continuing an existing delegated session. Follow the conversation history; the latest user message is your new instruction from the parent agent. Complete it and report your findings.',
    hasTools,
  )
  const messages = await buildInitialMessages({
    characterId: subSession.character_id,
    systemPrompt,
    memory: charContent.memory || null,
    compactionSummary: subSession.compaction_summary || null,
    rows,
    compactionUntilId: subSession.compaction_until_id || 0,
    trimmedUntilId: subSession.trimmed_until_id || 0,
    providerBaseUrl: provider.base_url,
    cap,
    workspace: resolveWorkspace(subSession.workspace),
    activeSkills: sessionSkillStore.bodies(subSessionId),
  })

  const innerResult = await runSubAgentLoop({
    subSessionId,
    childRunId: childRun.id,
    taskId,
    messages,
    toolDefs,
    provider,
    model,
    targetChar,
    workspace: subSession.workspace || undefined,
    workspaces: subWorkspaces,
    broadcaster,
    childStream,
  })

  const summary = innerResult.fullText || innerResult.error || 'No output'
  const hasError = !!innerResult.error
  getDb().prepare(`
    UPDATE agent_tasks SET status = ?, result = ?, error = ?, updated_at = ? WHERE id = ?
  `).run(hasError ? 'failed' : 'completed', hasError ? null : summary, innerResult.error || null, Date.now(), taskId)

  return {
    summary,
    key_files: [],
    conclusions: hasError ? [`Error: ${innerResult.error}`] : [summary],
    agent_id: targetChar.id,
    sub_session_id: subSessionId,
  }
}
