import type { ToolModule } from '../types.js'
import { mcpServerStore } from '../../db/toolStore.js'
import { connectMCPServer, disconnectMCPServer } from '../mcp-client.js'
import { discoverMCPServers } from '../mcp_discovery.js'

export const tool: ToolModule = {
  name: 'mcp_manager',
  description: 'Manage MCP server configs (list/read/create/update/delete/test). All server-side, no direct file writes. After creating, register as mcp:<name> in character.json.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'create', 'update', 'delete', 'test', 'discover', 'import'],
        description: '"list" returns all MCP servers; "read" returns a server\'s config; "create" creates a new server; "update" modifies an existing one; "delete" removes a server; "test" tests the connection; "discover" scans opencode/claude/cursor configs for MCP servers on this machine; "import" imports discovered servers by name.',
      },
      name: {
        type: 'string',
        description: 'Required for read/create/update/delete/import. The MCP server name.',
      },
      names: {
        type: 'string',
        description: 'Comma-separated server names to import (required when action="import").',
      },
      command: {
        type: 'string',
        description: 'Required for create. The command to start the MCP server (e.g. "npx", "node", "python").',
      },
      args: {
        type: 'string',
        description: 'Space-separated arguments for the command (optional).',
      },
      env: {
        type: 'string',
        description: 'Environment variables, one per line (KEY=VALUE). Optional.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the server process (optional).',
      },
      timeout: {
        type: 'string',
        description: 'Connection timeout in seconds (optional, default 60).',
      },
    },
    required: ['action'],
  },
  execute: async (args) => {
    const action = args.action

    if (action === 'list') {
      const servers = mcpServerStore.getAll()
      if (servers.length === 0) return { output: 'No MCP servers configured' }
      const lines = servers.map(s => {
        const parts = [`- ${s.name}: ${s.command} ${(s.args || []).join(' ')}`]
        if (s.cwd) parts.push(`  cwd: ${s.cwd}`)
        if (s.timeout) parts.push(`  timeout: ${s.timeout}s`)
        if (s.env && Object.keys(s.env).length > 0) {
          const envStr = Object.entries(s.env).map(([k]) => k).join(', ')
          parts.push(`  env: ${envStr}`)
        }
        return parts.join('\n')
      })
      return { output: `MCP servers:\n${lines.join('\n\n')}` }
    }

    if (action === 'read') {
      const name = args.name
      if (!name) return { output: '', error: 'name is required when action="read"' }
      const server = mcpServerStore.getByName(name)
      if (!server) return { output: '', error: `MCP server "${name}" not found` }
      return { output: JSON.stringify(server, null, 2) }
    }

    if (action === 'create') {
      const name = args.name
      const command = args.command
      if (!name) return { output: '', error: 'name is required when action="create"' }
      if (!command) return { output: '', error: 'command is required when action="create"' }

      const existing = mcpServerStore.getByName(name)
      if (existing) return { output: '', error: `MCP server "${name}" already exists` }

      const parsedArgs = args.args ? args.args.split(/\s+/).filter(Boolean) : []
      const env: Record<string, string> = {}
      if (args.env) {
        for (const line of args.env.split('\n')) {
          const eq = line.indexOf('=')
          if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
      }

      const record = mcpServerStore.create({
        name,
        command,
        args: parsedArgs,
        env,
        cwd: args.cwd || undefined,
        timeout: args.timeout ? parseInt(args.timeout) || undefined : undefined,
      })

      return {
        output: [
          `MCP server "${record.name}" created (id: ${record.id})`,
          `  Location: data/mcpservers/${record.name}/config.json`,
          `  Command: ${record.command} ${record.args.join(' ')}`,
          record.cwd ? `  CWD: ${record.cwd}` : '',
          record.timeout ? `  Timeout: ${record.timeout}s` : '',
          Object.keys(record.env).length > 0 ? `  Env: ${Object.keys(record.env).join(', ')}` : '',
        ].filter(Boolean).join('\n'),
      }
    }

    if (action === 'update') {
      const name = args.name
      if (!name) return { output: '', error: 'name is required when action="update"' }
      const existing = mcpServerStore.getByName(name)
      if (!existing) return { output: '', error: `MCP server "${name}" not found` }

      const patch: Record<string, any> = {}
      if (args.command !== undefined) patch.command = args.command
      if (args.args !== undefined) patch.args = args.args.split(/\s+/).filter(Boolean)
      if (args.cwd !== undefined) patch.cwd = args.cwd || undefined
      if (args.timeout !== undefined) patch.timeout = parseInt(args.timeout) || undefined
      if (args.env !== undefined) {
        const env: Record<string, string> = {}
        for (const line of args.env.split('\n')) {
          const eq = line.indexOf('=')
          if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
        patch.env = env
      }

      const updated = mcpServerStore.update(existing.id, patch)
      return { output: `MCP server "${name}" updated` }
    }

    if (action === 'delete') {
      const name = args.name
      if (!name) return { output: '', error: 'name is required when action="delete"' }
      const server = mcpServerStore.getByName(name)
      if (!server) return { output: '', error: `MCP server "${name}" not found` }
      mcpServerStore.delete(server.id)
      return { output: `MCP server "${name}" deleted` }
    }

    if (action === 'test') {
      const name = args.name
      if (!name) return { output: '', error: 'name is required when action="test"' }
      const config = mcpServerStore.getByName(name)
      if (!config) return { output: '', error: `MCP server "${name}" not found` }
      try {
        const client = await connectMCPServer(config)
        const toolCount = client.tools.length
        const toolNames = client.tools.map(t => t.name).join(', ')
        await disconnectMCPServer(client)
        return { output: `Connection OK — ${toolCount} tool(s) available: ${toolNames}` }
      } catch (err: any) {
        return { output: '', error: `Connection failed: ${err.message || err}` }
      }
    }

    if (action === 'discover') {
      const discovered = discoverMCPServers()
      if (discovered.length === 0) return { output: 'No MCP servers found in opencode/claude/cursor configs' }
      const existing = new Set(mcpServerStore.getAll().map(s => s.name))
      const lines = discovered.map(s => {
        const cmd = s.importable ? `${s.command} ${s.args.join(' ')}`.trim() : `[${s.transport}] ${s.url || ''}`
        const flags = [
          s.source,
          s.importable ? 'stdio' : s.transport,
          s.enabled === false ? 'disabled' : '',
          existing.has(s.name) ? 'already-imported' : 'new',
        ].filter(Boolean).join(', ')
        return `- ${s.name} (${flags}): ${cmd}`
      })
      return { output: `Discovered MCP servers:\n${lines.join('\n')}` }
    }

    if (action === 'import') {
      const names = (args.names || '')
        .split(',')
        .map(n => n.trim())
        .filter(Boolean)
      if (names.length === 0) return { output: '', error: 'names is required when action="import" (comma-separated)' }
      const discovered = discoverMCPServers()
      const byName = new Map(discovered.map(s => [s.name, s]))
      const imported: string[] = []
      const skipped: string[] = []
      for (const name of names) {
        const server = byName.get(name)
        if (!server) { skipped.push(`${name} (not found)`); continue }
        if (!server.importable) { skipped.push(`${name} (transport ${server.transport} not supported)`); continue }
        if (mcpServerStore.getByName(name)) { skipped.push(`${name} (already exists)`); continue }
        mcpServerStore.create({
          name: server.name,
          command: server.command,
          args: server.args,
          env: server.env,
          cwd: server.cwd,
          timeout: server.timeout,
        })
        imported.push(name)
      }
      return {
        output: [
          `Imported: ${imported.join(', ') || '(none)'}`,
          skipped.length > 0 ? `Skipped: ${skipped.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
      }
    }

    return { output: '', error: `Invalid action: ${action}. Valid actions: list, read, create, update, delete, test, discover, import` }
  },
}
