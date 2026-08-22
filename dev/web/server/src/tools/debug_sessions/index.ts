import type { ToolModule } from '../types.js'
import { llmCallsForSession, sessionsWithLLMCalls, rowToLLMCall } from '../../agent/llm-call-store.js'

/**
 * Read the per-LLM-call trace store (llm_calls table). Replaces the old
 * file-based debug/merged_N.json logger: every LLM call's complete request
 * snapshot and response are now in the DB.
 */
export const tool: ToolModule = {
  name: 'debug_sessions',
  description: '读取会话的完整 LLM 调用轨迹（llm_calls 表）：每次调用的请求快照与响应。可用 session_id 过滤。',
  parameters: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: '按 session ID 过滤（可选）' },
    },
    required: [],
  },
  execute: async (args) => {
    let sessions = sessionsWithLLMCalls()
    if (sessions.length === 0) {
      return { output: '暂无 LLM 调用记录' }
    }

    const filterId = args.session_id != null ? String(args.session_id) : undefined
    if (filterId) {
      sessions = sessions.filter(s => s.includes(filterId))
    }

    if (sessions.length === 0) {
      return { output: filterId ? `未找到匹配 "${filterId}" 的会话` : '暂无 LLM 调用记录' }
    }

    function renderCall(row: ReturnType<typeof llmCallsForSession>[number]): string[] {
      const call = rowToLLMCall(row)
      const lines: string[] = []
      const req = call.request
      const res = call.response
      lines.push(`[Turn ${row.turn_no}] Model: ${req.model}${row.fp ? ` (fp: ${row.fp})` : ''}${row.error ? ` ERROR: ${row.error}` : ''}`)
      if (req.messages) {
        for (const msg of req.messages as Array<{ role?: string; content?: unknown }>) {
          const role = msg.role || '?'
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          lines.push(`  ${role}: ${content}`)
        }
      }
      if (res.text) lines.push(`  response: ${res.text}`)
      if (res.reasoning) lines.push(`  reasoning: ${res.reasoning}`)
      if (res.toolCalls && res.toolCalls.length) lines.push(`  tool_calls: ${JSON.stringify(res.toolCalls)}`)
      if (res.usage && (res.usage.input || res.usage.output)) {
        lines.push(`  usage: in=${res.usage.input} out=${res.usage.output} cacheHit=${res.usage.cacheHit ?? 0} cacheMiss=${res.usage.cacheMiss ?? 0}`)
      }
      lines.push('')
      return lines
    }

    const result: string[] = []
    for (const sessionId of sessions) {
      const calls = llmCallsForSession(sessionId)
      if (calls.length === 0) continue
      result.push(`=== Session: ${sessionId} (${calls.length} LLM calls) ===`)
      for (const call of calls) {
        result.push(...renderCall(call))
      }
    }

    return { output: result.join('\n') }
  },
}
