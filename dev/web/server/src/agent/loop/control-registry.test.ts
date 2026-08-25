/**
 * Run: npx tsx src/agent/loop/control-registry.test.ts
 *
 * Covers: every model-visible EXCLUSIVE control tool description carries the
 * exclusivity constraint (the rule enforced in inner.ts must be visible to the
 * model). delegate_to_agent is NOT exclusive (P5 sync barrier: multiple
 * delegates per turn are allowed and run in parallel).
 */

import { CONTROL_TOOL_NAMES, getControlToolDefinitions } from './control-registry.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const defs = getControlToolDefinitions()

// 独占控制动作：一个定义对应一个名字。
assert(defs.length === CONTROL_TOOL_NAMES.length + 1, 'defs = exclusive controls + delegate_to_agent')

// 独占控制动作必须携带独占约束说明。
for (const name of CONTROL_TOOL_NAMES) {
  const def = defs.find(d => d.function.name === name)
  assert(!!def, `${name} is defined`)
  assert(def!.function.description.includes('独占一轮'), `${name} description carries the exclusivity constraint`)
  assert(def!.function.description.includes('下一轮'), `${name} description carries the recovery recipe`)
}

// delegate_to_agent 可批量并行（P5 同步 barrier）：不得携带独占约束说明。
const delegate = defs.find(d => d.function.name === 'delegate_to_agent')
assert(!!delegate, 'delegate_to_agent is defined')
assert(!delegate!.function.description.includes('独占一轮'), 'delegate_to_agent must NOT carry exclusivity constraint')
assert(delegate!.function.description.includes('连续调用'), 'delegate description mentions batched parallel calls')

console.log('ALL CONTROL-REGISTRY TESTS PASSED')
