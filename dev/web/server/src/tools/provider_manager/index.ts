import type { ToolModule } from '../types.js'
import { providerStore } from '../../db/providerStore.js'

export const tool: ToolModule = {
  name: 'provider_manager',
  description: 'Manage LLM providers (list/read/create/update/delete). Server-side, no direct file writes.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'create', 'update', 'delete'],
        description: '"list" returns all providers; "read" returns a provider\'s config; "create" adds a new provider; "update" modifies an existing one; "delete" removes a provider.',
      },
      provider_id: {
        type: 'string',
        description: 'The provider ID (e.g. "openai", "deepseek"). Required for read/update/delete.',
      },
      name: {
        type: 'string',
        description: 'Display name (required for create).',
      },
      base_url: {
        type: 'string',
        description: 'API base URL, OpenAI-compatible format (required for create).',
      },
      api_key: {
        type: 'string',
        description: 'API key (required for create).',
      },
      models: {
        type: 'string',
        description: 'Comma-separated model IDs (e.g. "gpt-4o,gpt-4o-mini"). Optional for create.',
      },
    },
    required: ['action'],
  },
  execute: async (args) => {
    const action = args.action

    if (action === 'list') {
      const all = providerStore.getAll()
      if (all.length === 0) return { output: 'No providers configured' }
      const lines = all.map(p => {
        const models = (p.models || []).map(m => m.id).join(', ')
        return `- ${p.id} (${p.name}): ${p.base_url}${models ? `\n  models: ${models}` : ''}`
      })
      return { output: `Providers:\n${lines.join('\n\n')}` }
    }

    if (action === 'read') {
      const id = args.provider_id
      if (!id) return { output: '', error: 'provider_id is required when action="read"' }
      const provider = providerStore.getById(id)
      if (!provider) return { output: '', error: `Provider "${id}" not found` }
      return { output: JSON.stringify(provider, null, 2) }
    }

    if (action === 'create') {
      const id = args.provider_id
      if (!id) return { output: '', error: 'provider_id is required when action="create"' }
      if (!args.name) return { output: '', error: 'name is required when action="create"' }
      if (!args.base_url) return { output: '', error: 'base_url is required when action="create"' }
      if (!args.api_key) return { output: '', error: 'api_key is required when action="create"' }

      if (providerStore.getById(id)) return { output: '', error: `Provider "${id}" already exists` }

      const models = args.models
        ? args.models.split(',').map(s => s.trim()).filter(Boolean).map(mid => ({ id: mid, name: mid }))
        : []

      const record = providerStore.create({
        id, name: args.name, base_url: args.base_url, api_key: args.api_key, models,
      })
      return { output: `Provider "${record.id}" created\n  Name: ${record.name}\n  URL: ${record.base_url}\n  Models: ${models.length > 0 ? models.map(m => m.id).join(', ') : '(none)'}` }
    }

    if (action === 'update') {
      const id = args.provider_id
      if (!id) return { output: '', error: 'provider_id is required when action="update"' }
      if (!providerStore.getById(id)) return { output: '', error: `Provider "${id}" not found` }

      const patch: Record<string, any> = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.base_url !== undefined) patch.base_url = args.base_url
      if (args.api_key !== undefined) patch.api_key = args.api_key
      if (args.models !== undefined) {
        patch.models = args.models.split(',').map((s: string) => s.trim()).filter(Boolean).map((mid: string) => ({ id: mid, name: mid }))
      }
      providerStore.update(id, patch)
      return { output: `Provider "${id}" updated` }
    }

    if (action === 'delete') {
      const id = args.provider_id
      if (!id) return { output: '', error: 'provider_id is required when action="delete"' }
      if (!providerStore.getById(id)) return { output: '', error: `Provider "${id}" not found` }
      providerStore.delete(id)
      return { output: `Provider "${id}" deleted` }
    }

    return { output: '', error: `Invalid action: ${action}` }
  },
}
