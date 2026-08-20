/**
 * Run: npx tsx src/agent/inner-control-mix.test.ts
 *
 * Covers: a model turn that mixes control actions (old or new names) with
 * ordinary tools must be rejected as a batch with no tool side effects;
 * a lone control action remains a valid protocol turn.
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
    undefined, // dataspace
  ]
}

try {
  // ---- mixed batch: control + ordinary tool --------------------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"delegate_to_agent","arguments":"{\\"task\\":\\"do x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'tool_calls_executed', 'mixed batch returns executed-with-errors, not side effects')
    assert(result.toolCallRecords.length === 2, 'both calls recorded')
    assert(result.toolCallRecords.every((r: any) => r.hasError), 'no call produced a real result')
    assert(result.toolCallRecords.every((r: any) => r.error?.includes('control actions')), 'error explains protocol violation')
    const rejected = emitted.filter(e => e.type === 'control.rejected')
    assert(rejected.length === 2, 'control.rejected emitted for every call in the batch')
    assert(!emitted.some(e => e.type === 'tool.started'), 'no tool.started: no execution began')
    assert(!emitted.some(e => e.type === 'tool.completed'), 'no tool.completed: no side effects')
    assert(!emitted.some(e => e.type === 'approval.requested'), 'no approval flow for a rejected batch')
    console.log('  OK control + ordinary tool mixed batch rejected without side effects')
  }

  // ---- two control actions in one turn -------------------------------------
  {
    globalThis.fetch = (async () => sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"delegate_to_agent","arguments":"{\\"task\\":\\"x\\"}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","type":"function","function":{"name":"submit_result","arguments":"{\\"summary\\":\\"y\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
    )) as typeof fetch

    const { stream, emitted } = makeStream()
    const result = await innerLoop(...makeArgs(stream as any)) as any

    assert(result.type === 'tool_calls_executed', 'multiple control actions rejected as a batch')
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

    assert(result.type === 'sub_agent_request', 'single control call is a valid protocol turn')
    assert(result.subAgentRequest?.task === 'summarize', 'task passed through')
    assert(result.subAgentRequest?.target_character_id === 'char_b', 'target passed through')
    assert(!emitted.some(e => e.type === 'control.rejected'), 'single control call not rejected')
    console.log('  OK lone control action remains valid')
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
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL INNER CONTROL-MIX TESTS PASSED')
