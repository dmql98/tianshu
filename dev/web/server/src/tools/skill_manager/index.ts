import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import type { ToolModule } from '../types.js'
import { findSkillByName, stripFrontmatter, SKILLS_ROOT } from '../../agent/skill-loader.js'

function parseFrontmatterField(content: string, field: string): string | null {
  const m = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim() : null
}

export const tool: ToolModule = {
  name: 'skill_manager',
  description: 'Manage skills (list/read/create/update/delete). Server-side, workspace-independent.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'create', 'update', 'delete'],
        description: '"list" returns all skills; "read" returns a skill\'s body; "create" creates a new skill; "update" replaces a skill\'s SKILL.md content; "delete" removes a skill.',
      },
      skill_name: {
        type: 'string',
        description: 'Required for read/create/update/delete. The skill name.',
      },
      category: {
        type: 'string',
        description: 'Required for create. The category folder (e.g. "web", "system").',
      },
      content: {
        type: 'string',
        description: 'Required for create/update. Full SKILL.md content including frontmatter.',
      },
    },
    required: ['action'],
  },
  execute: async (args) => {
    const action = args.action

    if (action === 'list') {
      const categories = readdirSync(SKILLS_ROOT, { withFileTypes: true })
      const result: { category: string; skills: { name: string; description: string }[] }[] = []
      for (const cat of categories) {
        if (!cat.isDirectory()) continue
        const catPath = join(SKILLS_ROOT, cat.name)
        const entries = readdirSync(catPath, { withFileTypes: true })
        const skills: { name: string; description: string }[] = []
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const skillFile = join(catPath, entry.name, 'SKILL.md')
          if (!existsSync(skillFile)) continue
          const content = readFileSync(skillFile, 'utf-8')
          const descMatch = content.match(/^description:\s*(.+)$/m)
          skills.push({ name: entry.name, description: descMatch?.[1]?.trim() || '' })
        }
        if (skills.length > 0) result.push({ category: cat.name, skills })
      }
      return { output: JSON.stringify(result, null, 2) }
    }

    if (action === 'read') {
      const name = args.skill_name
      if (!name) return { output: '', error: 'skill_name is required when action="read"' }
      const found = findSkillByName(name)
      if (!found) return { output: '', error: `Skill "${name}" not found` }
      const raw = readFileSync(join(found.dir, 'SKILL.md'), 'utf-8')
      return { output: stripFrontmatter(raw) }
    }

    if (action === 'create') {
      const name = args.skill_name
      const category = args.category
      const content = args.content
      if (!name) return { output: '', error: 'skill_name is required when action="create"' }
      if (!category) return { output: '', error: 'category is required when action="create"' }
      if (!content) return { output: '', error: 'content is required when action="create"' }

      const fmName = parseFrontmatterField(content, 'name')
      if (!fmName) return { output: '', error: 'SKILL.md must have a "name:" field in frontmatter' }
      if (fmName !== name) return { output: '', error: `Frontmatter name "${fmName}" does not match skill_name "${name}"` }
      if (findSkillByName(name)) return { output: '', error: `Skill "${name}" already exists` }

      const dir = resolve(SKILLS_ROOT, category, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')

      const desc = parseFrontmatterField(content, 'description') || ''
      return { output: `Skill "${name}" created in category "${category}"\n  Location: skills/${category}/${name}/SKILL.md\n  Description: ${desc}` }
    }

    if (action === 'update') {
      const name = args.skill_name
      const content = args.content
      if (!name) return { output: '', error: 'skill_name is required when action="update"' }
      if (!content) return { output: '', error: 'content is required when action="update"' }
      const found = findSkillByName(name)
      if (!found) return { output: '', error: `Skill "${name}" not found` }
      writeFileSync(join(found.dir, 'SKILL.md'), content, 'utf-8')
      return { output: `Skill "${name}" updated` }
    }

    if (action === 'delete') {
      const name = args.skill_name
      if (!name) return { output: '', error: 'skill_name is required when action="delete"' }
      const found = findSkillByName(name)
      if (!found) return { output: '', error: `Skill "${name}" not found` }
      rmSync(found.dir, { recursive: true, force: true })
      return { output: `Skill "${name}" deleted` }
    }

    return { output: '', error: `Invalid action: ${action}` }
  },
}
