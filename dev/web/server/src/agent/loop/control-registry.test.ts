/**
 * Run: npx tsx src/agent/loop/control-registry.test.ts
 *
 * Covers: every model-visible EXCLUSIVE control tool description carries the
 * mutual-exclusion constraint (P0-3 项3 解独占: control + ordinary tool in the
 * same turn is allowed — ordinary tool runs first; control + control, and
 * control + delegate_to_agent, are still rejected atomically).
 * delegate_to_agent is NOT exclusive (P5 sync barrier: multiple delegates per
 * turn are allowed and run in parallel).
 */

import { CONTROL_TOOL_NAMES, getControlToolDefinitions } from './control-registry.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const defs = getControlToolDefinitions()

// 互斥控制动作：一个定义对应一个名字。
assert(defs.length === CONTROL_TOOL_NAMES.length + 1, 'defs = exclusive controls + delegate_to_agent')

// 互斥控制动作必须携带互斥/共存约束说明（P0-3 项3 解独占）。
for (const name of CONTROL_TOOL_NAMES) {
  const def = defs.find(d => d.function.name === name)
  assert(!!def, `${name} is defined`)
  assert(def!.function.description.includes('不能与其他控制动作或 delegate_to_agent'), `${name} description carries the exclusivity constraint`)
  assert(def!.function.description.includes('可与普通工具同轮发出'), `${name} description mentions ordinary-tool coexistence (P0-3 解独占)`)
}

// delegate_to_agent 可批量并行（P5 同步 barrier）：不得携带互斥约束说明。
const delegate = defs.find(d => d.function.name === 'delegate_to_agent')
assert(!!delegate, 'delegate_to_agent is defined')
assert(!delegate!.function.description.includes('不能与其他控制动作或 delegate_to_agent'), 'delegate_to_agent must NOT carry exclusivity constraint')
assert(delegate!.function.description.includes('连续调用'), 'delegate description mentions batched parallel calls')

console.log('ALL CONTROL-REGISTRY TESTS PASSED')
