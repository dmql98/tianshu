/**
 * Agent Skills 标准格式兼容测试
 * Run: npx tsx src/agent/skill-agent-skills-compat.test.ts
 *
 * 验证 scanSkillPackages 能发现无 skill-package.json、仅有 SKILL.md 的 Agent Skills 格式目录。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanSkillPackages } from './skill-catalog.js'

const root = mkdtempSync(join(tmpdir(), 'tianshu-agent-skills-compat-'))
let failed = false

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`  ✗ ${msg}`)
    failed = true
  }
}

try {
  // ── 1. 创建 Agent Skills 标准格式目录（无 skill-package.json）──
  const agentSkillDir = join(root, 'community', 'hello-agent')
  mkdirSync(agentSkillDir, { recursive: true })
  writeFileSync(join(agentSkillDir, 'SKILL.md'), [
    '---',
    'name: hello-agent',
    'description: "A test Agent Skill for compatibility"',
    '---',
    '',
    '# Hello Agent',
    '',
    'Test skill body.',
  ].join('\n'))

  // ── 2. 创建标准天枢格式目录（有 skill-package.json）──
  const tianshuSkillDir = join(root, 'community', 'existing-pkg')
  mkdirSync(tianshuSkillDir, { recursive: true })
  writeFileSync(join(tianshuSkillDir, 'skill-package.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'existing-pkg',
    name: 'Existing Package',
    version: '1.0.0',
    category: 'community',
    description: 'A standard tianshu skill',
    root: 'SKILL.md',
    children: [],
  }))
  writeFileSync(join(tianshuSkillDir, 'SKILL.md'), [
    '---',
    'name: existing-pkg',
    'description: A standard tianshu skill',
    '---',
    '',
    '# Existing Package',
    '',
    'Standard body.',
  ].join('\n'))

  // ── 3. 创建一个无 SKILL.md 也无 skill-package.json 的目录（应被忽略）──
  const emptyDir = join(root, 'community', 'empty-dir')
  mkdirSync(emptyDir, { recursive: true })
  writeFileSync(join(emptyDir, 'README.md'), 'just a readme')

  // ── 4. 运行 scanSkillPackages ──
  const packages = scanSkillPackages(root, 'user')

  // ── 5. 验证结果 ──
  const agentPkg = packages.find(p => p.id === 'hello-agent')
  const standardPkg = packages.find(p => p.id === 'existing-pkg')
  const emptyPkg = packages.find(p => p.id === 'empty-dir')

  // Agent Skills 格式应被发现
  assert(!!agentPkg, 'Agent Skills 格式（hello-agent）应被 scanSkillPackages 发现')
  if (agentPkg) {
    assert(agentPkg.name === 'hello-agent', `name 应从 frontmatter 解析: got "${agentPkg.name}"`)
    assert(agentPkg.description === 'A test Agent Skill for compatibility', `description 应从 frontmatter 解析`)
    assert(agentPkg.category === 'community', `category 应从目录结构推断: got "${agentPkg.category}"`)
    assert(agentPkg.version === '1.0.0', `version 应有默认值: got "${agentPkg.version}"`)
    assert(agentPkg.children.length === 0, `Agent Skills 格式应无子技能: got ${agentPkg.children.length}`)
    assert(agentPkg.rootBody.includes('Test skill body'), 'rootBody 应包含 SKILL.md 正文')
    assert(existsSync(join(agentPkg.dir, 'SKILL.md')), 'dir 指向正确的磁盘路径')
  }

  // 标准天枢格式应正常工作（回归）
  assert(!!standardPkg, '标准天枢格式（existing-pkg）应正常发现')
  if (standardPkg) {
    assert(standardPkg.name === 'Existing Package', `标准包 name 应正确: got "${standardPkg.name}"`)
    assert(standardPkg.rootBody.includes('Standard body'), '标准包 rootBody 应正确')
  }

  // 空目录应被忽略
  assert(!emptyPkg, '无 SKILL.md 的空目录不应被发现')

  // ── 6. 创建一个 frontmatter 无效但有 SKILL.md 的目录 ──
  const badSkillDir = join(root, 'community', 'bad-frontmatter')
  mkdirSync(badSkillDir, { recursive: true })
  writeFileSync(join(badSkillDir, 'SKILL.md'), 'No frontmatter, just body text.')
  const afterBad = scanSkillPackages(root, 'user')
  const badPkg = afterBad.find(p => p.id === 'bad-frontmatter')
  // 无 frontmatter 时应仍能发现（使用目录名作为 name）
  assert(!!badPkg, '无 frontmatter 的 SKILL.md 应仍被发现（回退到目录名）')
  if (badPkg) {
    assert(badPkg.name === 'bad-frontmatter', `无 frontmatter 时 name 应回退到目录名: got "${badPkg.name}"`)
  }

  // ── 总结 ──
  if (failed) {
    console.error('\n  Agent Skills 兼容测试失败')
    process.exit(1)
  } else {
    console.log('  OK Agent Skills 标准格式能被天枢自动发现和加载')
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
