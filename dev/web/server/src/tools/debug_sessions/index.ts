import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { ToolModule } from '../types.js'
import { mergeOldDebugTurns } from '../../debug/merge-turns.js'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../../data')
const DEBUG_DIR = resolve(DATA_DIR, 'debug')

export const tool: ToolModule = {
  name: 'debug_sessions',
  description: '读取 debug 会话记录：先合并旧 turn 文件，再返回 data/debug/ 下所有会话的对话内容',
  parameters: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: '按 session ID 过滤（可选）' },
    },
    required: [],
  },
  execute: async (args) => {
    mergeOldDebugTurns(true)

    let sessions: string[]
    try {
      sessions = readdirSync(DEBUG_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      return { output: '暂无 debug 会话记录' }
    }

    const filterId = args.session_id
    if (filterId) {
      sessions = sessions.filter(s => s.includes(filterId))
    }

    if (sessions.length === 0) {
      return { output: filterId ? `未找到匹配 "${filterId}" 的会话` : '暂无 debug 会话记录' }
    }

    function renderTurn(turn: any): string[] {
      const lines: string[] = []
      const req = turn.request
      const res = turn.response
      lines.push(`[Turn ${turn.turn || turn.timestamp || '?'}] Model: ${req?.model || 'unknown'}`)
      if (req?.messages) {
        for (const msg of req.messages) {
          const role = msg.role || '?'
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          lines.push(`  ${role}: ${content}`)
        }
      }
      if (res?.text) {
        lines.push(`  response: ${res.text}`)
      }
      if (res?.reasoning) {
        lines.push(`  reasoning: ${res.reasoning}`)
      }
      if (res?.toolCalls?.length) {
        lines.push(`  tool_calls: ${JSON.stringify(res.toolCalls)}`)
      }
      lines.push('')
      return lines
    }

    const result: string[] = []
    for (const sessionId of sessions) {
      const dir = resolve(DEBUG_DIR, sessionId)

      const mergedFiles = readdirSync(dir)
        .filter(f => f.startsWith('merged_') && f.endsWith('.json'))
        .sort()

      if (mergedFiles.length > 0) {
        result.push(`=== Session: ${sessionId} ===`)
        for (const f of mergedFiles) {
          const raw = readFileSync(resolve(dir, f), 'utf-8')
          const data = JSON.parse(raw)
          result.push(`--- ${f} (${data.turns?.length || 0} turns) ---`)
          if (data.turns) {
            for (const turn of data.turns) {
              result.push(...renderTurn(turn))
            }
          }
        }
        continue
      }

      // No merged file — merge inline then render once
      const turnFiles = readdirSync(dir)
        .filter(f => f.includes('_turn') && f.endsWith('.json'))
        .sort()

      if (turnFiles.length > 0) {
        const turns = turnFiles.map(f => {
          const raw = readFileSync(resolve(dir, f), 'utf-8')
          return JSON.parse(raw)
        })
        result.push(`=== Session: ${sessionId} (${turns.length} turns, inline merged) ===`)
        for (const turn of turns) {
          result.push(...renderTurn(turn))
        }
      }
    }

    return { output: result.join('\n') }
  },
}
