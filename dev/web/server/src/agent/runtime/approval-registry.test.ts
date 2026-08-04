/**
 * Run: npx tsx src/agent/runtime/approval-registry.test.ts
 */

import { approvalRegistry, type ApprovalChoice } from './approval-registry.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

async function main() {
  // ---- respond resolves the waiting promise -------------------------------
  {
    let resolved: ApprovalChoice | null = null
    approvalRegistry.register('sess_a', 'call_1', 'run_a', c => { resolved = c }, 60000)
    const result = approvalRegistry.respond('sess_a', 'call_1', 'once')
    assert(result.accepted === true && result.runId === 'run_a', 'respond accepted with run id')
    await new Promise(r => setTimeout(r, 10))
    assert(resolved === 'once', 'waiting promise resolved with choice')
    assert(approvalRegistry.respond('sess_a', 'call_1', 'always').accepted === false, 'second respond is no_pending')
    console.log('  OK respond resolves the waiting promise exactly once')
  }

  // ---- timeout rejects ------------------------------------------------------
  {
    let resolved: ApprovalChoice | null = null
    approvalRegistry.register('sess_b', 'call_2', 'run_b', c => { resolved = c }, 30)
    await new Promise(r => setTimeout(r, 60))
    assert(resolved === 'reject', 'timed-out approval rejects')
    assert(approvalRegistry.respond('sess_b', 'call_2', 'once').accepted === false, 'respond after timeout is no_pending')
    console.log('  OK timeout rejects the pending approval')
  }

  // ---- concurrent approvals are independent ---------------------------------
  {
    let first: ApprovalChoice | null = null
    let second: ApprovalChoice | null = null
    approvalRegistry.register('sess_c', 'call_a', 'run_c1', c => { first = c }, 60000)
    approvalRegistry.register('sess_c', 'call_b', 'run_c2', c => { second = c }, 60000)
    approvalRegistry.respond('sess_c', 'call_b', 'always')
    await new Promise(r => setTimeout(r, 10))
    assert(second === 'always' && first === null, 'only the answered call resolves')
    approvalRegistry.respond('sess_c', 'call_a', 'reject')
    await new Promise(r => setTimeout(r, 10))
    assert(first === 'reject', 'second call resolves independently')
    assert(approvalRegistry.hasPending('sess_c') === false, 'no pending approvals left')
    console.log('  OK concurrent approvals resolve independently')
  }

  // ---- cancelSession rejects everything --------------------------------------
  {
    let resolved1: ApprovalChoice | null = null
    let resolved2: ApprovalChoice | null = null
    approvalRegistry.register('sess_d', 'c1', 'run_d1', c => { resolved1 = c }, 60000)
    approvalRegistry.register('sess_d', 'c2', 'run_d2', c => { resolved2 = c }, 60000)
    approvalRegistry.cancelSession('sess_d')
    await new Promise(r => setTimeout(r, 10))
    assert(resolved1 === 'reject' && resolved2 === 'reject', 'cancel rejects all pending')
    assert(approvalRegistry.hasPending('sess_d') === false, 'session cleared')
    console.log('  OK cancelSession rejects every pending approval')
  }
}

await main()
console.log('ALL APPROVAL-REGISTRY TESTS PASSED')
