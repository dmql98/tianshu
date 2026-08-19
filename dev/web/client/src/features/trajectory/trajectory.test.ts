import { describe, expect, it } from 'vitest'
import type { TrajectoryData } from '@/types'
import { buildTrajectory, filterTrajectory, summarizeTrajectory } from './trajectory'

const data: TrajectoryData = {
  run: {
    id: 'r1', session_id: 's1', status: 'completed', execution_mode: 'direct',
    error: null, result: null, queued_at: 1000, started_at: 1000, finished_at: 5000,
    continuation_index: 0, resume_trigger: null,
  },
  messages: [
    { id: 1, session_id: 's1', run_id: 'r1', role: 'user', content: '分析这个项目', created_at: 1000 },
    { id: 2, session_id: 's1', run_id: 'r1', role: 'assistant', content: '好的', reasoning_content: '先看结构', created_at: 3000, token_speed: 20 },
    { id: 3, session_id: 's1', run_id: 'r1', role: 'tool', content: '{"output":"ok"}', tool_name: 'bash', tool_input: '{"call_id":"c1","args":"ls"}', tool_output: 'ok', tool_status: 'success', is_error: 0, created_at: 3500 },
    { id: 4, session_id: 's1', run_id: 'r1', role: 'assistant', content: '完成分析', created_at: 4500 },
  ],
  events: [
    { event_id: 'e1', session_id: 's1', run_id: 'r1', seq: 1, type: 'run.queued', occurred_at: 1000 },
    { event_id: 'e2', session_id: 's1', run_id: 'r1', seq: 2, type: 'run.started', occurred_at: 1000 },
    { event_id: 'e3', session_id: 's1', run_id: 'r1', seq: 3, type: 'usage', occurred_at: 2800, input_tokens: 3200, output_tokens: 100 },
    { event_id: 'e4', session_id: 's1', run_id: 'r1', seq: 4, type: 'message.metrics', occurred_at: 3000, message_id: 2, llm_ms: 2000, ttft_ms: 500, decode_ms: 1500, token_speed: 20, token_speed_estimated: false, cache: { hitTokens: 2800, missTokens: 400 } },
    { event_id: 'e5', session_id: 's1', run_id: 'r1', seq: 5, type: 'tool.started', occurred_at: 3200, tool_call_id: 'c1', tool_name: 'bash', tool_input: 'ls' },
    { event_id: 'e6', session_id: 's1', run_id: 'r1', seq: 6, type: 'tool.completed', occurred_at: 3500, tool_call_id: 'c1', duration_ms: 300 },
    { event_id: 'e7', session_id: 's1', run_id: 'r1', seq: 7, type: 'usage', occurred_at: 4300, input_tokens: 3500, output_tokens: 50 },
    { event_id: 'e8', session_id: 's1', run_id: 'r1', seq: 8, type: 'message.metrics', occurred_at: 4500, message_id: 4, llm_ms: 1000, ttft_ms: null, decode_ms: 800, cache: { hitTokens: 3200, missTokens: 300 } },
    { event_id: 'e9', session_id: 's1', run_id: 'r1', seq: 9, type: 'run.completed', occurred_at: 5000 },
  ],
}

