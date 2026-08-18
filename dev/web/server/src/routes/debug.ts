import { Hono } from 'hono'
import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

/**
 * Debug 会话只读接口：把 devdata/debug/{sessionId}/merged_*.json
 * （llm-logger.ts 写入的「每次 LLM 调用完整请求/响应」）暴露成结构化 API，
 * 供轨迹页「调试详情」视图消费。
 *
 * - GET /api/debug/sessions                        → 所有会话的 merged 文件元数据
 * - GET /api/debug/sessions/:id                    → 单会话的 merged 文件元数据
 * - GET /api/debug/sessions/:id/turns?file=…       → 轻量 turn 元数据（懒加载用）
 * - GET /api/debug/sessions/:id/turn/:n?file=…     → 单 turn 完整详情（含 system prompt / 工具目录 / 消息历史）
 *
 * 安全：session id / file 均做白名单校验，防路径穿越；只读文件系统。
 */

const router = new Hono()

const DEBUG_DIR = () => resolve(getDataDir(), 'debug')

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/
const MERGED_FILE_RE = /^merged_\d+\.json$/

/** 单条内容超过该字符数时，详情接口截断并标记 truncated（系统提示可达数千 token）。 */
const CONTENT_TRUNCATE_CHARS = 64 * 1024

interface DebugTurn {
  turn: number
  timestamp: number
  fp: string
  request: { model: string; messages: unknown[]; tools?: unknown[] }
  response: {
    text: string
    reasoning: string
    toolCalls: unknown[]
    usage: { input: number; output: number } | null
  }
  error?: string
}

interface MergedFileData {
  turns: DebugTurn[]
}

interface MergedFileMeta {
  file: string
  turns: number
  first_ts: number | null
  last_ts: number | null
  fps: string[]
  models: string[]
}

function safeSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id)
}

function safeFileName(file: string): boolean {
  return MERGED_FILE_RE.test(file)
}

function sessionDirs(): string[] {
  try {
    return readdirSync(DEBUG_DIR(), { withFileTypes: true })
      .filter(d => d.isDirectory() && SESSION_ID_RE.test(d.name))
      .map(d => d.name)
      .sort()
  } catch {
    return []
  }
}

function mergedFiles(sessionId: string): string[] {
  try {
    return readdirSync(resolve(DEBUG_DIR(), sessionId))
      .filter(f => MERGED_FILE_RE.test(f))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
  } catch {
    return []
  }
}

function readMerged(sessionId: string, file: string): MergedFileData | null {
  try {
    const raw = readFileSync(resolve(DEBUG_DIR(), sessionId, file), 'utf-8')
    const parsed = JSON.parse(raw) as MergedFileData
    return Array.isArray(parsed.turns) ? parsed : null
  } catch {
    return null
  }
}

function fileMeta(sessionId: string, file: string): MergedFileMeta | null {
  const data = readMerged(sessionId, file)
  if (!data) return null
  const fps = new Set<string>()
  const models = new Set<string>()
  let firstTs: number | null = null
  let lastTs: number | null = null
  for (const turn of data.turns) {
    if (turn.fp) fps.add(turn.fp)
    if (typeof turn.request?.model === 'string') models.add(turn.request.model)
    if (typeof turn.timestamp === 'number') {
      if (firstTs === null || turn.timestamp < firstTs) firstTs = turn.timestamp
      if (lastTs === null || turn.timestamp > lastTs) lastTs = turn.timestamp
    }
  }
  return {
    file,
    turns: data.turns.length,
    first_ts: firstTs,
    last_ts: lastTs,
    fps: [...fps],
    models: [...models],
  }
}

/** 截断超长内容，返回 { content, truncated }。 */
function truncate(content: unknown): { content: string; truncated: boolean } {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  if (text.length <= CONTENT_TRUNCATE_CHARS) return { content: text, truncated: false }
  return { content: `${text.slice(0, CONTENT_TRUNCATE_CHARS)}\n…（已截断，完整内容见文件）`, truncated: true }
}

/** 工具定义按函数名去重（同一会话段内每个 turn 都冗余全量定义）。 */
function dedupeTools(tools: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const tool of tools || []) {
    const name = (tool as any)?.function?.name
    if (typeof name === 'string' && seen.has(name)) continue
    if (typeof name === 'string') seen.add(name)
    out.push(tool)
  }
  return out
}

