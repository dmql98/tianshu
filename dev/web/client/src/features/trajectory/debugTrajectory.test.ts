import { describe, expect, it } from 'vitest'
import type { DebugTurnDetail, DebugTurnMeta } from '@/api/debug'
import {
  buildDebugTurnView,
  debugTimelineFocusTurns,
  deriveDebugTimeline,
  formatToolArgs,
  summarizeDebugTurns,
} from './debugTrajectory'

const detail: DebugTurnDetail = {
  turn: 1,
  timestamp: 1000,
  fp: 'abc',
  model: 'deepseek-v4-flash',
  system_prompts: ['sys1'],
  messages: [{ role: 'system', content: 'sys1', truncated: false }],
  tools: [{ type: 'function', function: { name: 'bash' } }, { type: 'function', function: { name: 'read' } }],
  response: {
    text: '你好',
    reasoning: '思考中',
    toolCalls: [
      { id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } },
    ],
    usage: { input: 100, output: 20 },
  },
  error: null,
}

const nextDetail: DebugTurnDetail = {
  turn: 2,
  timestamp: 2000,
  fp: 'abc',
  model: 'deepseek-v4-flash',
  system_prompts: ['sys1'],
  messages: [
    { role: 'tool', content: '{"files":["a.txt"]}', tool_call_id: 'c1', truncated: false },
  ],
  tools: [],
  response: { text: '', reasoning: '', toolCalls: [], usage: { input: 200, output: 30 } },
  error: null,
}

describe('buildDebugTurnView', () => {
  it('maps detail to a view and matches tool results from the next turn', () => {
    const view = buildDebugTurnView(detail, nextDetail)
    expect(view.turn).toBe(1)
    expect(view.model).toBe('deepseek-v4-flash')
    expect(view.text).toBe('你好')
    expect(view.reasoning).toBe('思考中')
    expect(view.usage).toEqual({ input: 100, output: 20 })
    expect(view.systemPrompts).toEqual(['sys1'])
    expect(view.tools.length).toBe(2)
    expect(view.toolCalls).toHaveLength(1)
    expect(view.toolCalls[0].name).toBe('bash')
    expect(view.toolCalls[0].result).toBe('{"files":["a.txt"]}')
  })

  it('marks tool results as null when the next turn has no match', () => {
    const view = buildDebugTurnView(detail, null)
    expect(view.toolCalls[0].result).toBeNull()
  })
})

describe('formatToolArgs', () => {
  it('pretty-prints JSON and falls back to raw text', () => {
    expect(formatToolArgs('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(formatToolArgs('not-json')).toBe('not-json')
    expect(formatToolArgs('')).toBe('')
  })
})

describe('summarizeDebugTurns', () => {
  it('aggregates models, tokens, errors and tool calls', () => {
    const turns: DebugTurnMeta[] = [
      {
        turn: 1, timestamp: 1000, fp: 'a', model: 'm1',
        usage: { input: 100, output: 10 }, error: null,
        text_len: 5, reasoning_len: 3, tool_calls: [{ name: 'bash', args_preview: '{}' }],
      },
      {
        turn: 2, timestamp: 2000, fp: 'a', model: 'm1',
        usage: { input: 200, output: 20 }, error: 'boom',
        text_len: 0, reasoning_len: 0, tool_calls: [],
      },
    ]
    expect(summarizeDebugTurns(turns)).toEqual({
      turns: 2, models: ['m1'], inputTokens: 300, outputTokens: 30, errors: 1, toolCalls: 1,
    })
  })
})

describe('deriveDebugTimeline', () => {
  const turns: DebugTurnMeta[] = [
    {
      turn: 1, timestamp: 1000, fp: 'aaa', model: 'm',
      usage: null, error: null, text_len: 0, reasoning_len: 0, tool_calls: [{ name: 'bash', args_preview: '' }],
    },
    {
      turn: 2, timestamp: 3000, fp: 'aaa', model: 'm',
      usage: null, error: 'x', text_len: 0, reasoning_len: 0, tool_calls: [],
    },
    {
      turn: 3, timestamp: 6000, fp: 'bbb', model: 'm',
      usage: null, error: null, text_len: 0, reasoning_len: 0, tool_calls: [{ name: 'read', args_preview: '' }],
    },
  ]

  it('projects sequence spans: system on fp change, assistant always, tool on calls', () => {
    const model = deriveDebugTimeline(turns, 'sequence')!
    expect(model.start).toBe(0)
    expect(model.end).toBe(3)
    const lanes = model.spans.map(s => `${s.turn}:${s.lane}`)
    // turn1: system(0) + assistant(1) + tool(2)；turn2: assistant(1)；turn3: system(0) + assistant(1) + tool(2)
    expect(lanes).toEqual(['1:0', '1:1', '1:2', '2:1', '3:0', '3:1', '3:2'])
    expect(model.spans.find(s => s.lane === 1 && s.turn === 2)?.isError).toBe(true)
    expect(model.turnBoundaries.map(b => b.turn)).toEqual([1, 2, 3])
    expect(model.wallMs).toBeNull()
  })

  it('projects duration spans from timestamps with wall time', () => {
    const model = deriveDebugTimeline(turns, 'duration')!
    expect(model.start).toBe(1000)
    // 最后一个 turn 补 1000ms 作为长度
    expect(model.end).toBe(7000)
    expect(model.wallMs).toBe(5000)
  })
})

describe('debugTimelineFocusTurns', () => {
  it('collects turns overlapping the selected interval', () => {
    const turns: DebugTurnMeta[] = [
      {
        turn: 1, timestamp: 1000, fp: 'a', model: 'm',
        usage: null, error: null, text_len: 0, reasoning_len: 0, tool_calls: [],
      },
      {
        turn: 2, timestamp: 3000, fp: 'a', model: 'm',
        usage: null, error: null, text_len: 0, reasoning_len: 0, tool_calls: [],
      },
    ]
    const focus = debugTimelineFocusTurns(turns, { start: 2000, end: 2500 }, 'duration')
    // turn1 区间 [1000,3000) 覆盖 2000-2500；turn2 区间 [3000,4000) 不覆盖
    expect(Array.from(focus)).toEqual([1])
  })
})
