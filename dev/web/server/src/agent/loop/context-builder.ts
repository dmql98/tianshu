import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../../config.js'
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

const DATA_DIR = getDataDir()
const DEFAULT_PROMPT_FILE = resolve(DATA_DIR, 'prompts', 'default.md')

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
  // Per-character prompt overrides default
  const charPrompt = resolve(DATA_DIR, 'characters', charId, 'prompt.md')
  const file = existsSync(charPrompt) ? charPrompt : DEFAULT_PROMPT_FILE
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return '## System Prompt\n\n{{GUIDANCE}}'
  }
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
    parts.push(`## Available Skills\n${skillList}\nUse \`skill_manager\` with action="read" to view a skill's full SKILL.md content.`)
    const hints = skillIndex.filter(s => s.attachments.length > 0)
      .map(s => `  ${s.name}: ${s.attachments.join(', ')}`)
    if (hints.length) {
      parts.push(`## Skill Attachments\n${hints.join('\n')}`)
    }
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
}

/** Build the initial provider message list from a session. */
export async function buildInitialMessages(input: SessionContextInput): Promise<LLMMessage[]> {
  const format = resolveProviderFormat(input.providerBaseUrl)
  const messages: LLMMessage[] = [{ role: 'system', content: input.systemPrompt }]
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
