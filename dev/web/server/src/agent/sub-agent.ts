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

const MAX_DEPTH = 1

export interface SubResult {
  summary: string
  key_files: string[]
  conclusions: string[]
  agent_id: string
}

export interface SubSummary {
  summary: string
  key_files: string[]
  conclusions: string[]
}

export function validateSubAgentTarget(
  activeGroup: string | null | undefined,
  target: CharacterRecord,
  parentCharacterId: string,
): void {
  if (target.role !== 'sub' && target.role !== 'both') {
    throw new Error(`目标角色 "${target.name}" 不具备 sub 能力 (role=${target.role})`)
  }
  if (target.id === parentCharacterId) return
  if (activeGroup) {
    if (!target.groups?.includes(activeGroup)) {
      throw new Error(`跨组委托被禁止: 目标角色 "${target.name}" 不在组 "${activeGroup}" 中`)
    }
  } else {
    throw new Error(`跨组委托被禁止: 该角色没有组，只能委托给自身`)
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

export async function spawnAndRunSubAgent(
  task: string,
  targetCharacterId: string,
  parentSession: { id: string; character_id: string; provider_id?: string | null; workspace?: string | null; workspaces?: string | null; active_group?: string | null; current_strategy?: string | null; approval_mode?: string | null },
  provider: ProviderConfig,
  model: string,
  strategyOverride?: StrategyInput,
  signal?: AbortSignal,
  depth = 0,
  broadcaster?: TransportBroadcaster,
  stream?: TransportBroadcaster,
  runId?: string,
): Promise<SubResult> {
  if (depth >= MAX_DEPTH) {
    throw new Error(`Sub-agent 递归深度 (${depth}) 超过 MAX_DEPTH (${MAX_DEPTH})`)
  }
  if (!runId) throw new Error('Sub-agent delegation requires a persisted parent Run')

  const targetChar = characterMetaStore.getById(targetCharacterId)
  if (!targetChar) throw new Error(`Target character not found: ${targetCharacterId}`)

  validateSubAgentTarget(parentSession.active_group, targetChar, parentSession.character_id)

  const charContent = characterContentStore.get(targetCharacterId)
  const subStrategy: Strategy = normalizeStrategy(
    strategyOverride || parentSession.current_strategy || parentSession.approval_mode || targetChar.default_strategy,
  )

  const subSessionId = `sub_${parentSession.id}_${targetCharacterId}_${Date.now()}`
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
    active_group: parentSession.active_group || undefined,
    current_strategy: subStrategy,
    approval_mode: subStrategy,
  })

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

  const systemParts: string[] = []
  if (charContent.soul) systemParts.push(`## Character\n${charContent.soul}`)
  if (charContent.user) systemParts.push(`## User Info\n${charContent.user}`)
  if (charContent.memory) systemParts.push(`## Memory\n${charContent.memory}`)
  systemParts.push(`## Delegated Task\nYou are being delegated a sub-task by a parent agent. Complete the following task and report your findings.\n\nTask: ${task}`)
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
  const systemPrompt = systemParts.join('\n\n')

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

  const innerResult = await new Promise<InnerResult>((resolve, reject) => {
    enqueueRun(subSessionId, childRun.id, async childSignal => {
      try {
        getDb().prepare("UPDATE agent_tasks SET status = 'running', updated_at = ? WHERE id = ?")
          .run(Date.now(), taskId)
        childStream.emit('run.started', {
          session_id: subSessionId,
          run_id: childRun.id,
          context_window: 0,
        })
        let last: InnerResult | null = null
        const maxTurns = Math.max(1, targetChar.maxSteps || 50)
        for (let childTurn = 1; childTurn <= maxTurns && !childSignal.aborted; childTurn++) {
          last = await innerLoop(
            messages,
            effectiveTools.length > 0 ? effectiveTools : undefined,
            provider,
            model,
            targetCharacterId,
            parentSession.workspace || undefined,
            broadcaster,
            childStream,
            subSessionId,
            childSignal,
            { run_id: childRun.id },
            childTurn,
            undefined,
            subWorkspaces,
          )
          messages.push(...last.messages)
          if (last.type === 'final_answer' || last.type === 'submit_result' || last.type === 'error' || last.type === 'aborted') break
          if (last.type === 'sub_agent_request') {
            throw new Error('Child agents cannot delegate another agent')
          }
        }
        if (!last) throw new Error('Child run produced no result')
        if (last.type === 'error') throw new Error(last.error || 'Child run failed')
        const terminalStatus = childSignal.aborted ? 'cancelled' : 'completed'
        childStream.emit('run.completed', {
          session_id: subSessionId,
          run_id: childRun.id,
          status: terminalStatus,
        })
        resolve(last)
      } catch (error: any) {
        childStream.emit('run.failed', {
          session_id: subSessionId,
          run_id: childRun.id,
          error: error.message || String(error),
        })
        reject(error)
      }
    })
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
  }
}
