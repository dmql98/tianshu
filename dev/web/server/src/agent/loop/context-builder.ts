import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../../config.js'
import { characterMetaStore, type CharacterRecord } from '../../db/characterStore.js'
import { characterContentStore } from '../../character/store.js'
import { messageStore } from '../../db/messageStore.js'
import { buildSkillIndex } from '../skill-loader.js'
import { truncateToolOutput } from '../../tools/truncate.js'
import { pruneToolResultContent } from './tool-result-pruner.js'
import { reconstructParts, lowerContentToProvider, textPart, resolveProviderFormat, type ProviderCapability, type ProviderFormat } from '../attachments.js'
import type { LLMMessage } from '../../llm/client.js'
import type { MessageRow } from '../../db/messageStore.js'

/**
 * Context builder: resolves workspace/dataDir, assembles the system prompt
 * and converts persisted messages into provider messages. Migrated from
 * agent/outer.ts.
 */

const USER_DEFAULT_PROMPT_FILE = () => resolve(getDataDir(), 'prompts', 'default.md')
// 单层化：出厂默认提示词经 seed 落到 <dataDir>/prompts/builtin-default.md。
const BUILTIN_DEFAULT_PROMPT_FILE = () => resolve(getDataDir(), 'prompts', 'builtin-default.md')

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
  dataDir?: string,
): string[] {
  // 每个 part = 一条独立 system 消息（组装顺序即发送顺序：system0=Character,
  // system1=User Info, system2=模板块, …）。轨迹页按消息边界逐条展示，
  // 之后调整组装顺序也能一目了然。字节内容与旧版 join 完全一致
  // （parts.join('\n\n')），仅消息边界不同 → 不改动稳定前缀的字节稳定性。
  // 工具清单不进入 system 文本：工具已通过 API `tools` 参数下发（P2-1），
  // 重复列出既费 token 又会让前缀随工具集变化而失稳。
  const parts: string[] = []

  if (charContent.soul) parts.push(`## Character\n${charContent.soul}`)
  if (charContent.user) parts.push(`## User Info\n${charContent.user}`)

  // Load configurable prompt template
  parts.push(loadPromptTemplate(charMeta.id).trim())

  // Skills: index only (names + descriptions, no bodies — Reasonix #3)
  const skillIndex = buildSkillIndex(charMeta)
  if (skillIndex.length > 0) {
    const skillList = skillIndex.map(s => s.listing).join('\n')
    parts.push(`## Available Skill Packages\n${skillList}\nUse \`skill_manager\` action="describe_package" to inspect a package and action="activate" to load only the child skill needed for this task. Do not replace the character's full skill list.`)
  }

    if (dataDir) {
      parts.push(`## Data Directory\nSystem config & data root: ${dataDir}  (即 <dataDir>：天枢所有配置与数据的根目录，角色/技能/模型服务/MCP 等均位于其下)`)
    }
  parts.push(`## Workspace\nProject workspace: ${workspace}\nCreate it if it does not exist.`)

  return parts
}

/**
 * 结构化工具结果错误判定（P1-2）：优先读 is_error 列，旧数据缺失时回退解析
 * content 字符串（`{output, error}`）。
 */
export function toolResultIsError(row: Pick<MessageRow, 'is_error' | 'content'>): boolean {
  if (row.is_error != null) return row.is_error === 1
  try {
    const parsed = JSON.parse(row.content || '{}')
    return !!(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).error)
  } catch {
    return false
  }
}