describe('buildTrajectory', () => {
  it('builds content rows in message order with step numbering', () => {
    const model = buildTrajectory(data)
    expect(model.rows.map(r => r.kind)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(model.rows.map(r => r.step)).toEqual([null, 1, 1, 2])
    expect(model.rows[2].toolName).toBe('bash')
  })

  it('enriches assistant rows with timing, usage and cache from events', () => {
    const model = buildTrajectory(data)
    const [assistant1, assistant2] = model.rows.filter(r => r.kind === 'assistant')
    expect(assistant1.llmMs).toBe(2000)
    expect(assistant1.ttftMs).toBe(500)
    expect(assistant1.decodeMs).toBe(1500)
    expect(assistant1.tokenSpeed).toBe(20)
    expect(assistant1.inputTokens).toBe(3200)
    expect(assistant1.outputTokens).toBe(100)
    expect(assistant1.cacheHitTokens).toBe(2800)
    expect(assistant2.llmMs).toBe(1000)
    expect(assistant2.ttftMs).toBeNull()
    expect(assistant2.inputTokens).toBe(3500)
    expect(assistant2.outputTokens).toBe(50)
  })

  it('attaches tool duration by call id', () => {
    const model = buildTrajectory(data)
    const tool = model.rows.find(r => r.kind === 'tool')
    expect(tool?.durationMs).toBe(300)
  })

  it('collects lifecycle events as chips and counts retries', () => {
    const model = buildTrajectory(data)
    expect(model.lifecycle.map(l => l.type)).toEqual(['run.queued', 'run.started', 'run.completed'])
    expect(model.retries).toBe(0)

    const retried = buildTrajectory({
      ...data,
      events: [
        ...data.events.slice(0, 2),
        { event_id: 'er', session_id: 's1', run_id: 'r1', seq: 3, type: 'run.retrying', occurred_at: 1500, error: 'boom' },
        ...data.events.slice(2),
      ],
    })
    expect(retried.retries).toBe(1)
    expect(retried.lifecycle.some(l => l.type === 'run.retrying' && l.detail.includes('boom'))).toBe(true)
  })
})

describe('summarizeTrajectory', () => {
  it('aggregates per-run figures', () => {
    const summary = summarizeTrajectory(buildTrajectory(data))
    expect(summary).toEqual({
      turns: 2,
      tools: 1,
      llmMs: 3000,
      toolMs: 300,
      ttftAvgMs: 500,
      decodeMs: 2300,
      outputTokens: 150,
    })
  })
})

describe('filterTrajectory', () => {
  it('filters rows by text, tool name and args', () => {
    const model = buildTrajectory(data)
    expect(filterTrajectory(model, 'bash').rows.map(r => r.kind)).toEqual(['tool'])
    expect(filterTrajectory(model, '完成分析').rows.map(r => r.kind)).toEqual(['assistant'])
    expect(filterTrajectory(model, 'ls').rows.map(r => r.kind)).toEqual(['tool'])
  })

  it('returns the model unchanged for an empty query', () => {
    const model = buildTrajectory(data)
    expect(filterTrajectory(model, '  ')).toBe(model)
  })
})

// ── 会话级轨迹：多 run 合并（对标 deepseek-harness：一个会话一条完整时间线）──
const sessionData: TrajectoryData = {
  runs: [
    {
      id: 'run_a', session_id: 's1', status: 'completed',
      queued_at: 1000, started_at: 1000, finished_at: 5000,
    },
    {
      id: 'run_b', session_id: 's1', status: 'completed',
      queued_at: 6000, started_at: 6000, finished_at: 9000,
    },
  ],
  messages: [
    { id: 1, session_id: 's1', run_id: 'run_a', role: 'user', content: '第一问', created_at: 1000 },
    { id: 2, session_id: 's1', run_id: 'run_a', role: 'assistant', content: '第一答', created_at: 3000 },
    { id: 3, session_id: 's1', run_id: 'run_b', role: 'user', content: '第二问', created_at: 6000 },
    { id: 4, session_id: 's1', run_id: 'run_b', role: 'assistant', content: '第二答', created_at: 8000 },
  ],
  events: [
    { event_id: 'e1', session_id: 's1', run_id: 'run_a', seq: 1, type: 'run.queued', occurred_at: 1000 },
    { event_id: 'e2', session_id: 's1', run_id: 'run_a', seq: 2, type: 'run.started', occurred_at: 1000 },
    { event_id: 'e3', session_id: 's1', run_id: 'run_a', seq: 3, type: 'run.completed', occurred_at: 5000 },
    { event_id: 'e4', session_id: 's1', run_id: 'run_b', seq: 1, type: 'run.queued', occurred_at: 6000 },
    { event_id: 'e5', session_id: 's1', run_id: 'run_b', seq: 2, type: 'ask_user', occurred_at: 6200, question: '确认继续？' },
    { event_id: 'e6', session_id: 's1', run_id: 'run_b', seq: 3, type: 'run.started', occurred_at: 6500 },
    { event_id: 'e7', session_id: 's1', run_id: 'run_b', seq: 4, type: 'run.completed', occurred_at: 9000 },
  ],
}

describe('session-level trajectory (multi-run merge)', () => {
  it('merges all runs into one chronological timeline with global step numbers', () => {
    const model = buildTrajectory(sessionData)
    expect(model.rows.map(r => r.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
    // 跨 run 全局递增：第一轮 assistant=1，第二轮 assistant=2
    expect(model.rows.map(r => r.step)).toEqual([null, 1, null, 2])
    expect(model.rows.map(r => r.runId)).toEqual(['run_a', 'run_a', 'run_b', 'run_b'])
    expect(model.runs.map(r => r.id)).toEqual(['run_a', 'run_b'])
  })

  it('keeps lifecycle events in real chronological order across runs', () => {
    const model = buildTrajectory(sessionData)
    expect(model.lifecycle.map(l => l.type)).toEqual([
      'run.queued', 'run.started', 'run.completed',
      'run.queued', 'ask_user', 'run.started', 'run.completed',
    ])
    // ask_user 归属于 run_b 且带 detail
    const ask = model.lifecycle.find(l => l.type === 'ask_user')
    expect(ask?.runId).toBe('run_b')
    expect(ask?.detail).toContain('确认继续')
  })
})

// ── 系统提示注入记录（DSH system / system-update 行）──
const sysData: TrajectoryData = {
  runs: [],
  messages: [
    { id: 1, session_id: 's1', run_id: 'r1', role: 'user', content: 'hi', created_at: 1000 },
    { id: 2, session_id: 's1', run_id: 'r1', role: 'assistant', content: 'ok', created_at: 2000 },
  ],
  events: [],
  llmCalls: [
    {
      sessionId: 's1', runId: 'r1', turn: 1, fp: 'fp1', createdAt: 900,
      request: {
        model: 'm',
        messages: [
          { role: 'system', content: '你是助手 v1' },
          { role: 'user', content: 'hi' },
        ],
        tools: [{ name: 'bash' }, { name: 'read' }],
      },
      response: { text: 'ok', reasoning: '', toolCalls: [], usage: { input: 10, output: 5 } },
    },
    {
      sessionId: 's1', runId: 'r1', turn: 2, fp: 'fp2', createdAt: 1900,
      request: {
        model: 'm',
        messages: [
          { role: 'system', content: '你是助手 v2' },
          { role: 'user', content: 'hi' },
        ],
        tools: [{ name: 'bash' }, { name: 'read' }, { name: 'write' }],
      },
      response: { text: 'ok2', reasoning: '', toolCalls: [], usage: { input: 20, output: 5 } },
    },
  ],
}

describe('system prompt injection rows', () => {
  it('builds initial + update rows when system or tools change', () => {
    const model = buildTrajectory(sysData)
    expect(model.systemRows).toHaveLength(2)
    expect(model.systemRows[0].kind).toBe('initial')
    expect(model.systemRows[0].system).toContain('你是助手 v1')
    expect(model.systemRows[1].kind).toBe('update')
    expect(model.systemRows[1].system).toContain('你是助手 v2')
    expect(model.systemRows[1].previous?.toolNames).toEqual(['bash', 'read'])
  })

  it('does not emit an update when nothing changed', () => {
    const same: TrajectoryData = {
      ...sysData,
      llmCalls: [
        sysData.llmCalls![0],
        {
          ...sysData.llmCalls![1],
          fp: 'fp2',
          request: { ...sysData.llmCalls![1].request, messages: sysData.llmCalls![0].request.messages, tools: sysData.llmCalls![0].request.tools },
        },
      ],
    }
    const model = buildTrajectory(same)
    expect(model.systemRows).toHaveLength(1)
  })
})
