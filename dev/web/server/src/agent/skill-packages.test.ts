/** Run: npx tsx src/agent/skill-packages.test.ts */

import { characterSkillBindings } from './skill-loader.js'
import { parseSkillFrontmatter } from './skill-catalog.js'

const explicit = characterSkillBindings({
  skills: ['flat-field-must-not-load'],
  skillBindings: [{ packageId: 'uzi', enabled: true, preloadSkills: ['deep-analysis'] }],
})
if (explicit.length !== 1 || explicit[0].packageId !== 'uzi') {
  throw new Error('package bindings must be authoritative')
}

const flatOnly = characterSkillBindings({ skills: ['alpha'] })
if (flatOnly.length !== 0) {
  throw new Error('flat skills must not be loaded as package bindings')
}

const frontmatter = parseSkillFrontmatter(`---\nname: demo\ntags: [one, "two"]\ndescription: package demo\n---\nbody`)
if (frontmatter.name !== 'demo' || (frontmatter.tags as string[]).join(',') !== 'one,two') {
  throw new Error('skill frontmatter parsing failed')
}

console.log('  OK skill packages require explicit package bindings')
