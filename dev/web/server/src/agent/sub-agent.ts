import { characterMetaStore, type CharacterRecord } from '../db/characterStore.js'
import { characterContentStore } from '../character/store.js'
import { sessionStore } from '../db/sessionStore.js'
import { innerLoop, type InnerResult } from './inner.js'
import { getCharacterToolDefinitions } from '../tools/definitions.js'
import { buildSkillIndex } from './skill-loader.js'
import type { LLMMessage } from '../llm/client.js'
import type { Server, Socket } from 'socket.io'

const MAX_DEPTH = 3

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
  parentSession: { id: string; character_id: string; workspace?: string | null; workspaces?: string | null; active_group?: string | null },
  provider: { base_url: string; api_key: string },
  model: string,
  strategyOverride?: 'Plan' | 'Ask' | 'Bypass',
  signal?: AbortSignal,
  depth = 0,
  io?: Server,
  socket?: Socket,
): Promise<SubResult> {
  if (depth >= MAX_DEPTH) {
    throw new Error(`Sub-agent 递归深度 (${depth}) 超过 MAX_DEPTH (${MAX_DEPTH})`)
  }

  const targetChar = characterMetaStore.getById(targetCharacterId)
  if (!targetChar) throw new Error(`Target character not found: ${targetCharacterId}`)

  validateSubAgentTarget(parentSession.active_group, targetChar, parentSession.character_id)

  const charContent = characterContentStore.get(targetCharacterId)
  const subStrategy = strategyOverride || targetChar.default_strategy || 'Plan'

  const subSessionId = `sub_${parentSession.id}_${targetCharacterId}_${Date.now()}`
  const parentWorkspaces = parentSession.workspaces || (parentSession.workspace ? JSON.stringify([parentSession.workspace]) : null)
  sessionStore.create({
    id: subSessionId,
    character_id: targetCharacterId,
    title: `Sub: ${task.slice(0, 80)}`,
    model,
    provider_id: provider.base_url,
    workspace: parentSession.workspace || undefined,
    workspaces: parentWorkspaces,
    parent_id: parentSession.id,
    active_group: parentSession.active_group || undefined,
  })

  if (socket) {
    socket.emit('sub_agent.started', {
      session_id: parentSession.id,
      sub_session_id: subSessionId,
      target_character_id: targetCharacterId,
      task,
    })
  }

  const toolDefs = getCharacterToolDefinitions(targetChar.tools)
  const hasTools = toolDefs.length > 0 && !(depth >= 1 && toolDefs.every(t => t.function.name === 'delegate_task'))

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
  if (depth < MAX_DEPTH - 1) {
    const allChars = characterMetaStore.getAll()
    const delegateTargets = allChars.filter(c => {
      if (c.role !== 'sub' && c.role !== 'both') return false
      if (c.id === targetCharacterId) return true
      if (!parentSession.active_group) return false
      if (!c.groups || c.groups.length === 0) return false
      return c.groups.includes(parentSession.active_group)
    })
    if (delegateTargets.length > 0) {
      const groupLabel = parentSession.active_group ? `group "${parentSession.active_group}"` : 'no group (self only)'
      systemParts.push(`## Available Delegates\nYou can delegate sub-tasks using \`delegate_task\`. Available targets (${groupLabel}):\n${
        delegateTargets.map(c => `- id: "${c.id}" (${c.name})${c.id === targetCharacterId ? ' [self]' : ''} — ${c.description || ''}`).join('\n')
      }\nOnly use \`target_character_id\` from the list above.`)
    }
  }
  const systemPrompt = systemParts.join('\n\n')

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ]

  let effectiveTools = toolDefs
  if (depth >= 1) {
    effectiveTools = toolDefs.filter(t => t.function.name !== 'delegate_task')
  }

  const subWorkspaces = parentSession.workspaces ? (() => { try { return JSON.parse(parentSession.workspaces) as string[] } catch { return undefined } })() : undefined
  const innerResult: InnerResult = await innerLoop(
    messages,
    effectiveTools.length > 0 ? effectiveTools : undefined,
    provider,
    model,
    targetCharacterId,
    parentSession.workspace || undefined,
    io,
    socket,
    subSessionId,
    signal,
    {},
    0,
    undefined,
    subWorkspaces,
  )

  if (innerResult.type === 'sub_agent_request') {
      const subSubResult = await spawnAndRunSubAgent(
        innerResult.subAgentRequest!.task,
        innerResult.subAgentRequest!.target_character_id,
        { id: subSessionId, character_id: targetCharacterId, workspace: parentSession.workspace, workspaces: parentSession.workspaces },
      provider,
      model,
      innerResult.subAgentRequest!.sub_strategy,
      signal,
      depth + 1,
      io,
      socket,
    )
    return subSubResult
  }

  const summary = innerResult.fullText || innerResult.error || 'No output'
  const hasError = !!innerResult.error

  return {
    summary,
    key_files: [],
    conclusions: hasError ? [`Error: ${innerResult.error}`] : [summary],
    agent_id: targetCharacterId,
  }
}
