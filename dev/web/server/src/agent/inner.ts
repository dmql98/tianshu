import { messageStore } from '../db/messageStore.js'
import { characterMetaStore, type ToolBinding } from '../db/characterStore.js'
import { streamChatCompletion, type LLMMessage, type ToolCall } from '../llm/client.js'
import { getDangerousTools, validateConstraints } from '../tools/definitions.js'
import { executeTool } from '../tools/executor.js'
import type { ToolResult } from '../tools/types.js'
import { getSessionState, isToolApprovedForSession, approveToolForSession } from './session.js'
import { logLLMCall } from '../debug/llm-logger.js'
import type { Strategy } from './session.js'
import type { Server, Socket } from 'socket.io'
import type { MCPClient } from '../tools/mcp-client.js'
import { resolve as pathResolve, dirname, relative } from 'path'
import { sessionStore } from '../db/sessionStore.js'
import { saveAttachment } from './media-store.js'
import { textPart, mediaPart, lowerContentToProvider, type ProviderCapability, type AttachmentRecord, type ContentPart } from './attachments.js'

import { truncateToolOutput as truncate, truncateError } from '../tools/truncate.js'

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'webfetch', 'websearch'])

export interface ToolCallRecord {
  toolName: string
  hasError: boolean
  error?: string
  args?: string
}

export function detectDoomLoop(toolCallHistory: ToolCallRecord[]): boolean {
  if (toolCallHistory.length < 6) return false
  const recent = toolCallHistory.slice(-6)
  return recent.every(r => r.hasError) || hasRepeatingPattern(recent)
}

function hasRepeatingPattern(recent: ToolCallRecord[]): boolean {
  if (recent.length < 2) return false
  const names = recent.map(r => r.toolName)
  const first = names[0]
  return names.every(n => n === first)
}

function matchToolCall(acc: ToolCall[], tc: ToolCall): ToolCall | undefined {
  if (tc.id) return acc.find(t => t.id === tc.id)
  if (tc.index !== undefined) return acc.find(t => t.index === tc.index)
  return undefined
}

function deepCloneToolCall(tc: ToolCall): ToolCall {
  return { id: tc.id, index: tc.index, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }
}

