/**
 * Run: npx tsx src/agent/loop/control-registry.test.ts
 *
 * Covers: every model-visible control tool description carries the exclusivity
 * constraint (the rule enforced in inner.ts must be visible to the model, or it
 * can only be learned by violating it — session mt2i2ie348v2tb).
 */

import { CONTROL_TOOL_NAMES, getControlToolDefinitions } from './control-registry.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const defs = getControlToolDefinitions()

assert(defs.length === CONTROL_TOOL_NAMES.length, 'one definition per control tool name')

for (const name of CONTROL_TOOL_NAMES) {
  const def = defs.find(d => d.function.name === name)
  assert(!!def, `${name} is defined`)
  assert(def!.function.description.includes('独占一轮'), `${name} description carries the exclusivity constraint`)
  assert(def!.function.description.includes('下一轮'), `${name} description carries the recovery recipe`)
}

console.log('ALL CONTROL-REGISTRY TESTS PASSED')
