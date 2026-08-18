import { describe, expect, it } from 'vitest'
import type { TrajectoryData } from '@/types'
import { buildTrajectory } from './trajectory'
import { buildTrajectoryLayout } from './trajectory-layout'

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
    { event_id: 'e3', session_id: 's1', run_id: 'r1', seq: 3, type: 'usage', occurred_at: 2800, input_tokens: 3200, output_tokens: 100 },
    { event_id: 'e4', session_id: 's1', run_id: 'r1', seq: 4, type: 'message.metrics', occurred_at: 3000, message_id: 2, llm_ms: 2000, ttft_ms: 500, decode_ms: 1500, token_speed: 20, token_speed_estimated: false, cache: { hitTokens: 2800, missTokens: 400 } },
    { event_id: 'e6', session_id: 's1', run_id: 'r1', seq: 6, type: 'tool.completed', occurred_at: 3500, tool_call_id: 'c1', duration_ms: 300 },
    { event_id: 'e7', session_id: 's1', run_id: 'r1', seq: 7, type: 'usage', occurred_at: 4300, input_tokens: 3500, output_tokens: 50 },
    { event_id: 'e8', session_id: 's1', run_id: 'r1', seq: 8, type: 'message.metrics', occurred_at: 4500, message_id: 4, llm_ms: 1000, ttft_ms: null, decode_ms: 800, cache: { hitTokens: 3200, missTokens: 300 } },
  ],
}

const model = buildTrajectory(data)

describe('buildTrajectoryLayout', () => {
  it('folds rows into one turn with message group + step groups', () => {
    const layout = buildTrajectoryLayout(model)
    expect(layout.turns.map(turn => turn.turn)).toEqual([1])
    const [turn] = layout.turns
    expect(turn.groups.map(group => group.kind)).toEqual(['message', 'step', 'step'])
    expect(turn.groups[0].rows.map(r => r.kind)).toEqual(['user'])
    expect(turn.groups[1].rows.map(r => r.kind)).toEqual(['assistant', 'tool'])
    expect(turn.groups[2].rows.map(r => r.kind)).toEqual(['assistant'])
  })

  it('numbers requests and accumulates usage per step', () => {
    const layout = buildTrajectoryLayout(model)
    const [turn] = layout.turns
    const [message, step1, step2] = turn.groups
    expect(message.step).toBeNull()
    expect(step1.step).toBe(1)
    expect(step2.step).toBe(2)
    expect(layout.requestCount).toBe(2)
    // step1 组显示「完成后」的累计值：3200/100
    expect(step1.cumulativeInput).toBe(3200)
    expect(step1.cumulativeOutput).toBe(100)
    expect(step2.cumulativeInput).toBe(6700)
    expect(step2.cumulativeOutput).toBe(150)
    expect(layout.totalInput).toBe(6700)
    expect(layout.totalOutput).toBe(150)
  })

  it('treats rows without a leading user as turn 0', () => {
    const continuation = buildTrajectory({
      ...data,
      messages: data.messages.filter(m => m.role !== 'user'),
    })
    const layout = buildTrajectoryLayout(continuation)
    expect(layout.turns.map(turn => turn.turn)).toEqual([0])
  })
})
