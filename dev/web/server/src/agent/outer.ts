import { sessionStore } from '../db/sessionStore.js'
import { messageStore } from '../db/messageStore.js'
import { characterMetaStore, type CharacterRecord } from '../db/characterStore.js'
import { providerStore } from '../db/providerStore.js'
import { characterContentStore } from '../character/store.js'
import { innerLoop, detectDoomLoop, type ToolCallRecord } from './inner.js'
import { truncateToolOutput } from '../tools/truncate.js'
import { detectInsight } from '../evolution/index.js'
import { spawnAndRunSubAgent, summarizeAndMerge } from './sub-agent.js'
import { buildSkillIndex } from './skill-loader.js'
import { getCharacterToolDefinitions } from '../tools/definitions.js'
import { stableKey, getCached, setCached, normalizeTools, extractComponents, diagnoseMiss, capturePrefixShape, compareShapes, type PrefixShape } from './system-cache.js'
import { composeMessages, type ComposeContext } from './compose.js'
import { connectMCPServer, disconnectMCPServer } from '../tools/mcp-client.js'
import { mcpServerStore } from '../db/toolStore.js'
import { setMCPStatus } from '../tools/mcp-status.js'
import { preprocessContextReferences } from './context-references.js'
import { eventService } from '../event/eventService.js'
import { evolutionConfig } from '../evolution/evolutionConfig.js'
import * as fs from 'fs'
import * as path from 'path'
import { streamChatCompletion, type LLMMessage } from '../llm/client.js'
import { reconstructParts, lowerContentToProvider, textPart, resolveCapability, resolveProviderFormat, type ProviderCapability, type ProviderFormat } from './attachments.js'
import type { Server, Socket } from 'socket.io'
import type { MessageRow } from '../db/messageStore.js'
import type { MCPClient } from '../tools/mcp-client.js'

const DEFAULT_MAX_TURNS = 20
const DEFAULT_CONTEXT_WINDOW = 200000

const DEFAULT_WORKSPACE = 'C:\\.Yi'
if (!fs.existsSync(DEFAULT_WORKSPACE)) {
  try { fs.mkdirSync(DEFAULT_WORKSPACE, { recursive: true }) } catch {}
}
function resolveWorkspace(ws: string | null | undefined): string {
  return ws || DEFAULT_WORKSPACE
}
function resolveWorkspaces(session: { workspace?: string | null; workspaces?: string | null }): string[] {
  if (session.workspaces) {
    try { return JSON.parse(session.workspaces) }
    catch { /* fall through */ }
  }
  return [resolveWorkspace(session.workspace)]
}
const SOFT_COMPACT_RATIO = 0.5
const SNIP_RATIO = 0.6
const COMPACT_THRESHOLD = 0.75
const COLD_RESUME_MS = 24 * 60 * 60 * 1000
const KEEP_TOKENS = 8000
const SNIP_KEEP_TOOL_TURNS = 3
const SUMMARY_OUTPUT_TOKENS = 2048

const SUMMARY_TEMPLATE = `Output exactly the structure below and keep section order. Do not include <template> tags.
<template>
## Goal
- [single-sentence task summary]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Relevant Context
- [important facts, errors, questions, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const DEFAULT_PROMPT_FILE = resolve(DATA_DIR, 'prompts', 'default.md')

function loadPromptTemplate(charId: string): string {
  // Per-character prompt overrides default
  const charPrompt = resolve(DATA_DIR, 'characters', charId, 'prompt.md')
  const file = existsSync(charPrompt) ? charPrompt : DEFAULT_PROMPT_FILE
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return '## System Prompt\n\n{{GUIDANCE}}'
  }
}

function assembleStaticPrompt(
  charMeta: CharacterRecord,
  charContent: { soul: string; user: string },
  toolDefs: any[],
  workspace: string,
): string {
  const parts: string[] = []

  if (charContent.soul) parts.push(`## Character\n${charContent.soul}`)
  if (charContent.user) parts.push(`## User Info\n${charContent.user}`)

  // Load configurable prompt template
  parts.push(loadPromptTemplate(charMeta.id).trim())

  // List available tools — sorted for deterministic ordering (Reasonix #6)
  if (toolDefs.length > 0) {
    const sorted = normalizeTools(toolDefs)
    const toolListings = sorted.map((t: any) =>
      `- ${t.function.name}: ${t.function.description}`
    )
    parts.push(`## Available Tools\n${toolListings.join('\n')}`)
  }

  // Skills: index only (names + descriptions, no bodies — Reasonix #3)
  const skillIndex = buildSkillIndex(charMeta)
  if (skillIndex.length > 0) {
    const skillList = skillIndex.map(s => s.listing).join('\n')
    parts.push(`## Available Skills\n${skillList}\nUse \`skill_manager\` with action="read" to view a skill's full SKILL.md content.`)
    const hints = skillIndex.filter(s => s.attachments.length > 0)
      .map(s => `  ${s.name}: ${s.attachments.join(', ')}`)
    if (hints.length) {
      parts.push(`## Skill Attachments\n${hints.join('\n')}`)
    }
  }

  parts.push(`## Workspace\nYou can access: ${workspace}\nCreate it if it does not exist.`)    

  return parts.join('\n\n')
}

