import { messageStore } from '../db/messageStore.js'
import { fanOutToSinks } from '../transport/event-sinks.js'
import { characterMetaStore, type ToolBinding } from '../db/characterStore.js'
import { streamChatCompletion, type LLMMessage, type ToolCall, type ProviderConfig } from '../llm/client.js'
import { getDangerousTools, validateConstraints } from '../tools/definitions.js'
import { executeTool } from '../tools/executor.js'
import type { ToolResult, ToolArgs } from '../tools/types.js'
import { getSessionState, isToolApprovedForSession, approveToolForSession } from './session.js'
import { logLLMCall } from './llm-call-store.js'
import type { Strategy } from './session.js'
import { decideToolApproval } from './strategy.js'
import type { TransportBroadcaster } from '../transport/runtime.js'
import type { MCPClient } from '../tools/mcp-client.js'
import { resolve as pathResolve } from 'path'
import { isPathWithin, workspaceApprovalRoot } from '../tools/utils.js'
import { getDataDir } from '../config.js'
import { sessionStore } from '../db/sessionStore.js'
import { saveAttachment } from './media-store.js'
import { textPart, mediaPart, lowerContentToProvider, type ProviderCapability, type AttachmentRecord, type ContentPart } from './attachments.js'

import { truncateToolOutput as truncate, truncateError } from '../tools/truncate.js'
import { isTransientLLMError } from '../llm/errors.js'
import { approvalRegistry } from './runtime/approval-registry.js'
import { CONTROL_TOOL_SET } from './loop/control-registry.js'
import { normalizeToolCalls, buildInvalidToolCall } from './tool-call-normalizer.js'
import { stableArgsHash, estimateTextTokens } from './loop/loop-policy.js'
import { decideWorkspaceApproval } from './workspace-approval.js'

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'webfetch', 'websearch', 'get_time', 'debug_sessions'])

// R5: 工具行 tool_input 里的 args 只保留截断副本（完整参数由 assistant 行的
// tool_calls 承载），避免 write 大 content 在 tool 行与 assistant 行重复全量落库。
const STORED_ARGS_MAX = 4000
function storedToolInput(callId: string, argsStr: string): string {
  const args = argsStr.length > STORED_ARGS_MAX ? `${argsStr.slice(0, STORED_ARGS_MAX)}...(args truncated)` : argsStr
  return JSON.stringify({ call_id: callId, args })
}

/** Outcome category of a tool call for progress assessment (§8.5). */
function outcomeKindFor(name: string): ToolCallRecord['outcomeKind'] {
  if (READ_ONLY_TOOLS.has(name) || name === 'get_goal') return 'read'
  if (name === 'write' || name === 'edit' || name === 'bash') return 'write'
  if (name === 'update_plan_step' || name === 'create_plan' || name === 'submit_result' || name === 'create_goal' || name === 'complete_goal') return 'state_change'
  if (name === 'submit_result' || name === 'update_plan_step') return 'verification'
  if (name.startsWith('mcp__')) return 'other'
  return 'other'
}

/**
 * Write tools report whether they actually changed state via metadata. Exit
 * code alone is not enough (a successful no-op write must NOT count as
 * progress). Defaults to `true` only for tools we know mutate state.
 */
function determineToolChanged(name: string, result: ToolResult): boolean {
  const status = result.metadata?.status
  if (status === 'noop') return false
  if (status === 'updated' || status === 'created') return true
  if (result.metadata?.changed === true) return true
  if (result.metadata?.changed === false) return false
  return (name === 'update_plan_step' || name === 'create_plan' || name === 'create_goal' || name === 'complete_goal') && !result.error
}

// P1-1: token 计量统一走 loop-policy.estimateTextTokens，删除本文件的重复估算器。

export type ToolOutcomeKind = 'read' | 'write' | 'state_change' | 'verification' | 'control' | 'other'

export interface ToolCallRecord {
  toolName: string
  hasError: boolean
  error?: string
  args?: string
  normalizedArgsHash?: string
  outcomeKind?: ToolOutcomeKind
  resultHash?: string
  /** Write tools: true when the executor reports an actual state change. */
  changed?: boolean
  /** Verification evidence key when this call produced verifiable evidence. */
  evidenceKey?: string
}

export { detectDoomLoop } from './loop/completion-evaluator.js'

function matchToolCall(acc: ToolCall[], tc: ToolCall): ToolCall | undefined {
  if (tc.id) return acc.find(t => t.id === tc.id)
  if (tc.index !== undefined) return acc.find(t => t.index === tc.index)
  return undefined
}

