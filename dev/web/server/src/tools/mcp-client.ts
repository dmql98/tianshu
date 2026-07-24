import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListRootsRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'url'
import type { ToolResult } from './types.js'

export interface MCPToolDef {
  name: string
  description: string
  inputSchema: Record<string, any>
}

export interface MCPClient {
  serverName: string
  tools: MCPToolDef[]
  executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult>
  disconnect(): Promise<void>
}

interface MCPServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeout?: number
}

function connectionTimeoutMs(config: MCPServerConfig): number {
  return (config.timeout ?? 30) * 1000
}

function classifyConnectError(err: Error & { code?: string }, config: MCPServerConfig): string {
  if (err.code === 'ENOENT') {
    return `Server "${config.name}" command not found: "${config.command}". Is it installed and in PATH?`
  }
  if (err.code === 'EACCES') {
    return `Server "${config.name}" permission denied for command: "${config.command}"`
  }
  if (err.name === 'AbortError' || err.message?.includes('timed out') || err.message?.includes('timeout')) {
    return `Server "${config.name}" connection timed out after ${connectionTimeoutMs(config) / 1000}s`
  }
  if (err.message?.includes('No transports')) {
    return `Server "${config.name}" failed to spawn: ${err.message}. Check that the command and args are correct.`
  }
  return `Server "${config.name}" failed: ${err.message || String(err)}`
}

export async function connectMCPServer(config: MCPServerConfig, workspace?: string): Promise<MCPClient> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env } as Record<string, string>,
    stderr: 'pipe',
    cwd: config.cwd,
  })

  if (transport.stderr) {
    const chunks: Buffer[] = []
    transport.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    transport.stderr.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8').trim()
      if (text) console.warn(`[mcp:${config.name}:stderr] ${text}`)
    })
  }

  const client = new Client(
    { name: 'yi-lin-mcp', version: '0.1.0' },
    { capabilities: { roots: {} } }
  )

  client.setRequestHandler(ListRootsRequestSchema, () =>
    Promise.resolve({ roots: workspace ? [{ uri: pathToFileURL(workspace).href }] : [] })
  )

  const timeoutMs = connectionTimeoutMs(config)
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('Connection timed out'), { name: 'AbortError' })), timeoutMs)
      ),
    ])
  } catch (err: any) {
    transport.close?.()
    throw Object.assign(new Error(classifyConnectError(err, config)), { code: err.code })
  }

  let tools: MCPToolDef[]
  try {
    const toolsResult = await client.listTools()
    tools = (toolsResult.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema as Record<string, any>,
    }))
  } catch (err: any) {
    transport.close?.()
    throw new Error(`Server "${config.name}" tool listing failed: ${err.message || String(err)}`)
  }

  return {
    serverName: config.name,
    tools,
    async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const result = await client.callTool(
          { name: toolName, arguments: args },
          CallToolResultSchema,
          { timeout: 300_000 }
        )
        const content = (result.content as Array<{ type: string; text?: string }>) || []
        if (result.isError) {
          const text = content
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join('\n')
          return { output: '', error: text || 'MCP tool returned an error' }
        }
        const output = content
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('\n')
        return { output }
      } catch (err: any) {
        return { output: '', error: `MCP call failed: ${err.message || String(err)}` }
      }
    },
    async disconnect(): Promise<void> {
      await client.close()
    },
  }
}

export async function disconnectMCPServer(mcp: MCPClient): Promise<void> {
  try {
    await mcp.disconnect()
  } catch {
    // ignore close errors
  }
}