// ── Guidance blocks (ported from opencode) ──

const TOOL_USE_GUIDANCE =`
- **Continue until done**: Tool calls are intermediate steps. Only stop after producing a verifiable result or explicit answer. If a tool fails, retry up to 2 alternatives, then report the blocker and halt.
- **Batch reads**: Combine all independent lookups (reads, searches, checks) into one turn. Only sequence calls when B truly needs A's raw output.
- **Act first**: Execute clear requests immediately (e.g., "check time" -> run "date"). Only pause to ask if the ambiguity changes the tool choice or involves destructive actions.
- **Ground truth**: All claims must be backed by tool outputs. Never fabricate errors or data. If missing info, retrieve it; if impossible, mark assumptions as [Assumption].
`;
  

const IMAGE_TOKEN_EQUIVALENT = 1100

/** Flatten any LLMMessage content (string or multimodal parts) into plain text. */
function contentToText(content: LLMMessage['content']): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .map((p) => {
      if ('text' in p) return p.text || ''
      return '[media attachment]'
    })
    .join('\n')
}

function estimateTokens(messages: LLMMessage[]): number {
  let total = 0
  for (const m of messages) {
    if (m.content) {
      if (typeof m.content === 'string') total += m.content.length / 4
      else {
        for (const p of m.content) {
          if ('text' in p) total += (p.text?.length || 0) / 4
          else total += IMAGE_TOKEN_EQUIVALENT
        }
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += tc.function.name.length / 4 + tc.function.arguments.length / 4
      }
    }
    if (m.reasoning_content) total += m.reasoning_content.length / 4
    total += 4
  }
  return Math.ceil(total)
}

function shouldSnip(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return estimateTokens(messages) > contextWindow * SNIP_RATIO
}

function persistComposeChanges(master: LLMMessage[], composed: LLMMessage[]): void {
  if (master.length !== composed.length) return
  for (let i = 0; i < master.length; i++) {
    if (master[i].role === 'user' && master[i].content !== composed[i].content) {
      master[i] = { ...master[i], content: composed[i].content }
    }
  }
}

function trimToolResults(messages: LLMMessage[]): boolean {
  let trimmed = false
  let turnCount = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      turnCount++
      if (turnCount > SNIP_KEEP_TOOL_TURNS) {
        const toolIds = new Set(m.tool_calls.filter(tc => tc.id).map(tc => tc.id!))
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'tool' && messages[j].tool_call_id && toolIds.has(messages[j].tool_call_id!)) {
            messages[j] = { ...messages[j], content: JSON.stringify({ output: '[trimmed]' }) }
            trimmed = true
          }
        }
      }
    }
  }
  return trimmed
}

function shouldCompact(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return estimateTokens(messages) > contextWindow * COMPACT_THRESHOLD
}

function systemMessageEnd(messages: LLMMessage[]): number {
  let i = 0
  while (i < messages.length && messages[i].role === 'system') i++
  return i
}

function extractPreviousSummary(messages: LLMMessage[]): string | undefined {
  const sysEnd = systemMessageEnd(messages)
  const c = sysEnd < messages.length ? contentToText(messages[sysEnd].content) : ''
  if (sysEnd < messages.length && messages[sysEnd].role === 'system' && c.startsWith('[Compacted History]')) {
    return c.replace('[Compacted History]\n', '')
  }
}

