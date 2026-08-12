import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../../config.js'
import { builtinPromptsRoot } from '../../content/paths.js'
import { characterMetaStore, type CharacterRecord } from '../../db/characterStore.js'
import { characterContentStore } from '../../character/store.js'
import { buildSkillIndex } from '../skill-loader.js'
import { normalizeTools } from '../system-cache.js'
import { truncateToolOutput } from '../../tools/truncate.js'
import { reconstructParts, lowerContentToProvider, textPart, resolveProviderFormat, type ProviderCapability, type ProviderFormat } from '../attachments.js'
import type { LLMMessage } from '../../llm/client.js'
import type { MessageRow } from '../../db/messageStore.js'

/**
 * Context builder: resolves workspace/dataspace, assembles the system prompt
 * and converts persisted messages into provider messages. Migrated from
 * agent/outer.ts.
 */

const USER_DEFAULT_PROMPT_FILE = () => resolve(getDataDir(), 'prompts', 'default.md')
const BUILTIN_DEFAULT_PROMPT_FILE = () => resolve(builtinPromptsRoot(), 'default.md')

export function resolveWorkspace(ws: string | null | undefined): string {
  return ws || getDataDir()
}

export function resolveWorkspaces(session: { workspace?: string | null; workspaces?: string | null }): string[] {
  if (session.workspaces) {
    try { return JSON.parse(session.workspaces) }
    catch { /* fall through */ }
  }
  return [resolveWorkspace(session.workspace)]
}

export function resolveDataspace(ds: string | null | undefined): string | undefined {
  return ds || undefined
}

export function loadPromptTemplate(charId: string): string {
  // 优先角色自定义 prompt.md → 用户默认提示词 → 内置只读默认（content/builtin）。
  const charPrompt = resolve(getDataDir(), 'characters', charId, 'prompt.md')
  for (const file of [charPrompt, USER_DEFAULT_PROMPT_FILE(), BUILTIN_DEFAULT_PROMPT_FILE()]) {
    if (existsSync(file)) {
      try { return readFileSync(file, 'utf-8') } catch { /* try next */ }
    }
  }
  return '## System Prompt\n\n{{GUIDANCE}}'
}

export function assembleStaticPrompt(
  charMeta: CharacterRecord,
  charContent: { soul: string; user: string },
  toolDefs: any[],
  workspace: string,
  dataspace?: string,
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
    parts.push(`## Available Skill Packages\n${skillList}\nUse \`skill_manager\` action="describe_package" to inspect a package and action="activate" to load only the child skill needed for this task. Do not replace the character's full skill list.`)
  }

  if (dataspace) {
    parts.push(`## Data Space\nSystem configuration and data root: ${dataspace}`)
  }
  parts.push(`## Workspace\nProject workspace: ${workspace}\nCreate it if it does not exist.`)

  return parts.join('\n\n')
}

export function rowToLLMMessage(
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
    const restored = restoreAssistantToolCalls(row)
    return restored
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

/**
 * Sanitize a persisted assistant tool call so that whatever reaches the
 * provider is always valid JSON. Old history may contain half-serialized
 * `function.arguments` (accident msocwg0bciq5x4) which would make the provider
 * reject the whole request with "arguments must be valid JSON".
 *
 * Strategy: normalize each call; valid ones pass through, invalid ones are
 * rewritten as internal `invalid_tool_call` with JSON-safe arguments. The
 * paired tool result (if any) is left intact so protocol pairing holds.
 */
export function restoreAssistantToolCalls(row: MessageRow): LLMMessage | null {
  let rawCalls: unknown
  try {
    rawCalls = JSON.parse(row.tool_input || '[]')
  } catch {
    return null
  }
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return null

  const calls: import('../../llm/client.js').ToolCall[] = []
  let sanitized = false
  for (const call of rawCalls as Array<{
    id?: string; type?: string;
    function?: { name?: string; arguments?: unknown }
  }>) {
    const id = call?.id || ''
    const name = call?.function?.name || ''
    const argsRaw = call?.function?.arguments
    let argsStr = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw ?? {})

    let parsedOk = false
    try {
      const parsed = JSON.parse(argsStr)
      parsedOk = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    } catch { parsedOk = false }

    if (!parsedOk) {
      // Rewrite the malformed call as a JSON-safe synthetic invalid call.
      const safeArgs = JSON.stringify({
        original_tool: name,
        error: 'invalid_json',
        detail: 'restored from legacy history with unparseable tool arguments',
        argument_preview: argsStr.length > 200 ? argsStr.slice(0, 200) + '…' : argsStr,
      })
      calls.push({
        id, type: 'function',
        function: { name: 'invalid_tool_call', arguments: safeArgs },
      })
      sanitized = true
      console.warn(`[history-sanitize] rewrote invalid tool call id=${id} name=${name} (session ${row.session_id})`)
    } else {
      calls.push({ id, type: 'function', function: { name, arguments: argsStr } })
    }
  }

  if (calls.length === 0) return null
  const msg: LLMMessage = { role: 'assistant', content: row.content || null, tool_calls: calls }
  if (row.reasoning_content) msg.reasoning_content = row.reasoning_content
  if (sanitized) {
    // A sanitized call needs a paired tool result so the conversation is not
    // left with a dangling assistant tool call (provider protocol).
    (msg as any).__sanitized = true
  }
  return msg
}

