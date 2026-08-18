import { Hono } from 'hono'
import { readdirSync, readFileSync, statSync } from 'fs'
import { resolve, basename } from 'path'
import { getDataDir } from '../config.js'
import { mergeOldDebugTurns } from '../debug/merge-turns.js'

/**
 * Debug 会话只读接口（M1）：
 * 把 devdata/debug 下的 merged_N.json（每次 LLM 调用的完整请求/响应）
 * 暴露成结构化 HTTP API，供轨迹页「调试详情」视图消费。
 *
 * - GET /api/debug/sessions                    → 会话列表（仅元数据）
 * - GET /api/debug/sessions/:id                → 某会话的 turn 概要列表
 * - GET /api/debug/sessions/:id/turns/:turn    → 单个 turn 完整请求/响应
 *
 * 只读文件系统，无写入逻辑；merged 文件可能很大，列表接口只返回元数据。
 */

const router = new Hono()

const DEBUG_DIR = () => resolve(getDataDir(), 'debug')

interface DebugTurnSummary {
  turn: number
  timestamp: number
  fp: string
  model: string
  textLen: number
  reasoningLen: number
  toolCalls: number
  usage: { input: number; output: number; cacheHit?: number; cacheMiss?: number } | null
  error?: string
}

interface MergedFileMeta {
  file: string
  turns: number
  first_ts: number
  last_ts: number
  fp: string
}

function readMergedFiles(sessionId: string): Array<{ file: string; data: { turns: any[] } }> {
  const dir = resolve(DEBUG_DIR(), sessionId)
  const files = readdirSync(dir)
    .filter(f => f.startsWith('merged_') && f.endsWith('.json'))
    .sort()
  return files.map(file => ({
    file,
    data: JSON.parse(readFileSync(resolve(dir, file), 'utf-8')) as { turns: any[] },
  }))
}

function toSummary(turn: any): DebugTurnSummary {
  const req = turn.request || {}
  const res = turn.response || {}
  const usage = res.usage
  return {
    turn: typeof turn.turn === 'number' ? turn.turn : -1,
    timestamp: typeof turn.timestamp === 'number' ? turn.timestamp : 0,
    fp: typeof turn.fp === 'string' ? turn.fp : '',
    model: typeof req.model === 'string' ? req.model : 'unknown',
    textLen: typeof res.text === 'string' ? res.text.length : 0,
    reasoningLen: typeof res.reasoning === 'string' ? res.reasoning.length : 0,
    toolCalls: Array.isArray(res.toolCalls) ? res.toolCalls.length : 0,
    usage: usage && typeof usage === 'object'
      ? {
        input: typeof usage.input === 'number' ? usage.input : 0,
        output: typeof usage.output === 'number' ? usage.output : 0,
        ...(typeof usage.cacheHit === 'number' ? { cacheHit: usage.cacheHit } : {}),
        ...(typeof usage.cacheMiss === 'number' ? { cacheMiss: usage.cacheMiss } : {}),
      }
      : null,
    ...(typeof turn.error === 'string' ? { error: turn.error } : {}),
  }
}

/** 会话列表：只返回目录元数据，不读文件内容。 */
router.get('/sessions', (c) => {
  try {
    mergeOldDebugTurns(true)
  } catch { /* debug 目录不存在时忽略 */ }
  let sessionIds: string[]
  try {
    sessionIds = readdirSync(DEBUG_DIR(), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
  } catch {
    return c.json([])
  }
  const sessions = sessionIds.map(sessionId => {
    const files: MergedFileMeta[] = []
    try {
      for (const merged of readMergedFiles(sessionId)) {
        const turns = merged.data.turns || []
        let firstTs = 0
        let lastTs = 0
        for (const turn of turns) {
          const ts = typeof turn.timestamp === 'number' ? turn.timestamp : 0
          if (firstTs === 0 || ts < firstTs) firstTs = ts
          if (ts > lastTs) lastTs = ts
        }
        files.push({
          file: merged.file,
          turns: turns.length,
          first_ts: firstTs,
          last_ts: lastTs,
          fp: typeof turns[0]?.fp === 'string' ? turns[0].fp : '',
        })
      }
    } catch { /* 单个会话读取失败则跳过 */ }
    return { session_id: sessionId, merged_files: files, total_turns: files.reduce((n, f) => n + f.turns, 0) }
  })
  return c.json(sessions.filter(s => s.total_turns > 0))
})

/** 会话详情：turn 概要列表（不返回 messages/tools 内容，体积可控）。 */
router.get('/sessions/:id', (c) => {
  const sessionId = c.req.param('id')
  let merged: Array<{ file: string; data: { turns: any[] } }>
  try {
    merged = readMergedFiles(sessionId)
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
  const files = merged.map(m => ({
    file: m.file,
    fp: typeof m.data.turns?.[0]?.fp === 'string' ? m.data.turns[0].fp : '',
    turns: (m.data.turns || []).map(toSummary),
  }))
  return c.json({ session_id: sessionId, files })
})

/** 单 turn 完整请求/响应（懒加载用）。 */
router.get('/sessions/:id/turns/:turn', (c) => {
  const sessionId = c.req.param('id')
  const turnNo = Number(c.req.param('turn'))
  if (!Number.isInteger(turnNo) || turnNo < 0) return c.json({ error: 'Invalid turn' }, 400)
  let merged: Array<{ file: string; data: { turns: any[] } }>
  try {
    merged = readMergedFiles(sessionId)
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
  for (const m of merged) {
    const turns = m.data.turns || []
    const turn = turns.find(t => t.turn === turnNo)
    if (turn) {
      return c.json({
        session_id: sessionId,
        file: m.file,
        turn: toSummary(turn),
        request: turn.request || null,
        response: turn.response || null,
        error: typeof turn.error === 'string' ? turn.error : undefined,
        timestamp: typeof turn.timestamp === 'number' ? turn.timestamp : undefined,
      })
    }
  }
  return c.json({ error: 'Turn not found' }, 404)
})

export default router