function selectEntries(
  msgs: LLMMessage[],
  tokenBudget: number,
): { head: LLMMessage[]; recent: LLMMessage[] } | undefined {
  type SerEntry = { text: string; msg: LLMMessage }
  const serialized: SerEntry[] = []
  for (const m of msgs) {
    if (m.role === 'user' && m.content) {
      serialized.push({ text: `[User]: ${contentToText(m.content)}`, msg: m })
    } else if (m.role === 'assistant') {
      const parts: string[] = []
      if (m.content) parts.push(`[Assistant]: ${contentToText(m.content)}`)
      if (m.tool_calls) {
        for (const tc of m.tool_calls) parts.push(`[Tool call]: ${tc.function.name}`)
      }
      if (parts.length) serialized.push({ text: parts.join('\n'), msg: m })
    } else if (m.role === 'tool') {
      const content = contentToText(m.content)
      const status = content.includes('error') ? content.slice(0, 100) : 'success'
      serialized.push({ text: `[Tool result]: ${status}`, msg: m })
    } else if (m.role === 'system' && m.content) {
      serialized.push({ text: `[System]: ${contentToText(m.content).slice(0, 200)}`, msg: m })
    }
  }
  if (serialized.length === 0) return

  let total = 0
  let split = serialized.length
  for (let i = serialized.length - 1; i >= 0; i--) {
    total += Math.ceil(serialized[i].text.length / 4)
    if (total > tokenBudget) { split = i + 1; break }
    split = i
  }

  if (split === 0) return

  const recentMsgs = serialized.slice(split).map(e => e.msg)
  const headMsgs = serialized.slice(0, split).map(e => e.msg)

  // Ensure split doesn't break tool_calls/tool_response pairs
  // If the first message in recent is a tool response, its parent assistant(tool_calls)
  // must also stay in recent — find it in head and move everything after it to recent
  if (recentMsgs.length > 0 && recentMsgs[0].role === 'tool') {
    for (let i = headMsgs.length - 1; i >= 0; i--) {
      if (headMsgs[i].role === 'assistant' && headMsgs[i].tool_calls) {
        const moved = headMsgs.splice(i)
        recentMsgs.unshift(...moved)
        break
      }
    }
  }

  return { head: headMsgs, recent: recentMsgs }
}

function buildCompactionSummary(msgs: LLMMessage[]): string {
  const parts: string[] = []
  for (const m of msgs) {
    if (m.role === 'user' && m.content) {
      const c = contentToText(m.content)
      parts.push(`User: ${c.length > 200 ? c.slice(0, 200) + '...' : c}`)
    } else if (m.role === 'assistant') {
      if (m.content) {
        const c = contentToText(m.content)
        parts.push(`Assistant: ${c.length > 200 ? c.slice(0, 200) + '...' : c}`)
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) parts.push(`Tool Call: ${tc.function.name}`)
      }
    } else if (m.role === 'tool') {
      const c = contentToText(m.content)
      parts.push(`Tool Result: ${c.includes('error') ? c.slice(0, 100) + '...' : 'success'}`)
    }
  }
  return parts.join('\n')
}

function serializeForSummary(msgs: LLMMessage[]): string {
  const lines: string[] = []
  for (const m of msgs) {
    if (m.role === 'user' && m.content) {
      const c = contentToText(m.content)
      lines.push(c.length > 800 ? `[User]: ${c.slice(0, 800)}...` : `[User]: ${c}`)
    } else if (m.role === 'assistant') {
      if (m.content) {
        const c = contentToText(m.content)
        lines.push(c.length > 400 ? `[Assistant]: ${c.slice(0, 400)}...` : `[Assistant]: ${c}`)
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) lines.push(`[Tool call]: ${tc.function.name}`)
      }
    }
  }
  return lines.join('\n')
}

async function llmSummarize(
  head: LLMMessage[],
  provider: { base_url: string; api_key: string },
  model: string,
  previousSummary?: string,
): Promise<string> {
  const convo = serializeForSummary(head)
  const prompt = previousSummary
    ? `Update the anchored summary below using the conversation history above. Preserve still-true details, remove stale details, and merge in new facts.\n<previous-summary>\n${previousSummary}\n</previous-summary>\n\n${SUMMARY_TEMPLATE}\n\n${convo}`
    : `Create a new anchored summary from the conversation history.\n\n${SUMMARY_TEMPLATE}\n\n${convo}`

  let summary = ''
  try {
    for await (const chunk of streamChatCompletion({
      baseUrl: provider.base_url, apiKey: provider.api_key, model,
      messages: [{ role: 'user', content: prompt }],
    })) {
      if (chunk.type === 'delta' && chunk.text) summary += chunk.text
      if (chunk.type === 'error') throw new Error(chunk.text)
    }
  } catch (err: any) {
    console.warn('[summarize] LLM failed, fallback to truncation:', err.message)
    return buildCompactionSummary(head)
  }
  return summary || buildCompactionSummary(head)
}

function compactHistory(
  messages: LLMMessage[],
  summary: string,
  recent: LLMMessage[],
): LLMMessage[] {
  const sysEnd = systemMessageEnd(messages)
  const systemMsgs = messages.slice(0, sysEnd)
  const compacted: LLMMessage[] = [...systemMsgs]
  compacted.push({ role: 'system', content: `[Compacted History]\n${summary}` })
  compacted.push(...recent)
  return compacted
}

async function selectAndSummarize(
  messages: LLMMessage[],
  provider: { base_url: string; api_key: string },
  model: string,
): Promise<{ messages: LLMMessage[]; didCompact: boolean; summary?: string; recent?: LLMMessage[]; compactedUntilId?: number }> {
  const sysEnd = systemMessageEnd(messages)
  if (sysEnd >= messages.length) return { messages, didCompact: false }

  const conversation = messages.slice(sysEnd)
  const previousSummary = extractPreviousSummary(messages)
  const selected = selectEntries(conversation, KEEP_TOKENS)
  if (!selected || selected.head.length === 0) return { messages, didCompact: false }

  const summary = await llmSummarize(selected.head, provider, model, previousSummary)
  const compacted = compactHistory(messages, summary, selected.recent)

  let compactedUntilId = 0
  for (const m of selected.head) {
    const dbId = (m as any).__dbId
    if (typeof dbId === 'number' && dbId > compactedUntilId) compactedUntilId = dbId
  }

  return { messages: compacted, didCompact: true, summary, recent: selected.recent, compactedUntilId }
}

