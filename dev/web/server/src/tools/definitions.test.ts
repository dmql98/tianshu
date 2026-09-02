/**
 * Run: npx tsx src/tools/definitions.test.ts
 *
 * Covers 注入门控（由运行时状态自动推导，不纳入「工具管理」手动开关）：
 *   - skill_manager：技能列表为空 → 不注入（无论默认白名单还是显式绑定）；
 *   - 记忆工具：由 memoryMode 门控（off → []，read_only → 仅 memory_read，
 *     editable/undefined → 全部），绑定里残留的记忆工具名被忽略。
 */

import { getCharacterToolDefinitions, isAutoManagedTool } from './definitions.js'

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

function namesOf(defs: Array<{ function: { name: string } }>): Set<string> {
  return new Set(defs.map(d => d.function.name))
}

// ── skill_manager：技能列表为空 → 不注入 ──
{
  const noSkillDefault = namesOf(getCharacterToolDefinitions(undefined, undefined, undefined))
  assert(noSkillDefault.has('read'), 'default white-list tools still injected')
  assert(!noSkillDefault.has('skill_manager'), 'skill_manager NOT injected when skills empty (default path)')

  const noSkillExplicit = namesOf(getCharacterToolDefinitions([{ name: 'skill_manager' }, { name: 'read' }], undefined, []))
  assert(noSkillExplicit.has('read'), 'explicit non-skill tools still injected')
  assert(!noSkillExplicit.has('skill_manager'), 'skill_manager NOT injected when skills empty (explicit binding)')

  const withSkill = namesOf(getCharacterToolDefinitions(undefined, undefined, ['pkg-a']))
  assert(withSkill.has('skill_manager'), 'skill_manager injected when skills present')

  const withSkillExplicit = namesOf(getCharacterToolDefinitions([{ name: 'skill_manager' }], undefined, ['pkg-a']))
  assert(withSkillExplicit.has('skill_manager'), 'skill_manager injected when skills present (explicit binding)')
}

// ── 记忆工具：由 memoryMode 门控 ──
{
  const off = namesOf(getCharacterToolDefinitions(undefined, 'off', undefined))
  assert(!off.has('memory_read') && !off.has('memory_write'), 'no memory tools when mode=off')

  const readOnly = namesOf(getCharacterToolDefinitions(undefined, 'read_only', undefined))
  assert(readOnly.has('memory_read'), 'memory_read injected when mode=read_only')
  assert(!readOnly.has('memory_write'), 'memory_write NOT injected when mode=read_only')

  const editable = namesOf(getCharacterToolDefinitions(undefined, 'editable', undefined))
  assert(editable.has('memory_read') && editable.has('memory_write'), 'read+write memory tools injected when mode=editable')

  const undefinedMode = namesOf(getCharacterToolDefinitions(undefined, undefined, undefined))
  assert(undefinedMode.has('memory_read') && undefinedMode.has('memory_write'), 'undefined mode falls back to editable memory tools')

  // 显式绑定残留的记忆工具名被忽略，只由 memoryMode 决定。
  const explicitButOff = namesOf(getCharacterToolDefinitions([{ name: 'memory_read' }, { name: 'memory_write' }], 'off', undefined))
  assert(!explicitButOff.has('memory_read') && !explicitButOff.has('memory_write'), 'bindings cannot force memory tools when mode=off')
}

// ── isAutoManagedTool：自动门控工具不进入工具管理元数据（/api/tools） ──
{
  for (const name of ['memory_read', 'memory_write', 'memory_update', 'memory_archive', 'memory_snapshot']) {
    assert(isAutoManagedTool(name), `${name} is auto-managed (memory)`)
  }
  assert(isAutoManagedTool('skill_manager'), 'skill_manager is auto-managed')
  assert(!isAutoManagedTool('read') && !isAutoManagedTool('bash'), 'ordinary tools are not auto-managed')
}

console.log('ALL DEFINITIONS-TOOL-GATING TESTS PASSED')