import { createHash } from 'crypto'
import { resolve } from 'path'
import type { ToolModule } from '../types.js'
import { characterMetaStore } from '../../db/characterStore.js'
import { sessionStore } from '../../db/sessionStore.js'
import { characterSkillBindings } from '../../agent/skill-loader.js'
import { findSkillPackage, listSkillPackages, resolveSkillReference } from '../../agent/skill-catalog.js'
import { sessionSkillStore } from '../../agent/session-skill-store.js'
import { getDataDir } from '../../config.js'

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
        enum: ['list_packages', 'describe_package', 'list_children', 'activate', 'deactivate', 'list_active', 'read'],
        description: 'Use list_packages/describe_package first, then activate for a package child. (create_package/update/delete 已下沉到 REST 技能工作台，不再由模型直接调用。)',
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
      return { output: JSON.stringify({ id: pkg.id, name: pkg.name, description: pkg.description, version: pkg.version, dir: pkg.dir, root: pkg.rootBody, children: pkg.children }, null, 2) }
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
      const childDir = resolve(found.pkg.dir, found.child.path)
      // 把运行时 dataDir 真实路径带给模型：技能正文里的 `<dataDir>` 占位符
      // 无法被模型解析（bash 工作区 ≠ dataDir），激活时直接注入绝对路径。
      const dataDir = getDataDir()
      return { output: `Activated ${ref} for this session.\n\n磁盘目录（可用 bash cd 到此处运行脚本）:\n${childDir}\n\n数据目录 dataDir（角色/Provider/MCP 配置文件的根目录）:\n${dataDir}\n\nFollow these instructions now:\n\n${found.body.replace(/<dataDir>/g, dataDir)}` }
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

    if (action === 'create_package' || action === 'update' || action === 'delete') {
      // §6.4 技能瘦身：技能包的写操作下沉到 REST 技能工作台，模型不再直接改盘。
      return { output: '', error: `action="${action}" 已从 skill_manager 移除。请改用 REST 技能工作台（/api/skills）完成创建/编辑/删除，或激活 tianshu-system 的 skill-authoring 子技能获取操作指引。` }
    }

    return { output: '', error: `Invalid action: ${action}` }
  },
}