export function rowToLLMMessage(
  row: MessageRow,
  sessionId: string,
  cap: ProviderCapability,
  format: ProviderFormat,
  trimmedUntilId = 0,
): LLMMessage | null {
  if (row.role === 'tool') {
    let callId = ''
    try { const p = JSON.parse(row.tool_input || '{}'); if (p.call_id) callId = p.call_id } catch {}
    if (!callId) return null
    let content = row.content || ''
    // P1-2: content 缺失时从结构化列重建（is_error 决定 error 字段归属），
    // 避免依赖解析；旧数据 content 为空时也能产出可发送的消息。
    if (!content) {
      const err = toolResultIsError(row)
      const val = row.tool_output || ''
      content = JSON.stringify(err ? { output: '', error: val } : { output: val, error: '' })
    }
    // Byte-stable pass-through: provider prefix caching matches on the exact
    // stored bytes. Only rewrite the serialized content when an output/error is
    // actually over the length limit and needs truncation; otherwise keep the
    // stored string untouched (JSON.parse+stringify can reorder keys / drop
    // "1.0" floats and silently invalidate every cached prefix).
    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object') {
        const out = parsed as Record<string, unknown>
        let needsRewrite = false
        for (const key of ['output', 'error']) {
          if (typeof out[key] === 'string') {
            const truncated = truncateToolOutput(out[key])
            if (truncated !== out[key]) { out[key] = truncated; needsRewrite = true }
          }
        }
        if (needsRewrite) content = JSON.stringify(parsed)
      }
    } catch {}
    // P0-4: id <= trimmed_until_id 的行在运行中已被 head/tail 剪枝，重载时用
    // 同一实现恢复剪枝后的 content，保证「会话恢复 == 运行中内存态」。
    // 剪枝是确定性的，已剪内容再剪是幂等的，因此幂等安全。
    if (trimmedUntilId > 0 && row.id <= trimmedUntilId) {
      content = pruneToolResultContent(content)
    }
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
 * 修复悬空 assistant(tool_calls)：调用在会话里没有任何 tool 结果的孤儿调用，
 * 从消息里移除（同时把移除持久化到 assistant 行的 tool_input，P2-3）。
 *
 * 幂等性：修复结果写入 DB 后，下次加载读到的是已修复的 tool_input，不再有孤儿
 * 调用 → 不再重复修复/重复告警。旧数据无法持久化（无 __dbId / 无 sessionId）时
 * 仅做内存移除，结果同样确定且幂等（同一输入 → 同一输出）。
 *
 * 替代旧「注入 [reconstructed] 占位」做法：占位无法在 SQLite 按 id 排位插入到
 * 调用之后（会落到会话尾部破坏配对），移除孤儿调用才是可落库且幂等的修复。
 */
export function fixOrphanToolCalls(
  messages: LLMMessage[],
  opts: { sessionId?: string } = {},
): void {
  const orphans: Array<{ msg: LLMMessage; keepIds: string[]; orphanCount: number }> = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) continue
    const allIds = m.tool_calls.filter(tc => tc.id).map(tc => tc.id!)
    const present = new Set<string>()
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === 'assistant') break
      const toolId = messages[j].tool_call_id
      if (messages[j].role === 'tool' && toolId) present.add(toolId)
      if (present.size >= allIds.length) break
    }
    const orphanIds = allIds.filter(id => !present.has(id))
    if (orphanIds.length === 0) continue
    const keepIds = allIds.filter(id => !orphanIds.includes(id))
    orphans.push({ msg: m, keepIds, orphanCount: orphanIds.length })
  }

  for (const { msg, keepIds, orphanCount } of orphans) {
    const dbId = (msg as unknown as { __dbId?: number }).__dbId
    if (opts.sessionId && typeof dbId === 'number') {
      const kept = (msg.tool_calls ?? []).filter(tc => tc.id && keepIds.includes(tc.id)).map(tc => ({
        id: tc.id,
        type: tc.type,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }))
      messageStore.updateToolInput(dbId, JSON.stringify(kept))
    }
    // 内存态同步：移除孤儿调用；全部移除后该消息不再携带 tool_calls。
    if (msg.tool_calls) {
      msg.tool_calls = msg.tool_calls.filter(tc => keepIds.includes(tc.id ?? ''))
      if (msg.tool_calls.length === 0) delete msg.tool_calls
    }
    console.warn(`[messages] Removed ${orphanCount} orphaned tool call(s) without results (session ${opts.sessionId ?? '?'})`)
  }
}

export interface SessionContextInput {
  characterId: string
  /** 静态系统提示的分块（每个 part 一条 system 消息，按组装顺序）。 */
  systemPrompt: string[]
  memory: string | null
  compactionSummary: string | null
  rows: MessageRow[]
  compactionUntilId: number
  /** P0-4: 已被 trimToolResults 剪枝的消息 id 上界（重载时恢复剪枝后 content）。 */
  trimmedUntilId: number
  providerBaseUrl: string
  cap: ProviderCapability
  workspace: string
  activeSkills?: Array<{ ref: string; body: string }>
}

/** Build the initial provider message list from a session. */
export async function buildInitialMessages(input: SessionContextInput): Promise<LLMMessage[]> {
  const format = resolveProviderFormat(input.providerBaseUrl)
  // 静态提示逐块推送为独立 system 消息（组装顺序 = 发送顺序，便于轨迹逐条展示）。
  const messages: LLMMessage[] = input.systemPrompt.map(content => ({ role: 'system', content }))
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
    let m = rowToLLMMessage(row, input.characterId, input.cap, format, input.trimmedUntilId)
    if (m) {
      m = await expandContextReferences(m, input.workspace)
      ;(m as any).__dbId = row.id
      messages.push(m)
    }
  }
  fixOrphanToolCalls(messages, { sessionId: input.characterId })
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