function rowToLLMMessage(
  row: MessageRow,
  sessionId: string,
  cap: ProviderCapability,
  format: ProviderFormat,
): LLMMessage | null {
  if (row.role === 'tool') {
    let callId = ''
    try { const p = JSON.parse(row.tool_input || '{}'); if (p.call_id) callId = p.call_id } catch {}
    if (!callId) return null
    let content = row.content || ''
    try {
      const parsed = JSON.parse(content)
      if (parsed.output) parsed.output = truncateToolOutput(String(parsed.output))
      if (parsed.error) parsed.error = truncateToolOutput(String(parsed.error))
      content = JSON.stringify(parsed)
    } catch {}
    // Tool-produced media (e.g. webfetch images) ride the same media pipe.
    if (row.attachments) {
      const { media } = reconstructParts(content, row.attachments, sessionId)
      if (media.length > 0) {
        return { role: 'tool', content: lowerContentToProvider([textPart(content), ...media], cap, format), tool_call_id: callId }
      }
    }
    return { role: 'tool', content, tool_call_id: callId }
  }
  if (row.role === 'assistant' && row.tool_input) {
    try {
      const msg: LLMMessage = { role: 'assistant', content: row.content || null, tool_calls: JSON.parse(row.tool_input) }
      if (row.reasoning_content) msg.reasoning_content = row.reasoning_content
      return msg
    } catch {}
  }
  if (row.role === 'assistant' && !row.content && !row.tool_input) return null
  if (row.role === 'user' && row.attachments) {
    const { media } = reconstructParts(row.content || '', row.attachments, sessionId)
    if (media.length > 0) {
      return { role: 'user', content: lowerContentToProvider([textPart(row.content || ''), ...media], cap, format) }
    }
  }
  const msg: LLMMessage = { role: row.role as LLMMessage['role'], content: row.content || '' }
  if (row.reasoning_content) msg.reasoning_content = row.reasoning_content
  return msg
}

export interface RunResult {
  status: 'stop' | 'max_turns' | 'cancelled' | 'task_complete'
  sessionId: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens: number
  totalCacheMissTokens: number
}

