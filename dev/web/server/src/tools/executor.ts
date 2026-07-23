import { execute as registryExecute } from './registry.js'
import { PathEscapeError } from './utils.js'
import type { ToolResult } from './types.js'
import type { MCPClient } from './mcp-client.js'

function parseMCPToolName(name: string): { serverName: string; toolName: string } | null {
  const m = name.match(/^mcp__(.+?)__(.+)$/)
  if (!m) return null
  return { serverName: m[1], toolName: m[2] }
}

export async function executeTool(name: string, args: Record<string, string>, workspace: string, signal?: AbortSignal, mcpClients?: Map<string, MCPClient>, allowedRoots?: string[], onOutput?: (chunk: string) => void, workspaces?: string[]): Promise<ToolResult> {
  if (name.startsWith('mcp__') && mcpClients) {
    const parsed = parseMCPToolName(name)
    if (!parsed) return { output: '', error: `Invalid MCP tool name: ${name}` }
    const client = mcpClients.get(parsed.serverName)
    if (!client) return { output: '', error: `MCP server "${parsed.serverName}" not connected` }
    return client.executeTool(parsed.toolName, args)
  }

  try {
    return await registryExecute(name, args, { workspace, workspaces, signal, allowedRoots, onOutput })
  } catch (err: any) {
    if (err instanceof PathEscapeError) {
      return { output: '', error: err.message, escaped: true }
    }
    return { output: '', error: `${name}: ${err.message || String(err)}` }
  }
}
