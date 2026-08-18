import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import debugRouter from '../src/routes/debug.js'

/**
 * debug 路由冒烟测试：
 * - GET /api/debug/sessions → 会话列表元数据
 * - GET /api/debug/sessions/:id → turn 概要
 * - GET /api/debug/sessions/:id/turns/:turn → 完整请求/响应
 * - 404 / 400 分支
 *
 * 依赖 TIANSHU_DATA_DIR 指向含 devdata/debug 的目录（由 vitest 环境注入）。
 */
function makeApp(): Hono {
  return new Hono().route('/api/debug', debugRouter)
}

describe('debug routes', () => {
  it('lists sessions with merged file metadata', async () => {
    const app = makeApp()
    const res = await app.request('/api/debug/sessions')
    expect(res.status).toBe(200)
    const sessions = await res.json() as Array<{
      session_id: string
      merged_files: Array<{ file: string; turns: number }>
      total_turns: number
    }>
    expect(Array.isArray(sessions)).toBe(true)
    if (sessions.length > 0) {
      const s = sessions[0]
      expect(typeof s.session_id).toBe('string')
      expect(Array.isArray(s.merged_files)).toBe(true)
      expect(s.total_turns).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns turn summaries for a real session', async () => {
    const app = makeApp()
    const listRes = await app.request('/api/debug/sessions')
    const sessions = await listRes.json() as Array<{ session_id: string }>
    if (sessions.length === 0) return // 无 debug 数据时跳过
    const res = await app.request(`/api/debug/sessions/${sessions[0].session_id}`)
    expect(res.status).toBe(200)
    const body = await res.json() as { files: Array<{ file: string; turns: Array<{ turn: number; model: string }> }> }
    expect(Array.isArray(body.files)).toBe(true)
    expect(body.files.length).toBeGreaterThan(0)
    const firstFile = body.files[0]
    expect(typeof firstFile.file).toBe('string')
    if (firstFile.turns.length > 0) {
      expect(typeof firstFile.turns[0].turn).toBe('number')
      expect(typeof firstFile.turns[0].model).toBe('string')
    }
  })

  it('returns full request/response for a single turn', async () => {
    const app = makeApp()
    const listRes = await app.request('/api/debug/sessions')
    const sessions = await listRes.json() as Array<{ session_id: string }>
    if (sessions.length === 0) return
    const detailRes = await app.request(`/api/debug/sessions/${sessions[0].session_id}`)
    const detail = await detailRes.json() as {
      files: Array<{ turns: Array<{ turn: number }> }>
    }
    const firstTurn = detail.files[0]?.turns[0]
    if (!firstTurn) return
    const res = await app.request(
      `/api/debug/sessions/${sessions[0].session_id}/turns/${firstTurn.turn}`,
    )
    expect(res.status).toBe(200)
    const body = await res.json() as {
      request: { model: string; messages: unknown[]; tools?: unknown[] }
      response: { text?: string; toolCalls?: unknown[] }
      turn: { turn: number }
    }
    expect(typeof body.request?.model).toBe('string')
    expect(Array.isArray(body.request?.messages)).toBe(true)
    expect(body.request?.messages.length).toBeGreaterThan(0)
    expect(body.response).toBeTruthy()
    expect(body.turn.turn).toBe(firstTurn.turn)
  })

  it('returns 404 for unknown session', async () => {
    const app = makeApp()
    const res = await app.request('/api/debug/sessions/__no_such_session__')
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid turn number', async () => {
    const app = makeApp()
    const res = await app.request('/api/debug/sessions/x/turns/abc')
    expect(res.status).toBe(400)
  })
})
