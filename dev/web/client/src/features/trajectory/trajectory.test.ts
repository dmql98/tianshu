import { describe, expect, it } from 'vitest'
import type { TrajectoryData } from '@/types'
import {
  buildTrajectory, deriveRequestsAndTurns, deriveTrajectoryTimeline,
  filterTrajectory, highlightParts, summarizeTrajectory,
  trajectoryTimelineFocusIndexes,
} from './trajectory'

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

  it('rebuilds requests and turns after filtering', () => {
    const model = buildTrajectory(data)
    const filtered = filterTrajectory(model, 'ls')
    expect(filtered.requests.length).toBe(0) // assistant 行被过滤
    expect(filtered.turns.length).toBe(1)    // 只有 tool 组（无 user 前导则并入首个 turn）
    expect(filtered.turns[0].groups[0].rows.map(r => r.kind)).toEqual(['tool'])
  })
})

describe('deriveRequestsAndTurns', () => {
  it('numbers assistant calls and accumulates usage', () => {
    const model = buildTrajectory(data)
    expect(model.requests.map(r => r.number)).toEqual([1, 2])
    expect(model.requests[0].step).toBe(1)
    expect(model.requests[0].cumulativeInput).toBe(3200)
    expect(model.requests[0].cumulativeOutput).toBe(100)
    expect(model.requests[1].cumulativeInput).toBe(6700)
    expect(model.requests[1].cumulativeOutput).toBe(150)
    expect(model.requests[1].isError).toBe(false)
  })

  it('attaches request numbers to rows', () => {
    const model = buildTrajectory(data)
    const tool = model.rows.find(r => r.kind === 'tool')
    expect(tool?.requestNumber).toBe(1)
    const assistant2 = model.rows.find(r => r.kind === 'assistant' && r.step === 2)
    expect(assistant2?.requestNumber).toBe(2)
    expect(assistant2?.cumulativeInput).toBe(6700)
  })

  it('groups rows into user turn + step groups', () => {
    const model = buildTrajectory(data)
    expect(model.turns.map(t => t.turn)).toEqual([1])
    expect(model.turns[0].groups.map(g => g.kind)).toEqual(['user', 'step', 'step'])
    expect(model.turns[0].groups[1].rows.map(r => r.kind)).toEqual(['assistant', 'tool'])
    expect(model.turns[0].groups[2].rows.map(r => r.kind)).toEqual(['assistant'])
  })

  it('derives groups for multiple user turns', () => {
    const twoTurns = buildTrajectory({
      ...data,
      messages: [
        ...data.messages,
        { id: 5, session_id: 's1', run_id: 'r1', role: 'user', content: '继续', created_at: 6000 },
        { id: 6, session_id: 's1', run_id: 'r1', role: 'assistant', content: '好的', created_at: 7000 },
      ],
    })
    expect(twoTurns.turns.map(t => t.turn)).toEqual([1, 2])
    expect(twoTurns.turns[1].groups.map(g => g.kind)).toEqual(['user', 'step'])
  })
})

describe('deriveTrajectoryTimeline', () => {
  it('projects equal-width spans in sequence mode with TTFT fraction', () => {
    const model = buildTrajectory(data)
    const timeline = deriveTrajectoryTimeline(model.rows, 'sequence')
    expect(timeline?.spans.length).toBe(4)
    expect(timeline?.end).toBe(4)
    const assistant = timeline?.spans.find(s => s.kind === 'assistant')
    expect(assistant?.ttftFraction).toBeCloseTo(0.25) // ttft 500 / llm 2000
    expect(timeline?.turnBoundaries.length).toBe(1)
  })

  it('projects duration spans with real llm/tool durations', () => {
    const model = buildTrajectory(data)
    const timeline = deriveTrajectoryTimeline(model.rows, 'duration')
    expect(timeline).not.toBeNull()
    const assistant = timeline?.spans.find(s => s.kind === 'assistant' && s.label === '好的')
    expect(assistant && assistant.end - assistant.start).toBeCloseTo(2) // 2000ms
    const tool = timeline?.spans.find(s => s.kind === 'tool')
    expect(tool && tool.end - tool.start).toBeCloseTo(0.3)
  })

  it('returns null for empty rows', () => {
    expect(deriveTrajectoryTimeline([], 'sequence')).toBeNull()
  })

  it('focus indexes overlap the selected range', () => {
    const model = buildTrajectory(data)
    const focused = trajectoryTimelineFocusIndexes(model.rows, { start: 0, end: 1.5 }, 'sequence')
    expect([...focused]).toEqual([0, 1])
  })
})

describe('highlightParts', () => {
  it('splits text into hit and non-hit parts', () => {
    expect(highlightParts('分析这个项目', '项目')).toEqual([
      { text: '分析这个', hit: false },
      { text: '项目', hit: true },
    ])
  })

  it('returns a single non-hit part for empty query', () => {
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }])
  })

  it('handles multiple hits', () => {
    expect(highlightParts('a-b-a', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: '-b-', hit: false },
      { text: 'a', hit: true },
    ])
  })
})
