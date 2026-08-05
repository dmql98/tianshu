/**
 * Run: npx tsx src/tools/character_manager/skills.test.ts
 */

import { parseSkillNames, updateNamedBindings, updateSkillNames } from './skills.js'

const parsed = parseSkillNames(' existing, new-skill, existing ')
if (parsed.join(',') !== 'existing,new-skill') throw new Error(`parse/dedupe failed: ${parsed}`)

const updated = updateSkillNames(
  ['existing-a', 'existing-b'],
  ['uzi-deep-analysis', 'existing-a'],
  ['existing-b'],
)
if (updated.join(',') !== 'existing-a,uzi-deep-analysis') {
  throw new Error(`incremental skill update lost or duplicated entries: ${updated}`)
}

console.log('  OK incremental skill updates preserve unrelated skills and deduplicate additions')

const toolBindings = updateNamedBindings(
  [{ name: 'bash', constraints: { allowed_commands: ['git'] } }, { name: 'read' }],
  ['mcp:database', 'bash'],
  ['read'],
)
if (toolBindings.length !== 2 || toolBindings[0].name !== 'bash' || !('constraints' in toolBindings[0]) || toolBindings[1].name !== 'mcp:database') {
  throw new Error(`incremental tool update lost constraints or duplicated bindings: ${JSON.stringify(toolBindings)}`)
}

console.log('  OK incremental tool updates preserve constraints and unrelated bindings')