function isTransientError(errorText: string): boolean {
  const msg = errorText.toLowerCase()
  return msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('timeout') ||
    msg.includes('overloaded') ||
    msg.includes('internal server error') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('service unavailable') ||
    msg.includes('temporarily') ||
    msg.includes('try again')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function checkToolBinding(characterId: string, toolName: string, args: Record<string, string>): string | null {
  const character = characterMetaStore.getById(characterId)
  if (!character) return null
  const bindings = character.tools
  if (!bindings || bindings.length === 0) return `No tools are enabled for this character`
  const binding = bindings.find((t: ToolBinding) =>
    t.name === toolName ||
    (t.name.startsWith('mcp:') && toolName.startsWith('mcp__' + t.name.slice(4) + '__'))
  )
  if (!binding) return `Tool "${toolName}" is not enabled for this character`
  if (binding.constraints) {
    const constraintError = validateConstraints(toolName, args, binding)
    if (constraintError) return constraintError
  }
  return null
}

function checkStrategy(toolName: string, strategy: Strategy): 'allow' | 'ask' | 'deny' {
  const dangerous = getDangerousTools().includes(toolName)
  if (strategy === 'Plan' && dangerous) return 'deny'
  if (strategy === 'Ask' && dangerous) return 'ask'
  return 'allow'
}

export interface SubAgentRequestData {
  task: string
  target_character_id: string
  sub_strategy?: 'Plan' | 'Ask' | 'Bypass'
  instances: number
}

export interface InnerResult {
  type: 'final_answer' | 'tool_calls_executed' | 'error' | 'aborted' | 'sub_agent_request' | 'task_complete'
  messages: LLMMessage[]
  fullText: string
  reasoningText: string
  toolCalls: ToolCall[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens?: number
  totalCacheMissTokens?: number
  error?: string
  toolCallRecords?: ToolCallRecord[]
  subAgentRequest?: SubAgentRequestData
  taskCompleteSummary?: string
}

async function streamWithRetry(
  messages: LLMMessage[],
  tools: any[] | undefined,
  provider: { base_url: string; api_key: string },
  model: string,
  signal?: AbortSignal,
  opts: { thinking?: boolean; reasoning_effort?: string } = {},
  onDelta?: (chunk: any) => void,
): Promise<{ text: string; reasoning: string; toolCalls: ToolCall[]; usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null }> {
  let fullText = ''
  let reasoningText = ''
  let toolCallsAcc: ToolCall[] = []
  let usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) break
    let errorText = ''

    const gen = streamChatCompletion({
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      model, messages, tools, signal,
      thinking: opts.thinking,
      reasoning_effort: opts.reasoning_effort,
    })

    for await (const chunk of gen) {
      if (signal?.aborted) break

      if (chunk.type === 'delta') {
        if (chunk.reasoning) {
          reasoningText += chunk.reasoning
        }
        if (chunk.text) {
          fullText += chunk.text
        }
        if (chunk.tool_calls) {
          for (const tc of chunk.tool_calls) {
            const existing = matchToolCall(toolCallsAcc, tc)
            if (existing) {
              if (tc.function.name) existing.function.name += tc.function.name
              if (tc.function.arguments) existing.function.arguments += tc.function.arguments
            } else {
              toolCallsAcc.push(deepCloneToolCall(tc))
            }
          }
        }
        onDelta?.(chunk)
      }

      if (chunk.type === 'error') {
        errorText = chunk.text || 'LLM error'
        break
      }

      if (chunk.type === 'done' && chunk.usage) {
        usage = {
          input: chunk.usage.input_tokens,
          output: chunk.usage.output_tokens,
          cacheHit: chunk.usage.cache_hit_tokens,
          cacheMiss: chunk.usage.cache_miss_tokens,
        }
      }
    }

    if (signal?.aborted) break
    if (!errorText) break

    if (!isTransientError(errorText) || attempt >= 2) {
      throw new Error(errorText)
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
    await sleep(delay)
  }

  return { text: fullText, reasoning: reasoningText, toolCalls: toolCallsAcc.filter(tc => tc.function.name), usage }
}

export async function innerLoop(
  messages: LLMMessage[],
  tools: any[] | undefined,
  provider: { base_url: string; api_key: string },
  model: string,
  characterId: string,
  workspace: string | undefined,
  io?: Server,
  socket?: Socket,
  sessionId?: string,
  signal?: AbortSignal,
  opts: { thinking?: boolean; reasoning_effort?: string } = {},
  turn: number = 0,
  mcpClients?: Map<string, MCPClient>,
  workspaces?: string[],
  cap?: ProviderCapability,
): Promise<InnerResult> {
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0

  let result
  try {
    result = await streamWithRetry(
      messages, tools, provider, model, signal, opts,
      (chunk) => {
        if (chunk.reasoning && socket) {
          socket.emit('message.delta', { session_id: sessionId, reasoning: chunk.reasoning })
        }
        if (chunk.text && socket) {
          socket.emit('message.delta', { session_id: sessionId, delta: chunk.text })
        }
        if (chunk.type === 'usage' && socket && sessionId) {
          socket.emit('usage', {
            session_id: sessionId,
            input_tokens: chunk.usage?.input_tokens || 0,
            output_tokens: chunk.usage?.output_tokens || 0,
            usage_type: chunk.usage_type || 'stream',
          })
        }
      },
    )
  } catch (err: any) {
    const errorText = err.message || 'LLM error'
    logLLMCall(sessionId, turn, { model, messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })), tools }, { text: '', reasoning: '', toolCalls: [], usage: null }, errorText)
    socket?.emit('run.failed', { session_id: sessionId, error: errorText })
    return { type: 'error', messages: [], fullText: '', reasoningText: '', toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, error: errorText }
  }

  if (signal?.aborted) {
    logLLMCall(sessionId, turn, { model, messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })), tools }, { text: result.text, reasoning: result.reasoning, toolCalls: result.toolCalls, usage: result.usage }, 'aborted')
    return { type: 'aborted', messages: [], fullText: result.text, reasoningText: result.reasoning, toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
  }

  if (result.usage) {
    totalInputTokens += result.usage.input
    totalOutputTokens += result.usage.output
    if (result.usage.cacheHit) totalCacheHitTokens += result.usage.cacheHit
    if (result.usage.cacheMiss) totalCacheMissTokens += result.usage.cacheMiss
  }

  logLLMCall(sessionId, turn, { model, messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })), tools }, { text: result.text, reasoning: result.reasoning, toolCalls: result.toolCalls, usage: result.usage })

  const { text: fullText, reasoning: reasoningText, toolCalls: toolCallsAcc } = result

  const newMessages: LLMMessage[] = []
  if (fullText || toolCallsAcc.length > 0 || reasoningText) {
    if (sessionId) messageStore.addMessage(sessionId, {
      role: 'assistant', content: fullText,
      reasoning_content: reasoningText || null,
      tool_input: toolCallsAcc.length > 0 ? JSON.stringify(toolCallsAcc) : null,
    })
    const msg: LLMMessage = {
      role: 'assistant', content: fullText || null,
      tool_calls: toolCallsAcc.length > 0 ? toolCallsAcc : undefined,
    }
    if (reasoningText) msg.reasoning_content = reasoningText
    newMessages.push(msg)
  }

  if (toolCallsAcc.length === 0) {
    return { type: 'final_answer', messages: newMessages, fullText, reasoningText, toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
  }

  const delegateCall = toolCallsAcc.find(tc => tc.function.name === 'delegate_task')
  if (delegateCall) {
    let args: Record<string, string> = {}
    try { args = JSON.parse(delegateCall.function.arguments) } catch { args = {} }
    // Add stub results for non-signal tools so every tool_call_id has a match
    for (const tc of toolCallsAcc) {
      if (tc.function.name === 'delegate_task') continue
      newMessages.push({ role: 'tool', content: JSON.stringify({ output: '', error: 'Skipped: delegate_task takes priority' }), tool_call_id: tc.id })
    }
    return {
      type: 'sub_agent_request',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens,
      subAgentRequest: {
        task: args.task || '',
        target_character_id: args.target_character_id || '',
        sub_strategy: args.sub_strategy as any,
        instances: parseInt(args.instances as string) || 1,
      },
    }
  }

  const completeCall = toolCallsAcc.find(tc => tc.function.name === 'task_complete')
  if (completeCall) {
    let args: Record<string, string> = {}
    try { args = JSON.parse(completeCall.function.arguments) } catch { args = {} }
    const summary = args.summary || ''
    // Add stub results for non-signal tools so every tool_call_id has a match
    for (const tc of toolCallsAcc) {
      if (tc.function.name === 'task_complete') continue
      newMessages.push({ role: 'tool', content: JSON.stringify({ output: '', error: 'Skipped: task_complete takes priority' }), tool_call_id: tc.id })
    }
    return {
      type: 'task_complete',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens,
      toolCallRecords: [],
      taskCompleteSummary: summary,
    }
  }

  const toolCallRecords: ToolCallRecord[] = []

  // Phase 1: pre-check all tools, separate deny/ask from allow
  const prechecked: { tc: ToolCall; name: string; args: Record<string, string>; argsStr: string; skip: boolean; skipReason?: string }[] = []

  for (const tc of toolCallsAcc) {
    const { name, arguments: argsStr } = tc.function
    let args: Record<string, string> = {}
    try { args = JSON.parse(argsStr) } catch { args = {} }

    const bindingError = checkToolBinding(characterId, name, args)
    if (bindingError) {
      prechecked.push({ tc, name, args, argsStr, skip: true, skipReason: bindingError })
      continue
    }

    const strategyState = sessionId ? getSessionState(sessionId) : { current_strategy: 'Bypass' as Strategy }
    let strategyResult = checkStrategy(name, strategyState.current_strategy)

    if (strategyResult === 'deny') {
      prechecked.push({ tc, name, args, argsStr, skip: true, skipReason: `[Plan] ${name} is not allowed in Plan mode` })
      continue
    }

    if (strategyResult === 'ask') {
      if (!sessionId || !isToolApprovedForSession(sessionId, name)) {
        // Ask sequentially — user approval is interactive, can't batch
        const choice = await new Promise<'once' | 'always' | 'reject'>((resolve) => {
          if (!socket || !sessionId) { resolve('reject'); return }
          socket.emit('approval.requested', { session_id: sessionId, tool_call_id: tc.id, tool_name: `[Ask] ${name}`, tool_input: JSON.stringify(args) })
          const handler = (data: { tool_call_id: string; choice: 'once' | 'always' | 'reject' }) => {
            if (data.tool_call_id === tc.id) { socket.off('approval.respond', handler); resolve(data.choice) }
          }
          socket.on('approval.respond', handler)
          setTimeout(() => { socket.off('approval.respond', handler); resolve('reject') }, 60000)
        })
        if (choice === 'reject') {
          prechecked.push({ tc, name, args, argsStr, skip: true, skipReason: `${name} denied` })
          continue
        }
        if (choice === 'always' && sessionId) {
          approveToolForSession(sessionId, name)
        }
      }
    }

    prechecked.push({ tc, name, args, argsStr, skip: false })
  }

  // Phase 2: emit started events for allowed tools
  const allowed = prechecked.filter(p => !p.skip)
  for (const p of allowed) {
    socket?.emit('tool.started', { session_id: sessionId, tool_call_id: p.tc.id, tool_name: p.name, tool_input: p.argsStr })
  }

  // Phase 3: emit skip results immediately
  for (const p of prechecked) {
    if (!p.skip) continue
    const rec: ToolCallRecord = { toolName: p.name, hasError: true, error: p.skipReason!, args: p.argsStr }
    toolCallRecords.push(rec)
    if (sessionId) {
      messageStore.addMessage(sessionId, { role: 'tool', content: JSON.stringify({ error: p.skipReason }), tool_name: p.name, tool_input: JSON.stringify({ call_id: p.tc.id, args: p.argsStr }), tool_output: p.skipReason!, tool_status: 'error' })
    }
    newMessages.push({ role: 'tool', content: JSON.stringify({ error: p.skipReason }), tool_call_id: p.tc.id })
    socket?.emit('tool.completed', { session_id: sessionId, tool_call_id: p.tc.id, tool_name: p.name, tool_output: p.skipReason!, tool_status: 'error', duration_ms: 0 })
  }

  // Phase 4: execute allowed tools — parallel for read-only, serial for writes
  const readGroup: typeof allowed = []
  const writeGroup: typeof allowed = []

  for (const p of allowed) {
    if (READ_ONLY_TOOLS.has(p.name)) {
      readGroup.push(p)
    } else {
      writeGroup.push(p)
    }
  }

  async function runOne(p: typeof allowed[0]): Promise<void> {
    const startTime = Date.now()

    async function execWithRoots(extraRoots?: string[]): Promise<ToolResult> {
      try {
        return await executeTool(p.name, p.args, workspace || process.cwd(), signal, mcpClients, extraRoots, (chunk) => {
          socket?.emit('tool.output', { session_id: sessionId, tool_call_id: p.tc.id, output: chunk })
        }, workspaces)
      } catch (err: any) {
        return { output: '', error: `${p.name}: ${err.message || String(err)}` }
      }
    }

    let result = await execWithRoots()

    if (result.escaped && sessionId && socket) {
      const escapedPath = result.error?.replace('Path escapes workspace: ', '') || ''
      const absEscapedPath = pathResolve(workspace || process.cwd(), escapedPath)
      // Always approve the PARENT directory, not a specific file
      const approvedDir = dirname(absEscapedPath)
      const choice = await new Promise<'once' | 'always' | 'reject'>((resolve) => {
        socket.emit('approval.requested', {
          session_id: sessionId,
          tool_call_id: p.tc.id,
          tool_name: `[Workspace] ${p.name}`,
          tool_input: JSON.stringify({ ...p.args, _escaped_path: approvedDir }),
        })
        const handler = (data: { tool_call_id: string; choice: 'once' | 'always' | 'reject' }) => {
          if (data.tool_call_id === p.tc.id) { socket.off('approval.respond', handler); resolve(data.choice) }
        }
        socket.on('approval.respond', handler)
        setTimeout(() => { socket.off('approval.respond', handler); resolve('reject') }, 60000)
      })
      if (choice !== 'reject') {
        if (choice === 'always') {
          // Add directory to session's workspaces in DB (persists across restarts)
          let updatedWorkspaces: string[] | undefined
          const dbSession = sessionStore.getById(sessionId)
          if (dbSession) {
            const ws: string[] = dbSession.workspaces ? JSON.parse(dbSession.workspaces) : []
            const isCovered = ws.some((w: string) => !relative(w, approvedDir).startsWith('..'))
            if (!isCovered && !ws.includes(approvedDir)) {
              ws.push(approvedDir)
              sessionStore.update(sessionId, { workspaces: JSON.stringify(ws) })
            }
            updatedWorkspaces = ws
          }
          socket.emit('workspace.updated', {
            session_id: sessionId,
            workspaces: updatedWorkspaces,
          })
        }
        result = await execWithRoots([approvedDir])
      }
    }

    const duration = Date.now() - startTime

    const rec: ToolCallRecord = { toolName: p.name, hasError: !!result.error, error: result.error, args: p.argsStr }
    toolCallRecords.push(rec)

    const toolStatus = result.error ? 'error' : result.escaped ? 'denied' : 'success'

    // Persist any media the tool produced (e.g. webfetch images) through the
    // media pipe, and emit it as multimodal content for vision-capable models.
    let storedAttachments: AttachmentRecord[] | undefined
    let toolContent: string | import('../llm/client.js').LLMMessage['content']
    if (result.attachments && result.attachments.length > 0 && sessionId) {
      storedAttachments = result.attachments.map(a => saveAttachment(sessionId, { filename: a.name, mediaType: a.mime, data: a.data }))
      const parts: ContentPart[] = []
      if (result.output) parts.push(textPart(result.output))
      for (const a of result.attachments) parts.push(mediaPart({ mediaType: a.mime, data: a.data, filename: a.name }))
      toolContent = lowerContentToProvider(parts, cap || { supportsVision: false, supportsFiles: false })
    } else {
      toolContent = JSON.stringify({ output: truncate(result.output || ''), error: truncateError(result.error || '') })
    }

    if (sessionId) {
      messageStore.addMessage(sessionId, { role: 'tool', content: JSON.stringify({ output: result.output, error: result.error }), tool_name: p.name, tool_input: JSON.stringify({ call_id: p.tc.id, args: p.argsStr }), tool_output: result.error || result.output, tool_status: toolStatus, attachments: storedAttachments ? JSON.stringify(storedAttachments) : null })
    }
    newMessages.push({ role: 'tool', content: toolContent, tool_call_id: p.tc.id })
    socket?.emit('tool.completed', { session_id: sessionId, tool_call_id: p.tc.id, tool_name: p.name, tool_output: result.error || result.output, tool_status: toolStatus, duration_ms: duration })
  }

  // Run all read-only tools in parallel, then writes sequentially
  if (readGroup.length > 0) {
    await Promise.all(readGroup.map(runOne))
  }
  for (const p of writeGroup) {
    if (signal?.aborted) break
    await runOne(p)
  }

  if (signal?.aborted) {
    return { type: 'aborted', messages: newMessages, fullText, reasoningText, toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
  }

  return { type: 'tool_calls_executed', messages: newMessages, fullText, reasoningText, toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, toolCallRecords }
}
