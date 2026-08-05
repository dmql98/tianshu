import { createHash } from 'crypto'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import type { ToolModule } from '../types.js'
import { characterMetaStore } from '../../db/characterStore.js'
import { sessionStore } from '../../db/sessionStore.js'
import { characterSkillBindings, findSkillByName } from '../../agent/skill-loader.js'
import { findSkillPackage, listSkillPackages, resolveSkillReference } from '../../agent/skill-catalog.js'
import { sessionSkillStore } from '../../agent/session-skill-store.js'
import { createSkillPackage } from '../../agent/skill-package-writer.js'

function packageAllowed(sessionId: string | undefined, packageId: string): boolean {
  if (!sessionId) return false
  const session = sessionStore.getById(sessionId)
  const character = session ? characterMetaStore.getById(session.character_id) : null
  return !!character && characterSkillBindings(character).some(binding => binding.packageId === packageId && binding.enabled !== false)
}

export const tool: ToolModule = {
  name: 'skill_manager',
  description: 'Discover skill packages and lazily activate child skills.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_packages', 'describe_package', 'list_children', 'activate', 'deactivate', 'list_active', 'read', 'create_package', 'update', 'delete'],
        description: 'Use list_packages/describe_package first. Use create_package to create a standard package and activate for a package child.',
      },
      package_id: { type: 'string', description: 'Skill package id.' },
      package_name: { type: 'string', description: 'Display name for a new skill package.' },
      description: { type: 'string', description: 'Description for a new skill package.' },
      version: { type: 'string', description: 'Optional semantic version for a new skill package.' },
      skill_id: { type: 'string', description: 'Child skill id for activate/deactivate.' },
      skill_name: { type: 'string', description: 'Canonical package or package/child reference.' },
      category: { type: 'string', description: 'Category for create_package.' },
      content: { type: 'string', description: 'Full SKILL.md content for create_package/update.' },
    },
    required: ['action'],
  },
  execute: async (args, ctx) => {
    const action = args.action

    if (action === 'list_packages') {
      const packages = listSkillPackages().map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        category: pkg.category,
        version: pkg.version,
        children: pkg.children.map(child => ({ id: child.id, name: child.name, description: child.description, preload: child.preload })),
      }))
      return { output: JSON.stringify(packages, null, 2) }
    }

    if (action === 'describe_package' || action === 'list_children') {
      if (!args.package_id) return { output: '', error: 'package_id is required' }
      if (ctx.sessionId && !packageAllowed(ctx.sessionId, args.package_id)) return { output: '', error: `Package "${args.package_id}" is not bound to this character` }
      const pkg = findSkillPackage(args.package_id)
      if (!pkg) return { output: '', error: `Skill package "${args.package_id}" not found` }
      return { output: JSON.stringify({ id: pkg.id, name: pkg.name, description: pkg.description, version: pkg.version, root: pkg.rootBody, children: pkg.children }, null, 2) }
    }

    if (action === 'list_active') {
      if (!ctx.sessionId) return { output: '', error: 'No active session context' }
      return { output: JSON.stringify(sessionSkillStore.list(ctx.sessionId), null, 2) }
    }

    if (action === 'activate') {
      if (!ctx.sessionId) return { output: '', error: 'No active session context' }
      if (!args.package_id || !args.skill_id) return { output: '', error: 'package_id and skill_id are required' }
      if (!packageAllowed(ctx.sessionId, args.package_id)) return { output: '', error: `Package "${args.package_id}" is not bound to this character` }
      const ref = `${args.package_id}/${args.skill_id}`
      const found = resolveSkillReference(ref)
      if (!found?.child) return { output: '', error: `Child skill "${ref}" not found` }
      const active = sessionSkillStore.list(ctx.sessionId)
      if (!active.some(item => item.package_id === args.package_id && item.skill_id === args.skill_id) && active.length >= 3) {
        return { output: '', error: 'At most 3 child skills may be active in one session. Deactivate one first.' }
      }
      const hash = createHash('sha256').update(found.body).digest('hex')
      sessionSkillStore.activate(ctx.sessionId, args.package_id, args.skill_id, hash)
      return { output: `Activated ${ref} for this session. Follow these instructions now:\n\n${found.body}` }
    }

    if (action === 'deactivate') {
      if (!ctx.sessionId) return { output: '', error: 'No active session context' }
      if (!args.package_id || !args.skill_id) return { output: '', error: 'package_id and skill_id are required' }
      const changed = sessionSkillStore.deactivate(ctx.sessionId, args.package_id, args.skill_id)
      return { output: changed ? `Deactivated ${args.package_id}/${args.skill_id}` : 'Skill was not active' }
    }

    if (action === 'read') {
      const ref = args.skill_name || (args.package_id && args.skill_id ? `${args.package_id}/${args.skill_id}` : args.package_id)
      if (!ref) return { output: '', error: 'skill_name or package_id is required' }
      if (ctx.sessionId && !packageAllowed(ctx.sessionId, ref.split('/', 1)[0])) return { output: '', error: `Package "${ref.split('/', 1)[0]}" is not bound to this character` }
      const found = resolveSkillReference(ref)
      if (!found) return { output: '', error: `Skill "${ref}" not found` }
      return { output: found.body }
    }

    if (action === 'create_package') {
      const id = args.package_id || args.skill_name
      if (!id || !args.category || !args.content) return { output: '', error: 'package_id (or skill_name), category and content are required' }
      try {
        const created = createSkillPackage({
          id,
          category: args.category,
          content: args.content,
          name: args.package_name,
          description: args.description,
          version: args.version,
        })
        return { output: `Skill package "${created.manifest.id}" created in standard format\n  Manifest: skills/${created.manifest.category}/${created.manifest.id}/skill-package.json\n  Root: skills/${created.manifest.category}/${created.manifest.id}/SKILL.md` }
      } catch (error: any) {
        return { output: '', error: error.message }
      }
    }

    if (action === 'update') {
      if (!args.skill_name || !args.content) return { output: '', error: 'skill_name and content are required' }
      const found = findSkillByName(args.skill_name)
      if (!found) return { output: '', error: `Skill "${args.skill_name}" not found` }
      writeFileSync(join(found.dir, 'SKILL.md'), args.content, 'utf-8')
      return { output: `Skill "${args.skill_name}" updated` }
    }

    if (action === 'delete') {
      if (!args.skill_name) return { output: '', error: 'skill_name is required' }
      const found = findSkillByName(args.skill_name)
      if (!found) return { output: '', error: `Skill "${args.skill_name}" not found` }
      rmSync(found.dir, { recursive: true, force: true })
      return { output: `Skill "${args.skill_name}" deleted` }
    }

    return { output: '', error: `Invalid action: ${action}` }
  },
}