function deepCloneToolCall(tc: ToolCall): ToolCall {
  return { id: tc.id, index: tc.index, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function checkToolBinding(characterId: string, toolName: string, args: ToolArgs): string | null {
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
  return decideToolApproval(strategy, { dangerous, readOnly: READ_ONLY_TOOLS.has(toolName) })
}

export interface SubAgentRequestData {
  task: string
  target_character_id: string
  sub_strategy?: Strategy
  instances: number
}

/** P5 同步 barrier：同轮多个 delegate 批量解析结果。 */
export interface SubAgentBatchItem {
  toolCallId: string
  data: SubAgentRequestData
}

export interface SubAgentMessageRequestData {
  sub_session_id: string
  message: string
  sub_strategy?: Strategy
}

export interface InnerResult {
  type: 'final_answer' | 'tool_calls_executed' | 'error' | 'aborted' | 'sub_agent_request' | 'sub_agent_message_request' | 'submit_result' | 'ask_user' | 'create_plan' | 'update_plan_step' | 'create_goal' | 'get_goal' | 'complete_goal'
  messages: LLMMessage[]
  fullText: string
  reasoningText: string
  toolCalls: ToolCall[]
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheHitTokens?: number
  totalCacheMissTokens?: number
  /** 最近一次请求的实际输入 token（上下文真实占用），用于压缩判定；读不到时为 undefined（回退本地估算）。 */
  lastInputTokens?: number
  error?: string
  toolCallRecords?: ToolCallRecord[]
  subAgentRequest?: SubAgentRequestData
  subAgentMessageRequest?: SubAgentMessageRequestData
  /** P5 同步 barrier：同轮全部 delegate 的批量解析结果（成功/失败都由 control-router 收集）。 */
  subAgentBatch?: SubAgentBatchItem[]
  taskCompleteSummary?: string
  evidence?: string[]
  question?: string
  planRequest?: { goal?: string; steps: Array<{ title: string; depends_on?: string; verification?: string }>; verification?: string }
  planStepUpdate?: { ordinal: number; status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'skipped' | 'failed'; evidence?: string }
  goalRequest?: { outcome: string; constraints?: string; verification?: string; budget_tokens?: number }
  goalCompleteSummary?: string
}

export async function streamWithRetry(
  messages: LLMMessage[],
  tools: any[] | undefined,
  provider: ProviderConfig,
  model: string,
  signal?: AbortSignal,
  opts: { thinking?: boolean; reasoning_effort?: string } = {},
  onDelta?: (chunk: any) => void,
  onRetry?: (data: { attempt: number; max_attempts: number; error: string; delay_ms: number }) => void,
): Promise<{ text: string; reasoning: string; toolCalls: ToolCall[]; usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null }> {
  // Accumulators are attempt-local: a retry must start from a clean slate so
  // the previous attempt's partial text, reasoning, or half-built tool
  // arguments can never leak into the successful attempt.
  let committed: { text: string; reasoning: string; toolCalls: ToolCall[]; usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null } | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) break
    let errorText = ''
    let fullText = ''
    let reasoningText = ''
    let toolCallsAcc: ToolCall[] = []
    let usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null = null

    const gen = streamChatCompletion({
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      model, messages, tools, signal,
      thinking: opts.thinking,
      reasoning_effort: opts.reasoning_effort,
      apiStyle: provider.api_style,
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
      }

      if (chunk.type === 'delta' || chunk.type === 'usage') onDelta?.(chunk)

      if (chunk.type === 'error') {
        errorText = chunk.text || 'LLM error'
        break
      }

      if ((chunk.type === 'usage' || chunk.type === 'done') && chunk.usage) {
        usage = {
          input: chunk.usage.input_tokens,
          output: chunk.usage.output_tokens,
          cacheHit: chunk.usage.cache_hit_tokens,
          cacheMiss: chunk.usage.cache_miss_tokens,
        }
      }
    }

    if (signal?.aborted) break
    if (!errorText) {
      committed = { text: fullText, reasoning: reasoningText, toolCalls: toolCallsAcc, usage }
      break
    }

    if (!isTransientLLMError(errorText) || attempt >= 2) {
      throw new Error(errorText)
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
    onRetry?.({ attempt: attempt + 2, max_attempts: 3, error: errorText, delay_ms: delay })
    await sleep(delay)
  }

  if (!committed) {
    throw new Error('LLM stream ended without a successful attempt')
  }
  return committed
}

export async function innerLoop(
  messages: LLMMessage[],
  tools: any[] | undefined,
  provider: ProviderConfig,
  model: string,
  characterId: string,
  workspace: string | undefined,
  broadcaster?: TransportBroadcaster,
  stream?: TransportBroadcaster,
  sessionId?: string,
  signal?: AbortSignal,
  opts: { thinking?: boolean; reasoning_effort?: string; run_id?: string } = {},
  turn: number = 0,
  mcpClients?: Map<string, MCPClient>,
  workspaces?: string[],
  cap?: ProviderCapability,
): Promise<InnerResult> {
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheHitTokens = 0
  let totalCacheMissTokens = 0
  let firstOutputAt: number | null = null
  let streamedOutput = ''

  const liveTokenSpeed = (piece: string): number => {
    if (!piece) return 0
    const now = Date.now()
    if (firstOutputAt == null) firstOutputAt = now
    streamedOutput += piece
    const elapsedSeconds = Math.max((now - firstOutputAt) / 1000, 0.25)
    return estimateTextTokens(streamedOutput) / elapsedSeconds
  }

  let result
  const llmStart = Date.now()
  let firstChunkAt: number | null = null
  try {
    result = await streamWithRetry(
      messages, tools, provider, model, signal, opts,
      (chunk) => {
        if (firstChunkAt === null && (chunk.text || chunk.reasoning)) firstChunkAt = Date.now()
        if (chunk.reasoning && stream) {
          stream.emit('message.delta', {
            session_id: sessionId,
            run_id: opts.run_id,
            reasoning: chunk.reasoning,
            token_speed: liveTokenSpeed(chunk.reasoning),
            token_speed_estimated: true,
          })
        }
        if (chunk.text && stream) {
          stream.emit('message.delta', {
            session_id: sessionId,
            run_id: opts.run_id,
            delta: chunk.text,
            token_speed: liveTokenSpeed(chunk.text),
            token_speed_estimated: true,
          })
        }
        if (chunk.type === 'usage' && stream && sessionId) {
          const inputTokens = chunk.usage?.input_tokens || 0
          stream.emit('usage', {
            session_id: sessionId,
            run_id: opts.run_id,
            input_tokens: inputTokens,
            output_tokens: chunk.usage?.output_tokens || 0,
            cache_hit_tokens: chunk.usage?.cache_hit_tokens || 0,
            cache_miss_tokens: chunk.usage?.cache_miss_tokens || 0,
            usage_type: chunk.usage_type || 'stream',
          })
          // Persist the provider-reported input token count so a reload / page
          // refresh keeps showing the real context usage instead of falling back
          // to the character-based estimate (which jumps the progress bar).
          if (inputTokens > 0) {
            sessionStore.update(sessionId, { context_usage: inputTokens })
          }
        }
      },
      (retry) => stream?.emit('run.retrying', {
        session_id: sessionId,
        run_id: opts.run_id,
        scope: 'request',
        ...retry,
      }),
    )
  } catch (err: any) {
    if (signal?.aborted) {
      // User cancellation is NOT an LLM failure: surface it as 'aborted' so the
      // loop engine exits without emitting run.retrying (which previously made
      // the client re-arm the stop button and look like the click "didn't take").
      return { type: 'aborted', messages: [], fullText: '', reasoningText: '', toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens }
    }
    const errorText = err.message || 'LLM error'
    logLLMCall({ sessionId, runId: opts.run_id, turn, request: { model, messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })), tools }, response: { text: '', reasoning: '', toolCalls: [], usage: null }, error: errorText })
    return { type: 'error', messages: [], fullText: '', reasoningText: '', toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, error: errorText }
  }

  if (signal?.aborted) {
    logLLMCall({ sessionId, runId: opts.run_id, turn, request: { model, messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })), tools }, response: { text: result.text, reasoning: result.reasoning, toolCalls: result.toolCalls, usage: result.usage }, error: 'aborted' })
    const newMessages: LLMMessage[] = []
    if (result.text) {
      if (sessionId) {
        messageStore.addMessage(sessionId, {
          role: 'assistant', content: result.text,
          reasoning_content: result.reasoning || null,
        })
      }
      const msg: LLMMessage = { role: 'assistant', content: result.text }
      if (result.reasoning) msg.reasoning_content = result.reasoning
      newMessages.push(msg)
    }
    return { type: 'aborted', messages: newMessages, fullText: result.text, reasoningText: result.reasoning, toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input }
  }

  if (result.usage) {
    totalInputTokens += result.usage.input
    totalOutputTokens += result.usage.output
    if (result.usage.cacheHit !== undefined) totalCacheHitTokens += result.usage.cacheHit
    if (result.usage.cacheMiss !== undefined) totalCacheMissTokens += result.usage.cacheMiss
  }

  logLLMCall({ sessionId, runId: opts.run_id, turn, request: { model, messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id })), tools }, response: { text: result.text, reasoning: result.reasoning, toolCalls: result.toolCalls, usage: result.usage } })

  const { text: fullText, reasoning: reasoningText, toolCalls: rawToolCalls } = result
  const streamSeconds = firstOutputAt == null ? 0 : Math.max((Date.now() - firstOutputAt) / 1000, 0.05)
  const measuredOutputTokens = result.usage?.output || 0
  const finalTokenSpeed = streamSeconds > 0
    ? (measuredOutputTokens > 0 ? measuredOutputTokens : estimateTextTokens(streamedOutput)) / streamSeconds
    : 0
  const tokenSpeedEstimated = measuredOutputTokens <= 0

  // ── Canonicalize tool calls before anything touches history or execution ──
  // Raw arguments may be truncated/malformed (msocwg0bciq5x4). Invalid calls
  // are rewritten as internal `invalid_tool_call`s whose arguments are always
  // valid JSON; the model can then rewrite the call instead of the turn
  // failing or an empty `{}` reaching a real tool.
  const normalized = normalizeToolCalls(rawToolCalls)
  const toolCallsAcc: ToolCall[] = normalized.calls.map(c => ({
    id: c.id,
    type: 'function' as const,
    function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments) },
  }))
  if (!normalized.ok) {
    for (const f of normalized.failures) {
      const synthetic = buildInvalidToolCall(f.toolId || `inv_${toolCallsAcc.length}_${Date.now()}`, f)
      toolCallsAcc.push({
        id: synthetic.canonical.id,
        type: 'function' as const,
        function: { name: 'invalid_tool_call', arguments: JSON.stringify(synthetic.canonical.function.arguments) },
      })
    }
  }

  const newMessages: LLMMessage[] = []
  if (fullText || toolCallsAcc.length > 0 || reasoningText) {
    if (sessionId) {
      const storedMessage = messageStore.addMessage(sessionId, {
        role: 'assistant', content: fullText,
        reasoning_content: reasoningText || null,
        tool_input: toolCallsAcc.length > 0 ? JSON.stringify(toolCallsAcc) : null,
        token_speed: finalTokenSpeed || null,
      })
      // Cache stats are reported as SESSION CUMULATIVE totals (DB baseline from
      // previous runs + this run's accumulation) so the UI stays consistent
      // with sessions.cache_hit_ratio and updates live during the run.
      const sess = sessionStore.getById(sessionId)
      const hitTotal = (sess?.cache_hit_tokens || 0) + totalCacheHitTokens
      const missTotal = (sess?.cache_miss_tokens || 0) + totalCacheMissTokens
      stream?.emit('message.metrics', {
        session_id: sessionId,
        run_id: opts.run_id,
        message_id: storedMessage.id,
        token_speed: finalTokenSpeed,
        token_speed_estimated: tokenSpeedEstimated,
        // Wall-clock timing for the run-stats strip: whole LLM call (incl.
        // retries), time-to-first-token, and decode span. Persisted as durable
        // message.metrics payload so the stats survive reloads.
        llm_ms: Date.now() - llmStart,
        ttft_ms: firstChunkAt === null ? null : firstChunkAt - llmStart,
        decode_ms: firstOutputAt == null ? null : Date.now() - firstOutputAt,
        cache: {
          hitTokens: hitTotal,
          missTokens: missTotal,
          hitRatio: hitTotal + missTotal > 0
            ? ((hitTotal / (hitTotal + missTotal)) * 100).toFixed(1)
            : 'N/A',
        },
      })
    }
    const msg: LLMMessage = {
      role: 'assistant', content: fullText || null,
      tool_calls: toolCallsAcc.length > 0 ? toolCallsAcc : undefined,
    }
    if (reasoningText) msg.reasoning_content = reasoningText
    newMessages.push(msg)
  }

  if (toolCallsAcc.length === 0) {
    return { type: 'final_answer', messages: newMessages, fullText, reasoningText, toolCalls: [], totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input }
  }

  const delegateCall = toolCallsAcc.find(tc => tc.function.name === 'delegate_to_agent')
  const controlCalls = toolCallsAcc.filter(tc => CONTROL_TOOL_SET.has(tc.function.name))
  if (controlCalls.length > 0 && toolCallsAcc.length !== 1) {
    const error = 'Protocol error: control actions must be the only tool call in a model turn. Recovery: re-issue the ordinary tool call(s) now, then send the control action alone in a following turn.'
    for (const tc of toolCallsAcc) {
      newMessages.push({ role: 'tool', content: JSON.stringify({ error }), tool_call_id: tc.id })
      if (sessionId) {
        messageStore.addMessage(sessionId, {
          role: 'tool',
          content: JSON.stringify({ error }),
          tool_name: tc.function.name,
          tool_input: JSON.stringify({ call_id: tc.id, args: tc.function.arguments }),
          tool_output: error,
          tool_status: 'error',
          is_error: 1,
        })
      }
      stream?.emit('control.rejected', {
        session_id: sessionId,
        run_id: opts.run_id,
        tool_call_id: tc.id,
        reason: error,
      })
    }
    return {
      type: 'tool_calls_executed',
      messages: newMessages,
      fullText,
      reasoningText,
      toolCalls: toolCallsAcc,
      totalInputTokens,
      totalOutputTokens,
      totalCacheHitTokens,
      totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: toolCallsAcc.map(tc => ({
        toolName: tc.function.name,
        hasError: true,
        error,
        args: tc.function.arguments,
        normalizedArgsHash: stableArgsHash(JSON.parse(tc.function.arguments)),
        outcomeKind: 'control' as const,
      })),
    }
  }
  const delegateCalls = toolCallsAcc.filter(tc => tc.function.name === 'delegate_to_agent')
  if (delegateCalls.length > 0) {
    // P5 同步 barrier：同轮所有 delegate 批量并行拉起，全部完成后父 LLM 才收到结果。
    // 同轮混入的非 delegate 工具本轮不执行（生成占位结果保持协议配对完整），
    // 由父 LLM 在下一轮执行。
    const batch: SubAgentBatchItem[] = []
    for (const tc of delegateCalls) {
      let args: Record<string, string> = {}
      try { args = JSON.parse(tc.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + tc.function.name + '): ' + (err?.message || err)) }
      batch.push({
        toolCallId: tc.id,
        data: {
          task: args.task || '',
          target_character_id: args.target_character_id || '',
          sub_strategy: args.sub_strategy as any,
          instances: parseInt(args.instances as string) || 1,
        },
      })
    }
    for (const tc of toolCallsAcc) {
      if (tc.function.name === 'delegate_to_agent') continue
      const note = '本轮包含子代理委托（delegate_to_agent），普通工具调用被推迟：请在本轮子任务全部完成后，下一轮再执行该工具。'
      newMessages.push({ role: 'tool', content: JSON.stringify({ error: note }), tool_call_id: tc.id })
      if (sessionId) {
        messageStore.addMessage(sessionId, {
          role: 'tool', content: JSON.stringify({ error: note }),
          tool_name: tc.function.name, tool_input: JSON.stringify({ call_id: tc.id, args: tc.function.arguments }),
          tool_output: note, tool_status: 'error', is_error: 1,
        })
      }
      stream?.emit('tool.completed', {
        session_id: sessionId, run_id: opts.run_id, tool_call_id: tc.id,
        tool_name: tc.function.name, tool_output: note, tool_status: 'error', duration_ms: 0,
      })
    }
    return {
      type: 'sub_agent_request',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      subAgentBatch: batch,
    }
  }

  const subMsgCall = toolCallsAcc.find(tc => tc.function.name === 'send_message_to_subagent')
  if (subMsgCall) {
    let args: Record<string, string> = {}
    try { args = JSON.parse(subMsgCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + subMsgCall.function.name + '): ' + (err?.message || err)) }
    return {
      type: 'sub_agent_message_request',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      subAgentMessageRequest: {
        sub_session_id: args.sub_session_id || '',
        message: args.message || '',
        sub_strategy: args.sub_strategy as any,
      },
    }
  }

  const submitCall = toolCallsAcc.find(tc => tc.function.name === 'submit_result')
  if (submitCall) {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(submitCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + submitCall.function.name + '): ' + (err?.message || err)) }
    const summary = typeof args.summary === 'string' ? args.summary : ''
    const evidence = Array.isArray(args.evidence)
      ? (args.evidence as unknown[]).filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      : []
    return {
      type: 'submit_result',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
      taskCompleteSummary: summary,
      evidence,
    }
  }

  const askUserCall = toolCallsAcc.find(tc => tc.function.name === 'ask_user')
  if (askUserCall) {
    let args: Record<string, string> = {}
    try { args = JSON.parse(askUserCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + askUserCall.function.name + '): ' + (err?.message || err)) }
    return {
      type: 'ask_user',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
      question: args.question || '',
    }
  }

  const planCall = toolCallsAcc.find(tc => tc.function.name === 'create_plan')
  if (planCall) {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(planCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + planCall.function.name + '): ' + (err?.message || err)) }
    const steps = Array.isArray(args.steps)
      ? (args.steps as Array<Record<string, unknown>>)
        .filter(s => typeof s?.title === 'string' && s.title.trim())
        .map(s => ({
          title: String(s.title).trim(),
          depends_on: typeof s.depends_on === 'string' ? s.depends_on : undefined,
          verification: typeof s.verification === 'string' ? s.verification : undefined,
        }))
      : []
    return {
      type: 'create_plan',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
      planRequest: {
        goal: typeof args.goal === 'string' ? args.goal : undefined,
        verification: typeof args.verification === 'string' ? args.verification : undefined,
        steps,
      },
    }
  }

  const updatePlanStepCall = toolCallsAcc.find(tc => tc.function.name === 'update_plan_step')
  if (updatePlanStepCall) {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(updatePlanStepCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + updatePlanStepCall.function.name + '): ' + (err?.message || err)) }
    const allowedStatuses = new Set(['pending', 'in_progress', 'blocked', 'completed', 'skipped', 'failed'])
    const ordinal = typeof args.ordinal === 'number' ? Math.trunc(args.ordinal) : Number(args.ordinal)
    const status = typeof args.status === 'string' && allowedStatuses.has(args.status) ? args.status : 'pending'
    return {
      type: 'update_plan_step',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
      planStepUpdate: {
        ordinal,
        status: status as NonNullable<InnerResult['planStepUpdate']>['status'],
        evidence: typeof args.evidence === 'string' ? args.evidence.trim() : undefined,
      },
    }
  }

  const createGoalCall = toolCallsAcc.find(tc => tc.function.name === 'create_goal')
  if (createGoalCall) {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(createGoalCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + createGoalCall.function.name + '): ' + (err?.message || err)) }
    return {
      type: 'create_goal',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
      goalRequest: {
        outcome: typeof args.outcome === 'string' ? args.outcome.trim() : '',
        constraints: typeof args.constraints === 'string' ? args.constraints.trim() : undefined,
        verification: typeof args.verification === 'string' ? args.verification.trim() : undefined,
        budget_tokens: typeof args.budget_tokens === 'number' ? Math.trunc(args.budget_tokens) : undefined,
      },
    }
  }

  const getGoalCall = toolCallsAcc.find(tc => tc.function.name === 'get_goal')
  if (getGoalCall) {
    return {
      type: 'get_goal',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
    }
  }

  const completeGoalCall = toolCallsAcc.find(tc => tc.function.name === 'complete_goal')
  if (completeGoalCall) {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(completeGoalCall.function.arguments) } catch (err: any) { throw new Error('Internal error: control tool arguments failed to parse after canonicalization (' + completeGoalCall.function.name + '): ' + (err?.message || err)) }
    return {
      type: 'complete_goal',
      messages: newMessages, fullText, reasoningText,
      toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input,
      toolCallRecords: [],
      goalCompleteSummary: typeof args.summary === 'string' ? args.summary.trim() : undefined,
    }
  }

  const toolCallRecords: ToolCallRecord[] = []

  // invalid_tool_call never reaches the real executor: it is a synthetic error
  // surface so the model can rewrite the malformed call. Fixed tool error,
  // no permissions prompt, no side effects.
  const invalidCalls = toolCallsAcc.filter(tc => tc.function.name === 'invalid_tool_call')
  for (const tc of invalidCalls) {
    const errorText = `模型生成了无效工具参数：${tc.function.arguments}`
    toolCallRecords.push({
      toolName: 'invalid_tool_call', hasError: true, error: errorText, args: tc.function.arguments,
      normalizedArgsHash: stableArgsHash(JSON.parse(tc.function.arguments)),
      outcomeKind: 'control',
    })
    if (sessionId) {
      messageStore.addMessage(sessionId, {
        role: 'tool', content: JSON.stringify({ error: errorText }),
        tool_name: 'invalid_tool_call', tool_input: JSON.stringify({ call_id: tc.id, args: tc.function.arguments }),
        tool_output: errorText, tool_status: 'error', is_error: 1,
      })
    }
    newMessages.push({ role: 'tool', content: JSON.stringify({ error: errorText }), tool_call_id: tc.id })
    stream?.emit('tool.completed', { session_id: sessionId, run_id: opts.run_id, tool_call_id: tc.id, tool_name: 'invalid_tool_call', tool_output: errorText, tool_status: 'error', duration_ms: 0 })
  }

  // Phase 1: pre-check all tools, separate deny/ask from allow
  const prechecked: { tc: ToolCall; name: string; args: ToolArgs; argsStr: string; skip: boolean; skipReason?: string }[] = []

  for (const tc of toolCallsAcc) {
    const { name, arguments: argsStr } = tc.function
    if (name === 'invalid_tool_call') continue // handled above
    // Arguments were canonicalized before persistence, so this parse must
    // succeed; a failure here is a programming error, never a silent `{}`.
    let args: ToolArgs
    try { args = JSON.parse(argsStr) } catch (err: any) {
      throw new Error(`Internal error: tool arguments failed to parse after canonicalization (${name}): ${err?.message}`)
    }

    const bindingError = checkToolBinding(characterId, name, args)
    if (bindingError) {
      prechecked.push({ tc, name, args, argsStr, skip: true, skipReason: bindingError })
      continue
    }

    const strategyState = sessionId ? getSessionState(sessionId) : { current_strategy: 'Auto Approve' as Strategy }
    let strategyResult = checkStrategy(name, strategyState.current_strategy)

    if (strategyResult === 'deny') {
      prechecked.push({ tc, name, args, argsStr, skip: true, skipReason: `[Read Only] ${name} is not allowed in read-only mode` })
      continue
    }

    if (strategyResult === 'ask') {
      if (!sessionId || !isToolApprovedForSession(sessionId, name)) {
        // Ask sequentially — user approval is interactive, can't batch
        const choice = await new Promise<'once' | 'always' | 'reject'>((resolve) => {
          if (!stream || !sessionId) { resolve('reject'); return }
          stream.emit('approval.requested', { session_id: sessionId, run_id: opts.run_id, tool_call_id: tc.id, tool_name: `[${strategyState.current_strategy}] ${name}`, tool_input: JSON.stringify(args) })
          approvalRegistry.register(sessionId, tc.id, opts.run_id, resolve)
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
  // submit_result is a control action handled by the loop (control-router),
  // not a real tool. Executing it through the registry would emit a bogus
  // "Unknown tool: submit_result" card, so exclude it from the normal tool
  // lifecycle (it stays in `prechecked` as non-skip, so Phase 3 won't emit a
  // spurious error card either — control-router owns its tool events).
  const allowed = prechecked.filter(p => !p.skip && p.name !== 'submit_result')
  for (const p of allowed) {
    stream?.emit('tool.started', { session_id: sessionId, run_id: opts.run_id, tool_call_id: p.tc.id, tool_name: p.name, tool_input: p.argsStr })
  }

  // Phase 3: emit skip results immediately
  for (const p of prechecked) {
    if (!p.skip) continue
    const rec: ToolCallRecord = {
      toolName: p.name, hasError: true, error: p.skipReason!, args: p.argsStr,
      normalizedArgsHash: stableArgsHash(p.args),
      outcomeKind: outcomeKindFor(p.name),
    }
    toolCallRecords.push(rec)
    if (sessionId) {
      messageStore.addMessage(sessionId, { role: 'tool', content: JSON.stringify({ error: p.skipReason }), tool_name: p.name, tool_input: storedToolInput(p.tc.id, p.argsStr), tool_output: p.skipReason!, tool_status: 'error', is_error: 1 })
    }
    newMessages.push({ role: 'tool', content: JSON.stringify({ error: p.skipReason }), tool_call_id: p.tc.id })
    stream?.emit('tool.completed', { session_id: sessionId, run_id: opts.run_id, tool_call_id: p.tc.id, tool_name: p.name, tool_output: p.skipReason!, tool_status: 'error', duration_ms: 0 })
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

    // ── tool.output 服务端合并（R10）──
    // bash 等工具以 chunk 频率回调 onOutput（Node child stdout 'data' 事件，
    // 每秒可达数百次）。若每 chunk 一次 stream.emit('tool.output')，SSE 会以
    // 同等频率写帧：writeSSE 无背压地入队，几十万字节输出时写端积压、
    // EventSource 连接假死——表现正是"连续几个 bash 后前端不动了，刷新后
    // 工具事件批量补出"。这里把 chunk 合并到 ~50ms 窗口（与前端 chatStore 的
    // 合并缓冲对齐），把 SSE 帧率从 O(chunk) 降到 O(20/s)；tool.completed
    // 前强制 flush 一次，保证最终内容不丢。
    let pendingOutput = ''
    let outputTimer: ReturnType<typeof setTimeout> | null = null
    const flushOutput = () => {
      if (outputTimer) { clearTimeout(outputTimer); outputTimer = null }
      if (!pendingOutput) return
      const output = pendingOutput
      pendingOutput = ''
      stream?.emit('tool.output', { session_id: sessionId, run_id: opts.run_id, tool_call_id: p.tc.id, output })
    }
    const onOutput = (chunk: string) => {
      pendingOutput += chunk
      if (!outputTimer) {
        outputTimer = setTimeout(() => {
          outputTimer = null
          flushOutput()
        }, 50)
      }
    }

    async function execWithRoots(extraRoots?: string[]): Promise<ToolResult> {
      try {
        return await executeTool(p.name, p.args, workspace || getDataDir(), signal, mcpClients, extraRoots, onOutput, workspaces, sessionId)
      } catch (err: any) {
        return { output: '', error: `${p.name}: ${err.message || String(err)}` }
      }
    }

    let result = await execWithRoots()

    if (result.escaped && sessionId) {
      const escapedPath = result.error?.replace('Path escapes workspace: ', '') || ''
      const absEscapedPath = pathResolve(workspace || getDataDir(), escapedPath)
      // File requests authorize their containing directory; directory
      // requests keep that directory as the least useful permission scope.
      const approvedPath = workspaceApprovalRoot(absEscapedPath)
      const strategy = getSessionState(sessionId).current_strategy
      const choice = await decideWorkspaceApproval(strategy, () =>
        new Promise<'once' | 'always' | 'reject'>((resolve) => {
          if (!stream) { resolve('reject'); return }
          stream.emit('approval.requested', {
            session_id: sessionId,
            run_id: opts.run_id,
            tool_call_id: p.tc.id,
            tool_name: p.name,
            tool_input: JSON.stringify(p.args),
            approval_kind: 'workspace',
            requested_path: absEscapedPath,
            permission_root: approvedPath,
          })
          approvalRegistry.register(sessionId, p.tc.id, opts.run_id, resolve)
        })
      )
      if (choice !== 'reject') {
        if (choice === 'always') {
          let updatedWorkspaces: string[] | undefined
          const dbSession = sessionStore.getById(sessionId)
          if (dbSession) {
            const ws: string[] = dbSession.workspaces
              ? JSON.parse(dbSession.workspaces)
              : dbSession.workspace ? [dbSession.workspace] : []
            const isCovered = ws.some((w: string) => isPathWithin(w, approvedPath))
            if (!isCovered && !ws.includes(approvedPath)) {
              ws.push(approvedPath)
              sessionStore.update(sessionId, { workspaces: JSON.stringify(ws) })
            }
            updatedWorkspaces = ws
          }
          stream?.emit('workspace.updated', {
            session_id: sessionId,
            workspaces: updatedWorkspaces,
          })
          fanOutToSinks('workspace.updated', {
            session_id: sessionId,
            workspaces: updatedWorkspaces,
          })
          // Also update the in-memory workspaces so subsequent calls in this turn see it
          if (workspaces && !workspaces.some(w => isPathWithin(w, approvedPath))) {
            workspaces.push(approvedPath)
          }
        }
        result = await execWithRoots([approvedPath])
      }
    }

    const duration = Date.now() - startTime

    // 工具结束：强制 flush 最后一段缓冲的 output，再发 tool.completed。
    flushOutput()

    // Result hash: stable over the tool outcome so identical calls with the
    // same result are recognized as repeats. Full outputs never enter the
    // record (RUN_LIMIT_POLICY_PLAN §8.5).
    const outcomeHash = result.metadata?.hash
      ? String(result.metadata.hash)
      : result.error
        ? `err:${stableArgsHash(result.error.slice(0, 500))}`
        : stableArgsHash(result.output.slice(0, 2000))
    const changed = determineToolChanged(p.name, result)

    const rec: ToolCallRecord = {
      toolName: p.name, hasError: !!result.error, error: result.error, args: p.argsStr,
      normalizedArgsHash: stableArgsHash(p.args),
      outcomeKind: outcomeKindFor(p.name),
      resultHash: outcomeHash,
      changed,
      evidenceKey: result.metadata?.evidence_key ? String(result.metadata.evidence_key) : undefined,
    }
    toolCallRecords.push(rec)

    const toolStatus = result.error ? 'error' : result.escaped ? 'denied' : 'success'

    // R1+R2 (P2): 落库/事件里的 tool_output 用截断后展示文本，避免全量输出进前端与
    // run_events。完整输出仍在 content 列（全量）承载，重放 rowToLLMMessage 对其做
    // 确定性 truncateToolOutput（sha256 内容寻址），因此 content 不可改为截断版。
    const displayOutput = result.error || truncate(result.output || '')

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

    const toolMsg: LLMMessage = { role: 'tool', content: toolContent, tool_call_id: p.tc.id }
    if (sessionId) {
      const stored = messageStore.addMessage(sessionId, { role: 'tool', content: JSON.stringify({ output: truncate(result.output || ''), error: truncateError(result.error || '') }), tool_name: p.name, tool_input: storedToolInput(p.tc.id, p.argsStr), tool_output: displayOutput, tool_status: toolStatus, attachments: storedAttachments ? JSON.stringify(storedAttachments) : null, is_error: result.error && !result.escaped ? 1 : 0 })
      // P0-4: 给运行中的 tool 消息附带 DB id，供 trimToolResults 记录
      // trimmed_until_id 水印，重载时按同一剪枝实现恢复一致的内存态。
      ;(toolMsg as any).__dbId = stored.id
    }
    newMessages.push(toolMsg)
    stream?.emit('tool.completed', { session_id: sessionId, run_id: opts.run_id, tool_call_id: p.tc.id, tool_name: p.name, tool_output: displayOutput, tool_status: toolStatus, duration_ms: duration })
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
    return { type: 'aborted', messages: newMessages, fullText, reasoningText, toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input }
  }

  return { type: 'tool_calls_executed', messages: newMessages, fullText, reasoningText, toolCalls: toolCallsAcc, totalInputTokens, totalOutputTokens, totalCacheHitTokens, totalCacheMissTokens, lastInputTokens: result.usage?.input, toolCallRecords }
}
