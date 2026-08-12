import type { ToolBinding, ToolModule } from '../types.js'
import { characterMetaStore } from '../../db/characterStore.js'
import { characterContentStore } from '../../character/store.js'
import { normalizeStrategy } from '../../agent/strategy.js'
import { normalizeCharacterRunPolicy, type CharacterRunPolicy } from '../../agent/loop/run-policy.js'
import { parseSkillNames, updateNamedBindings, updateSkillNames } from './skills.js'

/**
 * Build the runPolicy override from the character_manager action args. Prefers
 * run_policy_json; individual soft_turns / grace_turns / auto_continuation /
 * character_max_auto_continuations merge on top. `runPolicyReset` clears it.
 */
function resolveRunPolicyArgs(args: Record<string, string>): { runPolicy?: CharacterRunPolicy; reset?: boolean } {
  if (args.run_policy_reset === 'true' || args.runPolicyReset === 'true') {
    return { reset: true }
  }
  let base: Record<string, unknown> | undefined
  if (typeof args.run_policy_json === 'string' && args.run_policy_json.trim()) {
    try {
      const parsed = JSON.parse(args.run_policy_json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed
      } else {
        throw new Error('run_policy_json must be a JSON object')
      }
    } catch (error: any) {
      throw new Error(`Invalid run_policy_json: ${error.message}`)
    }
  }
  const patch: Record<string, unknown> = base ? { ...base } : {}
  const setOpt = (key: string, field: string) => {
    const value = args[key]
    if (value === undefined || value === '') return
    const n = Number(value)
    if (!Number.isFinite(n)) throw new Error(`Invalid ${key}: "${value}"`)
    patch[field] = Math.trunc(n)
  }
  setOpt('soft_turns', 'softTurns')
  setOpt('grace_turns', 'graceTurns')
  setOpt('character_max_auto_continuations', 'maxAutoContinuations')
  if (args.auto_continuation === 'inherit' || args.auto_continuation === 'enabled' || args.auto_continuation === 'disabled') {
    patch.autoContinuation = args.auto_continuation
  }
  if (Object.keys(patch).length === 0 && !base) return {}
  const normalized = normalizeCharacterRunPolicy({ version: 1, ...patch })
  return { runPolicy: normalized }
}

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
        description: 'Comma-separated skills for create. For update this is a full replacement and requires skills_mode="replace"; normally use skills_add/skills_remove.',
      },
      tools_json: {
        type: 'string',
        description: 'JSON array of structured tool bindings, including constraints. Use for create/update when constraints must be preserved.',
      },
      tools_add: {
        type: 'string',
        description: 'Comma-separated tool names to add without removing existing tool bindings or constraints.',
      },
      tools_remove: {
        type: 'string',
        description: 'Comma-separated tool names to remove without changing other tool bindings.',
      },
      tools_mode: {
        type: 'string',
        enum: ['replace'],
        description: 'Required with tools/tools_json during update to confirm full replacement.',
      },
      skills_add: {
        type: 'string',
        description: 'Comma-separated skills to add without removing existing skills. Preferred for update.',
      },
      skill_packages_add: {
        type: 'string',
        description: 'Comma-separated skill package IDs to bind atomically without changing existing bindings.',
      },
      skill_packages_remove: {
        type: 'string',
        description: 'Comma-separated skill package IDs to unbind atomically without changing other bindings.',
      },
      skills_remove: {
        type: 'string',
        description: 'Comma-separated skills to remove without changing other skills.',
      },
      skills_mode: {
        type: 'string',
        enum: ['replace'],
        description: 'Required with skills during update to explicitly confirm full replacement.',
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
        enum: ['Read Only', 'Ask Risky', 'Auto Approve'],
        description: 'Default tool-use approval mode (default: "Ask Risky").',
      },
      maxSteps: {
        type: 'string',
        description: '[legacy] Maximum turns per session (default: "50"). Prefer runPolicy.soft_turns.',
      },
      run_policy_json: {
        type: 'string',
        description: 'JSON object for the character run policy: { "version": 1, "softTurns": 80, "graceTurns": 15, "autoContinuation": "inherit" | "enabled" | "disabled", "maxAutoContinuations": 1 }. Empty string resets the override (inherit system).',
      },
      soft_turns: {
        type: 'string',
        description: 'Preferred turns before the run starts converging (1..999). Empty removes the override.',
      },
      grace_turns: {
        type: 'string',
        description: 'Requested grace turns after the soft limit (0..999). Empty removes the override.',
      },
      auto_continuation: {
        type: 'string',
        enum: ['inherit', 'enabled', 'disabled'],
        description: 'Whether this character may auto-continue across runs. System switch still gates it.',
      },
      character_max_auto_continuations: {
        type: 'string',
        description: 'Max auto-continuations this character requests (0..50). Empty removes the override.',
      },
      provider: {
        type: 'string',
        description: 'Provider ID assigned to the character.',
      },
      model: {
        type: 'string',
        description: 'Model ID assigned to the character.',
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

      let tools: ToolBinding[] | undefined = undefined
      if (args.tools_json) {
        try {
          const parsed = JSON.parse(args.tools_json)
          if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.name !== 'string')) throw new Error('expected an array of tool bindings')
          tools = parsed as ToolBinding[]
        } catch (error: any) {
          return { output: '', error: `Invalid tools_json: ${error.message}` }
        }
      } else {
        tools = args.tools ? args.tools.split(',').map(t => t.trim()).filter(Boolean).map(name => ({ name })) : undefined
      }
      const skills = args.skills ? parseSkillNames(args.skills) : undefined
      const groups = args.groups
        ? args.groups.split(',').map(g => g.trim()).filter(Boolean)
        : undefined
      const maxSteps = args.maxSteps ? parseInt(args.maxSteps, 10) || 50 : 50
      const { runPolicy: createRunPolicy } = resolveRunPolicyArgs(args)

      const record = characterMetaStore.create({
        name: args.name,
        description: args.description || undefined,
        color: args.color || '#6366f1',
        role: (args.role as 'main' | 'sub' | 'both') || 'both',
        provider: args.provider || undefined,
        model: args.model || undefined,
        tools,
        skills,
        skillBindings: skills?.map(packageId => ({ packageId, enabled: true, preloadSkills: [] })),
        groups,
        runPolicy: createRunPolicy,
        maxSteps,
        default_strategy: normalizeStrategy(args.default_strategy, 'Ask Risky'),
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
      if (args.default_strategy !== undefined) patch.default_strategy = normalizeStrategy(args.default_strategy, 'Ask Risky')
      if (args.maxSteps !== undefined) patch.maxSteps = parseInt(args.maxSteps) || 50
      const runPolicyArgs = resolveRunPolicyArgs(args)
      if (runPolicyArgs.reset) {
        patch.runPolicy = undefined
        // Clear the legacy field too so the read-time migration does not
        // immediately re-create an override (RUN_LIMIT_POLICY_PLAN §4.4).
        patch.maxSteps = undefined
      } else if (runPolicyArgs.runPolicy !== undefined) {
        patch.runPolicy = runPolicyArgs.runPolicy
      }
      if (args.provider !== undefined) patch.provider = args.provider || undefined
      if (args.model !== undefined) patch.model = args.model || undefined
      if ((args.tools !== undefined || args.tools_json !== undefined) && args.tools_mode !== 'replace') {
        return { output: '', error: 'Updating tools/tools_json replaces the entire tool list. Use tools_add/tools_remove, or set tools_mode="replace".' }
      }
      if (args.tools_json !== undefined) {
        try {
          const parsed = JSON.parse(args.tools_json)
          if (!Array.isArray(parsed) || parsed.some((item: any) => !item || typeof item.name !== 'string')) throw new Error('expected an array of tool bindings')
          patch.tools = parsed
        } catch (error: any) {
          return { output: '', error: `Invalid tools_json: ${error.message}` }
        }
      } else if (args.tools !== undefined) {
        patch.tools = args.tools.split(',').map((t: string) => t.trim()).filter(Boolean).map((name: string) => ({ name }))
      } else if (args.tools_add !== undefined || args.tools_remove !== undefined) {
        patch.tools = updateNamedBindings(existing.tools, parseSkillNames(args.tools_add), parseSkillNames(args.tools_remove))
      }
      if (args.skills !== undefined && args.skills_mode !== 'replace') {
        return {
          output: '',
          error: 'Updating "skills" replaces the entire list. Use skills_add/skills_remove, or set skills_mode="replace" for an intentional full replacement.',
        }
      }
      if (args.skills !== undefined) {
        const packageIds = parseSkillNames(args.skills)
        patch.skills = packageIds
        patch.skillBindings = packageIds.map(packageId => ({ packageId, enabled: true, preloadSkills: [] }))
      } else if (args.skills_add !== undefined || args.skills_remove !== undefined || args.skill_packages_add !== undefined || args.skill_packages_remove !== undefined) {
        patch.skills = updateSkillNames(
          existing.skills,
          parseSkillNames(args.skill_packages_add ?? args.skills_add),
          parseSkillNames(args.skill_packages_remove ?? args.skills_remove),
        )
        const existingBindings = existing.skillBindings || []
        const byId = new Map(existingBindings.map(binding => [binding.packageId, binding]))
        for (const packageId of parseSkillNames(args.skill_packages_remove ?? args.skills_remove)) byId.delete(packageId)
        for (const packageId of parseSkillNames(args.skill_packages_add ?? args.skills_add)) {
          if (!byId.has(packageId)) byId.set(packageId, { packageId, enabled: true, preloadSkills: [] })
        }
        patch.skillBindings = [...byId.values()]
      }
      if (args.groups !== undefined) {
        patch.groups = args.groups.split(',').map((g: string) => g.trim()).filter(Boolean)
      }

      if (args.soul !== undefined || args.user_profile !== undefined || args.memory !== undefined) {
        characterContentStore.save(id, {
          soul: args.soul,
          user: args.user_profile,
          memory: args.memory,
        })
      }
      const updated = characterMetaStore.update(id, patch)
      if (!updated) return { output: '', error: `Character "${id}" not found` }
      const skillSummary = patch.skills ? `\n  Skills: ${updated.skills?.join(', ') || '(none)'}` : ''
      return { output: `Character "${id}" updated${skillSummary}` }
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
