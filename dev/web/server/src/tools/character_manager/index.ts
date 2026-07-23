import type { ToolModule } from '../types.js'
import { characterMetaStore } from '../../db/characterStore.js'
import { characterContentStore } from '../../character/store.js'

export const tool: ToolModule = {
  name: 'character_manager',
  description: 'Manage characters (list/read/create/update/delete). All server-side, workspace-independent.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'create', 'update', 'delete'],
        description: '"list" returns all characters; "read" returns a character\'s config + content; "create" creates a new character; "update" modifies an existing one; "delete" removes a character.',
      },
      character_id: {
        type: 'string',
        description: 'Required for read/update/delete. The character ID.',
      },
      name: {
        type: 'string',
        description: 'Character display name (required for create).',
      },
      soul: {
        type: 'string',
        description: 'SOUL.md content — the character\'s personality definition.',
      },
      description: {
        type: 'string',
        description: 'Short description of the character.',
      },
      user_profile: {
        type: 'string',
        description: 'USER.md content — template/instructions about the user.',
      },
      memory: {
        type: 'string',
        description: 'MEMORY.md content — initial memory / background context.',
      },
      role: {
        type: 'string',
        enum: ['main', 'sub', 'both'],
        description: 'Character role (default: "both").',
      },
      tools: {
        type: 'string',
        description: 'Comma-separated tool names to whitelist (e.g. "read,write,bash").',
      },
      skills: {
        type: 'string',
        description: 'Comma-separated skill names to attach.',
      },
      color: {
        type: 'string',
        description: 'Hex color for the character avatar (e.g. "#6366f1").',
      },
      groups: {
        type: 'string',
        description: 'Comma-separated group names.',
      },
      default_strategy: {
        type: 'string',
        enum: ['Plan', 'Ask', 'Bypass'],
        description: 'Default tool-use strategy (default: "Ask").',
      },
      maxSteps: {
        type: 'string',
        description: 'Maximum turns per session (default: "10").',
      },
    },
    required: ['action'],
  },
  execute: async (args) => {
    const action = args.action

    if (action === 'list') {
      const all = characterMetaStore.getAll()
      if (all.length === 0) return { output: 'No characters' }
      const lines = all.map(c => {
        const parts = [`- ${c.id} (${c.name})`]
        if (c.description) parts[0] += `: ${c.description}`
        if (c.role) parts.push(`  role: ${c.role}`)
        if (c.tools?.length) parts.push(`  tools: ${c.tools.map(t => t.name).join(', ')}`)
        if (c.skills?.length) parts.push(`  skills: ${c.skills.join(', ')}`)
        return parts.join('\n')
      })
      return { output: `Characters:\n${lines.join('\n\n')}` }
    }

    if (action === 'read') {
      const id = args.character_id
      if (!id) return { output: '', error: 'character_id is required when action="read"' }
      const record = characterMetaStore.getById(id)
      if (!record) return { output: '', error: `Character "${id}" not found` }
      const content = characterContentStore.get(id)
      return { output: JSON.stringify({ ...record, ...content }, null, 2) }
    }

    if (action === 'create') {
      if (!args.name) return { output: '', error: 'name is required when action="create"' }

      const tools = args.tools
        ? args.tools.split(',').map(t => t.trim()).filter(Boolean).map(name => ({ name }))
        : undefined
      const skills = args.skills
        ? args.skills.split(',').map(s => s.trim()).filter(Boolean)
        : undefined
      const groups = args.groups
        ? args.groups.split(',').map(g => g.trim()).filter(Boolean)
        : undefined
      const maxSteps = args.maxSteps ? parseInt(args.maxSteps, 10) || 10 : 10

      const record = characterMetaStore.create({
        name: args.name,
        description: args.description || undefined,
        color: args.color || '#6366f1',
        role: (args.role as 'main' | 'sub' | 'both') || 'both',
        tools,
        skills,
        groups,
        maxSteps,
        default_strategy: (args.default_strategy as 'Plan' | 'Ask' | 'Bypass') || 'Ask',
        enabled: true,
      })

      characterContentStore.save(record.id, {
        soul: args.soul,
        user: args.user_profile,
        memory: args.memory,
      })

      const summary = [
        `Character "${record.name}" created (id: ${record.id})`,
        `  Files: data/characters/${record.id}/`,
      ]
      if (tools?.length) summary.push(`  Tools: ${tools.map(t => t.name).join(', ')}`)
      if (skills?.length) summary.push(`  Skills: ${skills.join(', ')}`)
      return { output: summary.join('\n') }
    }

    if (action === 'update') {
      const id = args.character_id
      if (!id) return { output: '', error: 'character_id is required when action="update"' }
      const existing = characterMetaStore.getById(id)
      if (!existing) return { output: '', error: `Character "${id}" not found` }

      const patch: Record<string, any> = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.description !== undefined) patch.description = args.description || undefined
      if (args.color !== undefined) patch.color = args.color || undefined
      if (args.role !== undefined) patch.role = args.role
      if (args.default_strategy !== undefined) patch.default_strategy = args.default_strategy
      if (args.maxSteps !== undefined) patch.maxSteps = parseInt(args.maxSteps) || 10
      if (args.tools !== undefined) {
        patch.tools = args.tools.split(',').map((t: string) => t.trim()).filter(Boolean).map((name: string) => ({ name }))
      }
      if (args.skills !== undefined) {
        patch.skills = args.skills.split(',').map((s: string) => s.trim()).filter(Boolean)
      }
      if (args.groups !== undefined) {
        patch.groups = args.groups.split(',').map((g: string) => g.trim()).filter(Boolean)
      }

      characterMetaStore.update(id, patch)
      if (args.soul !== undefined || args.user_profile !== undefined || args.memory !== undefined) {
        characterContentStore.save(id, {
          soul: args.soul,
          user: args.user_profile,
          memory: args.memory,
        })
      }
      return { output: `Character "${id}" updated` }
    }

    if (action === 'delete') {
      const id = args.character_id
      if (!id) return { output: '', error: 'character_id is required when action="delete"' }
      if (!characterMetaStore.getById(id)) return { output: '', error: `Character "${id}" not found` }
      characterMetaStore.delete(id)
      return { output: `Character "${id}" deleted` }
    }

    return { output: '', error: `Invalid action: ${action}` }
  },
}
