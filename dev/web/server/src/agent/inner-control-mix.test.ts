/**
 * Run: npx tsx src/agent/inner-control-mix.test.ts
 *
 * Covers (P0-3 项3 解独占语义):
 *   - 单个控制动作 + 普通工具同轮：不再整批拒绝——普通工具先执行（结果并入本轮
 *     上下文，与 tool_call_id 配对完整），控制动作随后正常路由；
 *   - 仍整批拒绝：多个控制动作互斥、控制动作 + delegate_to_agent 并行；
 *   - delegate 同步 barrier：delegate（可多个并行）+ 普通工具时普通工具被推迟到下一轮；
 *   - 单独控制动作 / 单独普通工具保持有效协议轮。
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-inner-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { innerLoop } = await import('./inner.js')
import type { TransportBroadcaster } from '../transport/runtime.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
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
    on: () => { },
    off: () => { },
  }
  return { stream, emitted }
}

const originalFetch = globalThis.fetch

function makeArgs(stream: TransportBroadcaster | undefined): Parameters<typeof innerLoop> {
  return [
    [{ role: 'user', content: 'hi' }],
    [{ type: 'function', function: { name: 'read_file', description: 'x', parameters: {} } }],
    { base_url: 'https://example.invalid/v1', api_key: '' },
    'test-model',
    'char_x',
    undefined, // workspace
    undefined, // broadcaster
    stream,
    undefined, // sessionId -> no DB writes
    undefined, // signal
    {},        // opts
    0,         // turn
    undefined, // mcpClients
    undefined, // workspaces
    undefined, // cap
  ]
}

try {
  // ---- mixed batch: delegate + ordinary tool --------------------------------
  // P5 同步 barrier：delegate 不再独占，同轮普通工具被推迟（占位结果保持协议配对），
  // delegate 批量解析返回给 loop（sub_agent_request / subAgentBatch）。
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"delegate_to_agent","arguments":"{\\"task\\":\\"do x\\",\\"target_character_id\\":\\"char_b\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any
    console.log('DEBUG mixed result type:', result?.type, 'batch:', JSON.stringify(result?.subAgentBatch))

    assert(result.type === 'sub_agent_request', 'delegate routes to sub-agent batch')
    assert(result.subAgentBatch?.length === 1, 'one delegate parsed into batch')
    assert(result.subAgentBatch?.[0].data.task === 'do x', 'delegate task passed through')
    // 非 delegate 工具被推迟：协议配对完整（tool 结果消息存在），且本轮未真正执行。
    assert(result.messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'call_1'), 'ordinary tool gets a deferred placeholder result')
    assert(!emitted.some(e => e.type === 'approval.requested'), 'no approval flow for deferred ordinary tool')
    console.log('  OK delegate + ordinary tool: delegate batched, ordinary tool deferred')
  }

  // ---- control action + delegate_to_agent in one turn (still rejected) ------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"delegate_to_agent","arguments":"{\\"task\\":\\"x\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","type":"function","function":{"name":"submit_result","arguments":"{\\"summary\\":\\"y\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'tool_calls_executed', 'control + delegate rejected as a batch')
    assert(result.toolCallRecords.length === 2 && result.toolCallRecords.every((r: any) => r.hasError), 'all control calls rejected')
    assert(emitted.filter(e => e.type === 'control.rejected').length === 2, 'two control.rejected events')
    console.log('  OK multiple control actions in one turn rejected')
  }

  // ---- lone delegate_to_agent stays a valid protocol turn -------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"delegate_to_agent","arguments":"{\\"task\\":\\"summarize\\",\\"target_character_id\\":\\"char_b\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'sub_agent_request', 'single delegate is a valid protocol turn')
    assert(result.subAgentBatch?.length === 1, 'single delegate parsed into batch')
    assert(result.subAgentBatch?.[0].data.task === 'summarize', 'task passed through')
    assert(result.subAgentBatch?.[0].data.target_character_id === 'char_b', 'target passed through')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'single delegate not rejected')
    console.log('  OK lone delegate remains valid (sync barrier)')
  }

  // ---- lone submit_result routes to the completion path ----------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"submit_result","arguments":"{\\"summary\\":\\"done\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'submit_result', 'lone submit_result routes to completion')
    assert(result.taskCompleteSummary === 'done', 'summary passed through')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'lone submit_result not rejected')
    console.log('  OK lone submit_result routes to completion')
  }

  // ---- lone ask_user routes to a question turn --------------------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"ask_user","arguments":"{\\"question\\":\\"confirm?\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'ask_user', 'lone ask_user routes to question turn')
    assert(result.question === 'confirm?', 'question passed through')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'lone ask_user not rejected')
    console.log('  OK lone ask_user routes to question turn')
  }

  // ---- lone create_plan routes to a plan request -------------------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"create_plan","arguments":"{\\"goal\\":\\"ship v1\\",\\"steps\\":[{\\"title\\":\\"调研\\"},{\\"title\\":\\"实现\\"}]}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'create_plan', 'lone create_plan routes to plan request')
    assert(result.planRequest?.steps.length === 2, 'steps parsed')
    assert(result.planRequest?.goal === 'ship v1', 'goal passed through')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'lone create_plan not rejected')
    console.log('  OK lone create_plan routes to plan request')
  }

  // ---- lone update_plan_step routes to a plan transition ---------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"update_plan_step","arguments":"{\\"ordinal\\":2,\\"status\\":\\"completed\\",\\"evidence\\":\\"tests passed\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'update_plan_step', 'lone update_plan_step routes to plan transition')
    assert(result.planStepUpdate?.ordinal === 2, 'step ordinal parsed')
    assert(result.planStepUpdate?.status === 'completed', 'step status parsed')
    assert(result.planStepUpdate?.evidence === 'tests passed', 'step evidence parsed')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'lone update_plan_step not rejected')
    console.log('  OK lone update_plan_step routes to plan transition')
  }

  // ---- P0-3 项3 解独占: submit_result + read_file 同轮 ------------------------
  // 不再整批拒绝：read_file 真实执行（结果记录 + tool 消息配对），submit_result 正常路由。
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"r1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"does-not-exist.txt\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"s1","type":"function","function":{"name":"submit_result","arguments":"{\\"summary\\":\\"done\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'submit_result', 'control action routes normally when mixed with ordinary tool')
    assert(result.taskCompleteSummary === 'done', 'summary passed through')
    assert(result.toolCallRecords?.length === 1, 'ordinary tool executed and recorded')
    assert(result.toolCallRecords?.[0].toolName === 'read_file', 'recorded tool is the ordinary one')
    assert(result.messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'r1'), 'ordinary tool result paired with its call id')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'no control rejection on mixed turn')
    assert(emitted.some(e => e.type === 'tool.started') && emitted.some(e => e.type === 'tool.completed'), 'ordinary tool lifecycle events emitted')
    console.log('  OK submit_result + read_file: ordinary tool executed, control routed (P0-3 解独占)')
  }

  // ---- lone ordinary tool still executes normally (no false positive) ------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"does-not-exist.txt\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'tool_calls_executed', 'ordinary tool turn still executes')
    assert(result.toolCallRecords.length === 1, 'one record')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'ordinary tool is not misclassified as control')
    assert(emitted.some(e => e.type === 'tool.started') && emitted.some(e => e.type === 'tool.completed'), 'tool lifecycle events emitted')
    console.log('  OK ordinary tool turn unaffected')
  }
} finally {
  globalThis.fetch = originalFetch
  try { rmSync(tmpData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* Windows 偶发文件占用，忽略 */ }
}

console.log('ALL INNER CONTROL-MIX TESTS PASSED')