export async function sessionLoop(io: Server, socket: Socket, sessionId: string, signal?: AbortSignal, opts: { thinking?: boolean; reasoning_effort?: string } = {}): Promise<RunResult> {
  const session = sessionStore.getById(sessionId)
  if (!session) { socket.emit('run.failed', { session_id: sessionId, error: 'Session not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const charMeta = characterMetaStore.getById(session.character_id)
  if (!charMeta) { socket.emit('run.failed', { session_id: sessionId, error: 'Character not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const charContent = characterContentStore.get(session.character_id)

  const providerId = session.provider_id
  if (!providerId) { socket.emit('run.failed', { session_id: sessionId, error: 'No provider configured' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const provider = providerStore.getById(providerId)
  if (!provider) { socket.emit('run.failed', { session_id: sessionId, error: 'Provider not found' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const model = session.model || provider.models[0]?.id
  if (!model) { socket.emit('run.failed', { session_id: sessionId, error: 'No model configured' }); return { status: 'stop', sessionId, totalInputTokens: 0, totalOutputTokens: 0, totalCacheHitTokens: 0, totalCacheMissTokens: 0 } }

  const modelConfig = provider.models.find(m => m.id === model)
  const contextWindow = modelConfig?.context_window || DEFAULT_CONTEXT_WINDOW
  sessionStore.update(sessionId, { context_window: contextWindow })

  const cap: ProviderCapability = resolveCapability(model, modelConfig?.supports_vision)

  const workspaces = resolveWorkspaces(session)
  const workspace = resolveWorkspace(session.workspace)

  const maxTurns = charMeta.maxSteps || DEFAULT_MAX_TURNS

  const toolDefs = getCharacterToolDefinitions(charMeta.tools)

  const mcpClients = new Map<string, MCPClient>()
  const mcpFailedServers: string[] = []
  if (charMeta.tools) {
    const mcpEntries = charMeta.tools.filter((t: { name: string }) => t.name.startsWith('mcp:'))
    for (const entry of mcpEntries) {
      const serverName = entry.name.slice(4)
      const config = mcpServerStore.getAll().find((s: { name: string }) => s.name === serverName)
      if (!config) {
        console.warn(`[mcp] Server "${serverName}" referenced but not configured`)
        setMCPStatus(serverName, { status: 'disabled' })
        mcpFailedServers.push(serverName)
        continue
      }
      setMCPStatus(serverName, { status: 'connecting' })
      let lastError = ''
      const MAX_RETRIES = 3
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const client = await connectMCPServer(config, resolveWorkspace(session.workspace))
          mcpClients.set(serverName, client)
          for (const tool of client.tools) {
            const fullName = `mcp__${serverName}__${tool.name}`
            toolDefs.push({
              type: 'function' as const,
              function: {
                name: fullName,
                description: tool.description,
                parameters: tool.inputSchema as any,
              },
            })
          }
          setMCPStatus(serverName, { status: 'connected', toolsCount: client.tools.length })
          console.log(`[mcp] Connected "${serverName}" (${client.tools.length} tools)`)
          lastError = ''
          break
        } catch (err: any) {
          lastError = err.message
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000)
            console.warn(`[mcp] Retry ${attempt}/${MAX_RETRIES} for "${serverName}" in ${delay}ms: ${err.message}`)
            await new Promise(r => setTimeout(r, delay))
          }
        }
      }
      if (lastError) {
        setMCPStatus(serverName, { status: 'failed', error: lastError })
        console.error(`[mcp] Server "${serverName}" failed after ${MAX_RETRIES} retries: ${lastError}`)
        mcpFailedServers.push(serverName)
      }
    }
  }

  // ── #2 delegate_targets → inject into tool schema (not system text) ──
  const allChars = characterMetaStore.getAll()
  const activeGroup = session.active_group
  const delegateTargets = allChars.filter(c => {
    if (c.role !== 'sub' && c.role !== 'both') return false
    if (c.id === session.character_id) return true
    if (!activeGroup) return false
    if (!c.groups || c.groups.length === 0) return false
    return c.groups.includes(activeGroup)
  })
  if (delegateTargets.length > 0) {
    for (const t of toolDefs) {
      if (t.function.name === 'delegate_task') {
        const targetStr = delegateTargets.map(c => `${c.id}(${c.name})`).join(', ')
        t.function.description += ` | targets: ${targetStr}`
      }
    }
  }

  const tools = toolDefs.length > 0 ? toolDefs : undefined

  // Build system prompt — cached by fingerprint
  const key = stableKey(
    charMeta.id,
    normalizeTools(toolDefs),
    charMeta.skills,
    charContent.soul,
    charContent.user,
  )
  let systemPrompt = getCached(key)
  if (!systemPrompt) {
    const comp = extractComponents(charMeta.id, normalizeTools(toolDefs), charMeta.skills, charContent.soul, charContent.user)
    const reasons = diagnoseMiss(charMeta.id, comp)
    console.log(`[system-cache] miss ${key}: ${reasons.join(', ')} (${toolDefs.length} tools, ${(charMeta.skills || []).length} skills)`)
    systemPrompt = assembleStaticPrompt(charMeta, charContent, toolDefs, resolveWorkspace(session.workspace))
    setCached(key, systemPrompt)
  }

  // Memory + compaction summary at fixed positions so prefix cache stays stable
  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }]
  if (charContent.memory) {
    messages.push({ role: 'system', content: `## Memory\n${charContent.memory}` })
  }
  if (session.compaction_summary) {
    messages.push({ role: 'system', content: `[Compacted History]\n${session.compaction_summary}` })
  }

  const rows = messageStore.getMessages(sessionId)
  const compactUntilId = session.compaction_until_id || 0
  for (const row of rows) {
    if (compactUntilId > 0 && row.id <= compactUntilId) continue
    let m = rowToLLMMessage(row, sessionId, cap, resolveProviderFormat(provider.base_url))
    if (m && m.role === 'user' && typeof m.content === 'string' && /@(file|folder|url):/.test(m.content)) {
      const refResult = await preprocessContextReferences(m.content, resolveWorkspace(session.workspace))
      if (refResult.expanded) {
        m = { ...m, content: refResult.message }
        for (const w of refResult.warnings) console.warn(`[context-ref] ${w}`)
      }
    }
    if (m) {
      ;(m as any).__dbId = row.id
      messages.push(m)
    }
  }

  // Fix orphaned tool_calls: ensure every assistant(tool_calls) has matching tool responses
  // If a tool response was dropped (old DB format), inject a placeholder
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls) {
      const expectedIds = new Set(m.tool_calls.filter(tc => tc.id).map(tc => tc.id!))
      // Look ahead for matching tool responses
      for (let j = i + 1; j < messages.length; j++) {
        const toolId = messages[j].tool_call_id
        if (messages[j].role === 'tool' && toolId && expectedIds.has(toolId)) {
          expectedIds.delete(toolId)
        }
        if (messages[j].role === 'assistant') break
      }
      // Inject placeholders for missing tool responses
      if (expectedIds.size > 0) {
        for (const id of expectedIds) {
          messages.splice(i + 1, 0, { role: 'tool', content: JSON.stringify({ output: '', error: '[reconstructed]' }), tool_call_id: id })
          console.warn(`[messages] Injected placeholder tool response for missing call_id: ${id}`)
        }
      }
    }
  }

  // ── #4 Cold resume: session untouched > 24h → compact ──
  const isColdResume = Date.now() - (session.updated_at || 0) > COLD_RESUME_MS
  if (isColdResume && messages.length > systemMessageEnd(messages) + 1) {
    const result = await selectAndSummarize(messages, provider, model)
    if (result.didCompact) {
      messages.length = 0
      messages.push(...result.messages)
      sessionStore.update(sessionId, {
        compaction_summary: result.summary!,
        compaction_until_id: result.compactedUntilId || null,
      })
      console.log(`[session] ${sessionId} cold resume (>24h): compacted to ${result.messages.length} msgs`)
    }
  }

  // ── #4 Snip stale tool results at 60% before considering compaction ──
  const estTokens = estimateTokens(messages)
  if (estTokens > contextWindow * SOFT_COMPACT_RATIO && estTokens < contextWindow * COMPACT_THRESHOLD) {
    const pct = ((estTokens / contextWindow) * 100).toFixed(0)
    console.log(`[session] ${sessionId} context at ${pct}% (soft threshold 50%)`)
  }
  if (shouldSnip(messages, contextWindow)) {
    const snipTokensBefore = estimateTokens(messages)
    const didSnip = trimToolResults(messages)
    if (didSnip) {
      const after = estimateTokens(messages)
      console.log(`[session] ${sessionId} snip: trimmed old tool results (${snipTokensBefore}→${after} tok)`)
    }
  }

  let turn = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0
  let consecutiveErrors = 0
  let overflowCompacted = false
  const toolCallHistory: ToolCallRecord[] = []
  let insightDispatched = false
  const composeCtx: ComposeContext = { systemAlerts: [] }
  let prevPrefixShape: PrefixShape | undefined

  socket.emit('run.started', { session_id: sessionId, context_window: contextWindow })

  while (turn < maxTurns && !signal?.aborted) {
    turn++

    // Log memory every 5 turns
    if (turn % 5 === 0) {
      const mem = process.memoryUsage()
      const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0)
      const totalMB = (mem.heapTotal / 1024 / 1024).toFixed(0)
      const ctxPct = ((estimateTokens(messages) / contextWindow) * 100).toFixed(0)
      console.log(`[session] ${sessionId} turn ${turn}: heap ${heapMB}/${totalMB}MB, ${messages.length} msgs, ctx ${ctxPct}%`)
    }

    // Compose dynamic context into last user message (turn tail)
    const composedMsgs = composeMessages(messages, composeCtx)
    // Persist compose content changes to master array so prefix stays stable across turns
    persistComposeChanges(messages, composedMsgs)

    // Prefix-shape diagnostics: detect what changed versus last request
    const curShape = capturePrefixShape(composedMsgs, tools)
    if (prevPrefixShape) {
      const reasons = compareShapes(prevPrefixShape, curShape)
      if (reasons.length > 0) {
        console.log(`[cache-shape] ${sessionId} turn ${turn}: ${reasons.join(', ')}`)
      }
    } else {
      console.log(`[cache-shape] ${sessionId} turn ${turn}: cold start`)
    }
    prevPrefixShape = curShape

    const result = await innerLoop(composedMsgs,
      tools, provider, model, session.character_id,
      workspace, io, socket, sessionId, signal, opts, turn,
      mcpClients, workspaces, cap,
    )

    totalInputTokens += result.totalInputTokens
    totalOutputTokens += result.totalOutputTokens
    if (result.totalCacheHitTokens) totalCacheHitTokens += result.totalCacheHitTokens
    if (result.totalCacheMissTokens) totalCacheMissTokens += result.totalCacheMissTokens

    if (result.type === 'error') {
      const errMsg = result.error?.toLowerCase() || ''

      if (errMsg.includes('context length') || errMsg.includes('maximum context') || errMsg.includes('context_length') || errMsg.includes('too many tokens')) {
        if (!overflowCompacted) {
          console.log(`[session] ${sessionId} overflow, force compacting and retrying...`)
          const result = await selectAndSummarize(messages, provider, model)
          if (result.didCompact) {
            messages.length = 0
            messages.push(...result.messages)
            overflowCompacted = true
            sessionStore.update(sessionId, {
              compaction_summary: result.summary!,
              compaction_until_id: result.compactedUntilId || null,
            })
            socket.emit('run.compacted', { session_id: sessionId, message: 'Context overflow recovered via compaction' })
            continue
          }
        }
        console.log(`[session] ${sessionId} failed: context overflow (${turn} turns)`)
        socket.emit('run.failed', { session_id: sessionId, error: `Context overflow: ${result.error}` })
        for (const [, client] of mcpClients) {
          await disconnectMCPServer(client).catch(() => {})
        }
        return { status: 'stop', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
      }

      consecutiveErrors++
      if (consecutiveErrors >= 2) {
        console.log(`[session] ${sessionId} failed: 2 consecutive errors (${turn} turns)`)
        socket.emit('run.failed', { session_id: sessionId, error: result.error })
        for (const [, client] of mcpClients) {
          await disconnectMCPServer(client).catch(() => {})
        }
        return { status: 'stop', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
      }
      // First non-context error — report via compose (turn tail), not system message
      composeCtx.systemAlerts!.push(`[System Note] An API error occurred (${result.error}). This may be transient. Please retry your last action with a simpler approach or different strategy.`)
      continue
    }
    consecutiveErrors = 0

    if (result.toolCallRecords) {
      toolCallHistory.push(...result.toolCallRecords)
    }

    messages.push(...result.messages)
    // Consumed compose alerts have been sent; clear for next turn
    composeCtx.systemAlerts = []

    if (result.type === 'sub_agent_request' && result.subAgentRequest) {
      const req = result.subAgentRequest
      try {
        const subResult = await spawnAndRunSubAgent(
          req.task, req.target_character_id,
          session, provider, model,
          req.sub_strategy, signal, 0, io, socket,
        )
        const summary = summarizeAndMerge([subResult])
        const delegateCall = result.toolCalls?.find(tc => tc.function.name === 'delegate_task')
        const toolCallId = delegateCall?.id || `delegate_${Date.now()}`
        const summaryContent = `[Sub-agent "${req.target_character_id}" completed]\n\nSummary: ${summary.summary}\n\nConclusions:\n${summary.conclusions.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
        messages.push({
          role: 'tool',
          content: JSON.stringify({ output: summaryContent }),
          tool_call_id: toolCallId,
        })
        messageStore.addMessage(sessionId, {
          role: 'tool',
          content: JSON.stringify({ output: summaryContent }),
          tool_name: 'delegate_task',
          tool_input: JSON.stringify({ call_id: toolCallId, args: req }),
          tool_output: summaryContent,
          tool_status: 'success',
        })
        socket.emit('tool.completed', {
          session_id: sessionId, tool_call_id: toolCallId,
          tool_name: 'delegate_task', tool_output: summaryContent,
          tool_status: 'success', duration_ms: 0,
        })
      } catch (err: any) {
        const delegateCall = result.toolCalls?.find(tc => tc.function.name === 'delegate_task')
        const toolCallId = delegateCall?.id || `delegate_${Date.now()}`
        const errMsg = `Sub-agent delegation failed: ${err.message || err}`
        messages.push({ role: 'tool', content: JSON.stringify({ error: errMsg }), tool_call_id: toolCallId })
        messageStore.addMessage(sessionId, {
          role: 'tool', content: JSON.stringify({ error: errMsg }),
          tool_name: 'delegate_task', tool_input: JSON.stringify({}),
          tool_output: errMsg, tool_status: 'error',
        })
        socket.emit('tool.completed', {
          session_id: sessionId, tool_call_id: toolCallId,
          tool_name: 'delegate_task', tool_output: errMsg,
          tool_status: 'error', duration_ms: 0,
        })
      }
      continue
    }

    if (result.type === 'task_complete') {
      const completeCall = result.toolCalls?.find(tc => tc.function.name === 'task_complete')
      const toolCallId = completeCall?.id || `complete_${Date.now()}`
      const summaryOutput = result.taskCompleteSummary || 'Task marked complete'
      // Emit summary as assistant delta so the client's streaming renders it
      if (socket && sessionId && summaryOutput) {
        socket.emit('message.delta', { session_id: sessionId, delta: '\n\n' + summaryOutput })
      }
      // Update the last assistant message content with the summary for DB persistence
      if (summaryOutput && sessionId) {
        const msgs = messageStore.getMessages(sessionId)
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
        tool_name: 'task_complete',
        tool_input: JSON.stringify({ call_id: toolCallId }),
        tool_output: summaryOutput,
        tool_status: 'success',
      })
      socket.emit('run.completed', { session_id: sessionId, status: 'task_complete' })
      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        sessionStore.update(sessionId, {
          input_tokens: (session.input_tokens || 0) + totalInputTokens,
          output_tokens: (session.output_tokens || 0) + totalOutputTokens,
        })
      }
      for (const [, client] of mcpClients) {
        await disconnectMCPServer(client).catch(() => {})
      }
      return { status: 'task_complete', sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
    }

    if (result.toolCallRecords?.length && detectDoomLoop(toolCallHistory)) {
      const recent = toolCallHistory.slice(-6)
      const lastTool = recent[recent.length - 1]?.toolName || 'unknown'
      composeCtx.systemAlerts!.push(`[System Alert] Repeated failures detected (last: ${lastTool}). Two strikes with the same tool type — do NOT retry with minor changes. Switch to a completely different tool category.`)
    }

    // Snip stale tool results first (cache-friendly), then compact if still over limit
    if (shouldSnip(messages, contextWindow)) {
      const snipTokensBefore = estimateTokens(messages)
      const didSnip = trimToolResults(messages)
      if (didSnip) {
        const after = estimateTokens(messages)
        console.log(`[session] ${sessionId} turn ${turn}: snip trimmed (${snipTokensBefore}→${after} tok)`)
      }
    }
    if (shouldCompact(messages, contextWindow)) {
      const result = await selectAndSummarize(messages, provider, model)
      if (result.didCompact) {
        messages.length = 0
        messages.push(...result.messages)
        sessionStore.update(sessionId, {
          compaction_summary: result.summary!,
          compaction_until_id: result.compactedUntilId || null,
        })
        socket.emit('run.compacted', { session_id: sessionId, message: 'Context compacted to manage token usage' })
      }
    }

    if (result.type === 'aborted') break
    if (result.type === 'final_answer') {
      if (toolCallHistory.length > 0 && !result.fullText) {
        composeCtx.systemAlerts!.push('[System Note] The task is not complete. Review what you have so far and continue working. Use tools as needed.')
        continue
      }
      break
    }
  }

  // ── #1 Cache diagnostics ──
  const completedStatus: 'cancelled' | 'max_turns' | 'stop' = signal?.aborted ? 'cancelled' : turn >= maxTurns ? 'max_turns' : 'stop'
  const detail = toolCallHistory.length === 0 ? 'stop (no tools used)' : completedStatus
  const totalTokens = totalCacheHitTokens + totalCacheMissTokens
  const hitRatio = totalTokens > 0 ? ((totalCacheHitTokens / totalTokens) * 100).toFixed(1) : 'N/A'
  const finalShape = prevPrefixShape
  console.log(`[session] ${sessionId} completed: ${detail} (${turn} turns, ${toolCallHistory.length} tool calls)`)
  console.log(`[cache] ${sessionId}: hit=${totalCacheHitTokens} miss=${totalCacheMissTokens} ratio=${hitRatio}% system=${finalShape?.systemHash?.slice(0,8)||'?'} tools=${finalShape?.toolsHash?.slice(0,8)||'?'}`)
  socket.emit('run.completed', {
    session_id: sessionId,
    status: completedStatus,
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    cache: { hitTokens: totalCacheHitTokens, missTokens: totalCacheMissTokens, hitRatio },
  })

  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    sessionStore.update(sessionId, {
      input_tokens: (session.input_tokens || 0) + totalInputTokens,
      output_tokens: (session.output_tokens || 0) + totalOutputTokens,
    })
  }

  // Check evolution at session end, not during the loop
  if (!insightDispatched && toolCallHistory.length > 0 && charMeta.memory?.selfEvolution) {
    const cfg = evolutionConfig.get()
    if (cfg.character_id) {
      const insight = detectInsight(toolCallHistory, sessionId, session.character_id, {
        window: cfg.detect_window,
        errorRateThreshold: cfg.error_rate_threshold,
        repetitionCount: cfg.repetition_count,
        highFreqMinCalls: cfg.high_freq_min_calls,
        highFreqMaxUnique: cfg.high_freq_max_unique,
      })
      if (insight) {
        insightDispatched = true
        // Include user's original intent to guide skill creation toward domain tasks
        const firstUserMsg = messages.find(m => m.role === 'user')?.content || ''
        const userGoal = firstUserMsg.length > 200 ? firstUserMsg.slice(0, 200) + '…' : firstUserMsg
        const newEvent = eventService.create({
          source_type: 'agent',
          source_id: session.character_id,
          source_meta: { session_id: session.id, trigger: 'insight_detected', insight },
          assigned_agent_id: cfg.character_id,
          assigned_group_id: cfg.group_id || undefined,
          type: 'once',
          payload: { instruction: `Session: ${session.id}\nDetected: ${insight.description}\n\nUser's original request:\n${userGoal}\n\n${cfg.content || 'Analyze this session and create a skill for the task the user was trying to accomplish.'}` },
          status: 'pending',
          scheduled_at: Date.now(),
        })
        socket?.emit('evolution:insight_created', {
          session_id: session.id,
          insight_type: insight.type,
          description: insight.description,
          notify_enabled: cfg.notify_enabled,
          notify_timeout: cfg.notify_timeout,
        })
      }
    }
  }

  for (const [, client] of mcpClients) {
    await disconnectMCPServer(client).catch(() => {})
  }

  return { status: completedStatus, sessionId, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
}


