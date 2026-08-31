import { execute as registryExecute } from './registry.js'
import { PathEscapeError } from './utils.js'
import type { ToolResult, ToolArgs } from './types.js'
import type { MCPClient } from './mcp-client.js'
import { getDataDir } from '../config.js'

function parseMCPToolName(name: string): { serverName: string; toolName: string } | null {
  const m = name.match(/^mcp__(.+?)__(.+)$/)
  if (!m) return null
  return { serverName: m[1], toolName: m[2] }
}

export async function executeTool(name: string, args: ToolArgs, workspace: string, signal?: AbortSignal, mcpClients?: Map<string, MCPClient>, allowedRoots?: string[], onOutput?: (chunk: string) => void,     workspaces?: string[], sessionId?: string, characterId?: string): Promise<ToolResult> {
  if (name.startsWith('mcp__') && mcpClients) {
    const parsed = parseMCPToolName(name)
    if (!parsed) return { output: '', error: `Invalid MCP tool name: ${name}` }
    const client = mcpClients.get(parsed.serverName)
    if (!client) return { output: '', error: `MCP server "${parsed.serverName}" not connected` }
    return client.executeTool(parsed.toolName, args, signal)
  }

  try {
    // 合并全局 dataDir 到工作区，使所有工具可访问角色/技能/MCP 等配置
    const mergedWorkspaces = [...(workspaces || []), getDataDir()].filter((v, i, a) => a.indexOf(v) === i)
    return await registryExecute(name, args, { sessionId, characterId, workspace, workspaces: mergedWorkspaces, signal, allowedRoots, onOutput })
  } catch (err: any) {
    if (err instanceof PathEscapeError) {
      return { output: '', error: err.message, escaped: true }
    }
    return { output: '', error: `${name}: ${err.message || String(err)}` }
  }
}