router.get('/sessions', (c) => {
  const sessions = sessionDirs().map(sessionId => {
    const files = mergedFiles(sessionId)
      .map(file => fileMeta(sessionId, file))
      .filter((meta): meta is MergedFileMeta => meta !== null)
    const totalTurns = files.reduce((sum, meta) => sum + meta.turns, 0)
    return { session_id: sessionId, total_turns: totalTurns, files }
  })
  return c.json({ sessions })
})

router.get('/sessions/:id', (c) => {
  const sessionId = c.req.param('id')
  if (!safeSessionId(sessionId)) return c.json({ error: 'Invalid session id' }, 400)
  const files = mergedFiles(sessionId)
    .map(file => fileMeta(sessionId, file))
    .filter((meta): meta is MergedFileMeta => meta !== null)
  if (files.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ session_id: sessionId, files })
})

router.get('/sessions/:id/turns', (c) => {
  const sessionId = c.req.param('id')
  const file = c.req.query('file') || 'merged_1.json'
  if (!safeSessionId(sessionId)) return c.json({ error: 'Invalid session id' }, 400)
  if (!safeFileName(file)) return c.json({ error: 'Invalid file' }, 400)
  const data = readMerged(sessionId, file)
  if (!data) return c.json({ error: 'Not found' }, 404)
  const turns = data.turns.map(turn => {
    const usage = turn.response?.usage ?? null
    const toolCalls = (turn.response?.toolCalls || []).map((call: any) => {
      let argsPreview = ''
      try {
        const args = typeof call?.function?.arguments === 'string'
          ? JSON.parse(call.function.arguments)
          : call?.function?.arguments
        argsPreview = JSON.stringify(args) ?? ''
      } catch {
        argsPreview = call?.function?.arguments ?? ''
      }
      return {
        name: call?.function?.name ?? '?',
        args_preview: argsPreview.slice(0, 200),
      }
    })
    return {
      turn: turn.turn,
      timestamp: turn.timestamp,
      fp: turn.fp,
      model: turn.request?.model ?? null,
      usage,
      error: typeof turn.error === 'string' ? turn.error : null,
      text_len: turn.response?.text?.length ?? 0,
      reasoning_len: turn.response?.reasoning?.length ?? 0,
      tool_calls: toolCalls,
    }
  })
  return c.json({ session_id: sessionId, file, turns })
})

router.get('/sessions/:id/turn/:turnNo', (c) => {
  const sessionId = c.req.param('id')
  const turnNo = Number(c.req.param('turnNo'))
  const file = c.req.query('file') || 'merged_1.json'
  if (!safeSessionId(sessionId)) return c.json({ error: 'Invalid session id' }, 400)
  if (!safeFileName(file)) return c.json({ error: 'Invalid file' }, 400)
  if (!Number.isInteger(turnNo) || turnNo < 0) return c.json({ error: 'Invalid turn' }, 400)
  const data = readMerged(sessionId, file)
  if (!data) return c.json({ error: 'Not found' }, 404)
  const turn = data.turns.find(t => t.turn === turnNo)
  if (!turn) return c.json({ error: 'Turn not found' }, 404)

  const systemPrompts: string[] = []
  const messages = (turn.request?.messages || []).map((raw: any) => {
    const role = raw?.role ?? '?'
    if (role === 'system' && typeof raw?.content === 'string') systemPrompts.push(raw.content)
    const content = raw?.content
    return {
      role,
      content: content === undefined || content === null ? null : truncate(content).content,
      truncated: typeof content === 'string' && content.length > CONTENT_TRUNCATE_CHARS,
      tool_call_id: typeof raw?.tool_call_id === 'string' ? raw.tool_call_id : undefined,
      tool_calls: Array.isArray(raw?.tool_calls) ? raw.tool_calls : undefined,
    }
  })

  const tools = dedupeTools(turn.request?.tools || [])

  return c.json({
    session_id: sessionId,
    file,
    turn: {
      turn: turn.turn,
      timestamp: turn.timestamp,
      fp: turn.fp,
      model: turn.request?.model ?? null,
      system_prompts: systemPrompts,
      messages,
      tools,
      response: turn.response ?? null,
      error: typeof turn.error === 'string' ? turn.error : null,
    },
  })
})

export default router
