import { describe, expect, it } from 'vitest'
import type { TrajectoryData } from '@/types'
import { buildTrajectory } from './trajectory'
import { deriveTrajectoryTimeline, trajectoryTimelineFocusIndexes } from './timeline'

const data: TrajectoryData = {
  run: {
    id: 'r1', session_id: 's1', status: 'completed', execution_mode: 'direct',
    error: null, result: null, queued_at: 1000, started_at: 1000, finished_at: 5000,
    continuation_index: 0, resume_trigger: null,
  },
  messages: [
    { id: 1, session_id: 's1', run_id: 'r1', role: 'user', content: '分析这个项目', created_at: 1000 },
    { id: 2, session_id: 's1', run_id: 'r1', role: 'assistant', content: '好的', created_at: 3000 },
    { id: 3, session_id: 's1', run_id: 'r1', role: 'tool', content: 'ok', tool_name: 'bash', tool_input: '{"call_id":"c1"}', tool_status: 'success', is_error: 0, created_at: 3500 },
    { id: 4, session_id: 's1', run_id: 'r1', role: 'assistant', content: '完成分析', created_at: 4500 },
  ],
  events: [
    { event_id: 'e4', session_id: 's1', run_id: 'r1', seq: 4, type: 'message.metrics', occurred_at: 3000, message_id: 2, llm_ms: 2000, ttft_ms: 500, decode_ms: 1500 },
    { event_id: 'e6', session_id: 's1', run_id: 'r1', seq: 6, type: 'tool.completed', occurred_at: 3500, tool_call_id: 'c1', duration_ms: 300 },
    { event_id: 'e8', session_id: 's1', run_id: 'r1', seq: 8, type: 'message.metrics', occurred_at: 4500, message_id: 4, llm_ms: 1000, ttft_ms: null, decode_ms: 800 },
  ],
}

const model = buildTrajectory(data)

describe('deriveTrajectoryTimeline (sequence)', () => {
  it('projects equal-width spans in row order with lanes and turn boundaries', () => {
    const timeline = deriveTrajectoryTimeline(model, 'sequence')!
    expect(timeline.start).toBe(0)
    expect(timeline.end).toBe(4)
    expect(timeline.spans.map(s => s.kind)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(timeline.spans.map(s => s.lane)).toEqual([0, 1, 2, 1])
    expect(timeline.spans.map(s => s.index)).toEqual([0, 1, 2, 3])
    expect(timeline.turnBoundaries).toEqual([{ turn: 1, time: 0 }])
    expect(timeline.wallMs).toBeNull()
  })

  it('returns null when there are no rows', () => {
    expect(deriveTrajectoryTimeline({ rows: [], lifecycle: [], retries: 0 }, 'sequence')).toBeNull()
  })
})

describe('deriveTrajectoryTimeline (duration)', () => {
  it('uses real durations, compresses idle gaps and reports wall time', () => {
    const timeline = deriveTrajectoryTimeline(model, 'duration')!
    // 墙钟：用户 1000ms → 助手1 3000+2000=5000 → 工具 3500+300=3800 → 助手2 4500+1000=5500
    expect(timeline.wallMs).toBe(4500)
    const user = timeline.spans.find(s => s.index === 0)!
    const assistant1 = timeline.spans.find(s => s.index === 1)!
    const tool = timeline.spans.find(s => s.index === 2)!
    const assistant2 = timeline.spans.find(s => s.index === 3)!
    // user 起点 = 1000（域起点）；助手1 起点 = 1000（1000→3000 的 2000ms 空档被压缩）
    expect(user.start).toBe(1000)
    expect(assistant1.start).toBe(1000)
    expect(assistant1.end - assistant1.start).toBe(2000)
    // 工具 3500ms 与助手1 5000ms 重叠 → 不新增空档
    expect(tool.start).toBe(1500)
    expect(tool.end - tool.start).toBe(300)
    // 助手2 4500ms 与覆盖终点 5000ms 之间有 500ms 空档
    expect(assistant2.start).toBe(2500)
    expect(assistant2.end - assistant2.start).toBe(1000)
    expect(timeline.start).toBe(1000)
    expect(timeline.end).toBe(3500)
    expect(timeline.turnBoundaries).toEqual([{ turn: 1, time: 1000 }])
  })
})

describe('trajectoryTimelineFocusIndexes', () => {
  it('collects indexes overlapping the selected interval', () => {
    const focus = trajectoryTimelineFocusIndexes(model, { start: 2000, end: 2600 }, 'duration')
    expect(Array.from(focus).sort()).toEqual([1, 3])
  })

  it('returns empty set for an interval that overlaps nothing', () => {
    const focus = trajectoryTimelineFocusIndexes(model, { start: 100, end: 100 }, 'sequence')
    expect(focus.size).toBe(0)
  })
})
