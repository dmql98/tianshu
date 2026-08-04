/**
 * Run: npx tsx src/agent/sub-agent.test.ts
 *
 * Covers: MAX_DEPTH gate (grandchildren impossible) and the
 * validateSubAgentTarget delegation rules (role + group checks).
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-sub-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { validateSubAgentTarget, spawnAndRunSubAgent } = await import('./sub-agent.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const baseTarget = (overrides: Record<string, unknown> = {}) => ({
  id: 'char_sub',
  name: '子角色',
  role: 'sub' as const,
  groups: ['g1'],
  ...overrides,
})

try {
  // ---- target role must be sub/both ----------------------------------------
  {
    let threw = false
    try {
      validateSubAgentTarget(null, baseTarget({ role: 'main' }), 'char_parent')
    } catch { threw = true }
    assert(threw, 'role=main target rejected')
    validateSubAgentTarget('g1', baseTarget({ role: 'both' }), 'char_parent')
    validateSubAgentTarget('g1', baseTarget({ role: 'sub' }), 'char_parent')
    console.log('  OK target role sub/both enforced')
  }

  // ---- same-character delegation always allowed -----------------------------
  {
    validateSubAgentTarget(null, baseTarget(), 'char_sub')
    validateSubAgentTarget('anything', baseTarget(), 'char_sub')
    console.log('  OK self-delegation allowed without group')
  }

  // ---- cross-character delegation requires a matching group ------------------
  {
    let threw = false
    try {
      validateSubAgentTarget(null, baseTarget(), 'char_parent')
    } catch (e: any) {
      threw = true
      assert(String(e.message).includes('跨组委托'), 'error explains group restriction')
    }
    assert(threw, 'no group + different target rejected')

    validateSubAgentTarget('g1', baseTarget(), 'char_parent')

    threw = false
    try {
      validateSubAgentTarget('g2', baseTarget(), 'char_parent')
    } catch { threw = true }
    assert(threw, 'target not in the parent group rejected')
    console.log('  OK cross-character delegation requires group membership')
  }

  // ---- depth >= MAX_DEPTH throws before any side effect ----------------------
  {
    let threw = false
    try {
      await spawnAndRunSubAgent(
        'task',
        'char_anything',
        { id: 's_parent', character_id: 'char_parent' } as any,
        { base_url: 'https://example.invalid/v1', api_key: '' },
        'test-model',
        undefined,
        undefined,
        1,
        undefined,
        undefined,
        'run_1',
      )
    } catch (e: any) {
      threw = true
      assert(String(e.message).includes('MAX_DEPTH'), 'error mentions MAX_DEPTH')
    }
    assert(threw, 'depth >= MAX_DEPTH rejected up front')
    console.log('  OK depth gate blocks grandchildren')
  }
} finally {
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL SUB-AGENT TESTS PASSED')