/** Expand @file/@folder/@url references in a user message (best-effort). */
export async function expandContextReferences(
  m: LLMMessage,
  workspace: string,
  logWarning?: (w: string) => void,
): Promise<LLMMessage> {
  if (m.role !== 'user' || typeof m.content !== 'string') return m
  if (!/@(file|folder|url):/.test(m.content)) return m
  const { preprocessContextReferences } = await import('../context-references.js')
  const refResult = await preprocessContextReferences(m.content, workspace)
  if (!refResult.expanded) return m
  for (const w of refResult.warnings) logWarning?.(w)
  return { ...m, content: refResult.message }
}

/**
 * Ensure every assistant(tool_calls) message has matching tool responses;
 * inject placeholders for missing ones (legacy DB rows).
 */
export function fixOrphanToolCalls(messages: LLMMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls) {
      const expectedIds = new Set(m.tool_calls.filter(tc => tc.id).map(tc => tc.id!))
      for (let j = i + 1; j < messages.length; j++) {
        const toolId = messages[j].tool_call_id
        if (messages[j].role === 'tool' && toolId && expectedIds.has(toolId)) {
          expectedIds.delete(toolId)
        }
        if (messages[j].role === 'assistant') break
      }
      if (expectedIds.size > 0) {
        for (const id of expectedIds) {
          messages.splice(i + 1, 0, { role: 'tool', content: JSON.stringify({ output: '', error: '[reconstructed]' }), tool_call_id: id })
          console.warn(`[messages] Injected placeholder tool response for missing call_id: ${id}`)
        }
      }
    }
  }
}

export interface SessionContextInput {
  characterId: string
  systemPrompt: string
  memory: string | null
  compactionSummary: string | null
  rows: MessageRow[]
  compactionUntilId: number
  providerBaseUrl: string
  cap: ProviderCapability
  workspace: string
  activeSkills?: Array<{ ref: string; body: string }>
}

/** Build the initial provider message list from a session. */
export async function buildInitialMessages(input: SessionContextInput): Promise<LLMMessage[]> {
  const format = resolveProviderFormat(input.providerBaseUrl)
  const messages: LLMMessage[] = [{ role: 'system', content: input.systemPrompt }]
  if (input.activeSkills?.length) {
    messages.push({
      role: 'system',
      content: `## Active Session Skills\n${input.activeSkills.map(skill => `### ${skill.ref}\n${skill.body}`).join('\n\n')}`,
    })
  }
  if (input.memory) {
    messages.push({ role: 'system', content: `## Memory\n${input.memory}` })
  }
  if (input.compactionSummary) {
    messages.push({ role: 'system', content: `[Compacted History]\n${input.compactionSummary}` })
  }
  for (const row of input.rows) {
    if (input.compactionUntilId > 0 && row.id <= input.compactionUntilId) continue
    let m = rowToLLMMessage(row, input.characterId, input.cap, format)
    if (m) {
      m = await expandContextReferences(m, input.workspace)
      ;(m as any).__dbId = row.id
      messages.push(m)
    }
  }
  fixOrphanToolCalls(messages)
  return messages
}

export interface CharacterSnapshotContent {
  meta?: CharacterRecord
  content?: { soul: string; user: string; memory: string }
}

/** Character record + content from a pinned revision snapshot, falling back to live files. */
export function resolveCharacterSnapshot(
  pinned: CharacterSnapshotContent | null,
  characterId: string,
): { meta: CharacterRecord; content: { soul: string; user: string; memory: string } } {
  if (pinned?.meta && pinned.content) {
    return { meta: pinned.meta, content: pinned.content }
  }
  const meta = characterMetaStore.getById(characterId)
  if (!meta) throw new Error(`Character "${characterId}" not found`)
  return { meta, content: characterContentStore.get(characterId) }
}
