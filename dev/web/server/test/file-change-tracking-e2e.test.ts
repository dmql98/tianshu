/**
 * file-change-tracking-e2e.test.ts — 文件修改追踪端到端（vitest，无真实 LLM）。
 *
 * 验证标准 3：一次 agent run 产生 write 工具调用后，
 * GET /api/sessions/:id/file-changes 返回 file_changes 行，且 run 结束
 * snapshot 行（git diff 校准）覆盖 tool 实时行。
 *
 * 链路：mock fetch（SSE 流返回 write 工具调用）→ innerLoop 真实执行 write →
 * fileChangeStore.recordTool 落 tool 行 → 模拟 outer.ts run 结束钩子
 * （gitSnapshot.ensure + track 基线 + diff + recordSnapshotBatch）→
 * REST 接口返回聚合文件。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-fc-e2e-'))
process.env.TIANSHU_DATA_DIR = tmpData

import { getDb, closeDb } from '../src/db/schema.js'
import { sessionStore } from '../src/db/sessionStore.js'
import { messageStore } from '../src/db/messageStore.js'
import { fileChangeStore } from '../src/db/fileChangeStore.js'
import { gitSnapshot, projectKeyFor } from '../src/agent/snapshot/git-snapshot.js'
import { innerLoop } from '../src/agent/inner.js'
import { setSessionStrategy } from '../src/agent/session.js'
import { register as registerTool } from '../src/tools/registry.js'
import { tool as writeTool } from '../src/tools/write/index.js'
import type { TransportBroadcaster } from '../src/transport/runtime.js'

const db = getDb()
const NOW = Date.now()
const originalFetch = globalThis.fetch

beforeAll(async () => {
  // vitest 下 registry.init() 的动态 import(`./${dir}/index.js`) 无法转换，
  // 用 register 显式注册 e2e 所需的 write 工具。
  registerTool(writeTool)
})

afterAll(() => {
  globalThis.fetch = originalFetch
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
  delete process.env.TIANSHU_DATA_DIR
})

function writeCharacter(characterId: string) {
  const dir = resolve(tmpData, 'characters', characterId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'character.json'), JSON.stringify({
    id: characterId, name: characterId,
    tools: [{ name: 'write', dangerous: true }],
  }), 'utf-8')
}

function newChar() {
  const id = `char_${randomUUID().slice(0, 8)}`
  writeCharacter(id)
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(id, `rev_${id}_1`, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, ?, ?, NULL, ?)
  `).run(`rev_${id}_1`, id, `hash-${id}`, '{}', NOW)
  return id
}

function sse(...lines: string[]): Response {
  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function makeStream() {
  const emitted: Array<{ type: string; payload: any }> = []
  const stream = {
    emit: (type: string, payload?: any) => { emitted.push({ type, payload }); return true },
    on: () => {},
    off: () => {},
  }
  return { stream: stream as unknown as TransportBroadcaster, emitted }
}

async function getFileChanges(sessionId: string) {
  const mod = await import('../src/routes/sessions.js')
  const res = await (mod as { default: { request: (req: Request) => Promise<Response> } }).default.request(
    new Request(`http://localhost/${sessionId}/file-changes`),
  )
  return { status: res.status, body: await res.json() as { files: any[] } }
}

describe('文件修改追踪端到端（验证标准 3）', () => {
  it('agent run 产生 write → tool 行落库 → run 结束 snapshot 行覆盖 → REST 返回', async () => {
    const ws = join(tmpData, 'ws-e2e')
    mkdirSync(ws, { recursive: true })
    const session = sessionStore.create({ id: `sess_${randomUUID().slice(0, 8)}`, character_id: newChar(), workspace: ws } as any)
    setSessionStrategy(session.id, 'Auto Approve', 'system')
    const runId = `run_${randomUUID().slice(0, 8)}`

    // mock LLM：第一轮返回 write 工具调用（改写 a.txt），第二轮返回最终回答（结束循环）
    let fetchCalls = 0
    const writeArgs = JSON.stringify({ path: 'a.txt', content: 'line1\nline2\n' })
    const sseData = JSON.stringify({
      choices: [{
        delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write', arguments: writeArgs } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    })
    const stopData = JSON.stringify({
      choices: [{
        delta: { content: 'done' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    })
    globalThis.fetch = (async () => {
      fetchCalls++
      return sse(`data: ${fetchCalls === 1 ? sseData : stopData}`)
    }) as typeof fetch

    const { stream, emitted } = makeStream()

    // 模拟 outer.ts run 开始钩子：先 ensure + track 基线（造一个基线文件保证产生
    // commit；a.txt 尚未存在，write 将是新建 created）
    const key = projectKeyFor(ws)
    await gitSnapshot.ensure(key, ws)
    writeFileSync(join(ws, 'base.txt'), 'base\n', 'utf-8')
    const base = await gitSnapshot.track(key)
    expect(base).toBeTruthy()

    const result = await innerLoop(
      [{ role: 'user', content: 'hi' }],
      undefined,
      // api_style 显式指定 chat_completions：跳过 probeResponsesApi 的探测请求
      // （探测会多消耗一次 fetch，导致 mock 的「第 1 轮工具调用」被吞掉）。
      { base_url: 'https://example.invalid/v1', api_key: '', api_style: 'chat_completions' },
      'test-model',
      session.character_id,
      ws, // workspace
      undefined,
      stream,
      session.id, // sessionId → 触发 recordTool 落库
      undefined,
      { run_id: runId },
      0,
      undefined,
      [ws],
      undefined,
    ) as any

    // write 工具真实执行。innerLoop 是单轮迭代：本轮返回 tool_calls_executed 即结束，
    // 不自动发起第二轮（循环由 outer.ts 驱动）。
    console.log('DEBUG e2e result.type =', result?.type, 'records =', JSON.stringify(result?.toolCallRecords))
    expect(existsSync(join(ws, 'a.txt'))).toBe(true)
    expect(result?.type).toBe('tool_calls_executed')
    expect(fetchCalls).toBe(1) // 仅本轮 1 次 LLM 调用（write 工具已执行）

    // tool 实时行已落库（source='tool'）
    const toolRows = db.prepare(
      'SELECT * FROM file_changes WHERE session_id = ? AND source = ?',
    ).all(session.id, 'tool') as Array<{ path: string; status: string; additions: number; deletions: number }>
    expect(toolRows).toHaveLength(1)
    expect(toolRows[0]).toMatchObject({ path: 'a.txt', status: 'created', additions: 2, deletions: 0 })
    expect(emitted.some(e => e.type === 'tool.completed')).toBe(true)
    expect(emitted.find(e => e.type === 'tool.completed')?.payload.file).toMatchObject({ path: 'a.txt', status: 'created' })

    // 模拟 outer.ts run 结束钩子：diff 基线 → 当前工作区（a.txt 为新增）
    const diffs = await gitSnapshot.diff(key, base!)
    expect(diffs.some(d => d.file === 'a.txt')).toBe(true)
    fileChangeStore.recordSnapshotBatch(session.id, runId, key, diffs)

    // REST：返回聚合文件，snapshot 权威行覆盖 tool 实时行
    const { status, body } = await getFileChanges(session.id)
    expect(status).toBe(200)
    expect(body.files).toHaveLength(1)
    const file = body.files[0]
    expect(file.path).toBe('a.txt')
    // snapshot 行是唯一最新行 → 覆盖 tool 行（同一字段）
    expect(file.source).toBe('snapshot')
    expect(file.additions).toBe(2)
    expect(file.deletions).toBe(0)

    // REST diff 接口：可拿到该文件 unified patch
    const mod = await import('../src/routes/sessions.js')
    const diffRes = await (mod as { default: { request: (req: Request) => Promise<Response> } }).default.request(
      new Request(`http://localhost/${session.id}/file-changes/a.txt/diff`),
    )
    expect(diffRes.status).toBe(200)
    const diffBody = await diffRes.json() as { patch: string }
    expect(diffBody.patch).toContain('+line1')
  })
})