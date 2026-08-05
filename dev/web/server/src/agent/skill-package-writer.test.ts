/** Run: npx tsx src/agent/skill-package-writer.test.ts */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSkillPackage } from './skill-package-writer.js'

const root = mkdtempSync(join(tmpdir(), 'tianshu-skill-package-'))
try {
  const created = createSkillPackage({
    id: 'demo-package',
    category: 'tests',
    content: '---\nname: Demo Package\ndescription: test package\nversion: 1.0.0\n---\n\n# Instructions\n',
  }, root)

  const manifestPath = join(created.dir, 'skill-package.json')
  if (!existsSync(manifestPath) || !existsSync(join(created.dir, 'SKILL.md'))) {
    throw new Error('standard package files were not created')
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  if (manifest.id !== 'demo-package' || manifest.root !== 'SKILL.md' || !Array.isArray(manifest.children)) {
    throw new Error('generated manifest is invalid')
  }
  const leftovers = readdirSync(join(root, 'tests')).filter(name => name.includes('.staging-'))
  if (leftovers.length) throw new Error(`staging directory leaked: ${leftovers.join(', ')}`)

  let duplicateRejected = false
  try {
    createSkillPackage({ id: 'demo-package', category: 'tests', name: 'Duplicate', content: '# Duplicate' }, root)
  } catch { duplicateRejected = true }
  if (!duplicateRejected) throw new Error('duplicate package creation must be rejected')

  console.log('  OK new skills always use an atomic standard package layout')
} finally {
  rmSync(root, { recursive: true, force: true })
}
