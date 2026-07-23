import { apiGet, apiPost, apiPut, apiDelete } from './client'

export interface ConstraintField {
  key: string
  label: string
  type: 'string-list' | 'string' | 'boolean' | 'number'
  placeholder?: string
}

export interface ToolMeta {
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'external'
  constraintFields?: ConstraintField[]
}

export type MCPConnectionStatus =
  | { status: 'connected'; toolsCount: number }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'connecting' }

export interface MCPServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeout?: number
  status?: MCPConnectionStatus | null
}

export interface ToolsData {
  tools: ToolMeta[]
  mcpServers: MCPServer[]
  mcpStatuses: Record<string, MCPConnectionStatus>
}

export interface MCPTestResult {
  ok: boolean
  toolCount?: number
  serverName?: string
  error?: string
}

export async function fetchTools(): Promise<ToolsData> {
  return apiGet('/api/tools')
}

export async function createMCPServer(data: Partial<MCPServer>): Promise<MCPServer> {
  return apiPost('/api/tools/mcp', data)
}

export async function updateMCPServer(id: string, data: Partial<MCPServer>): Promise<MCPServer> {
  return apiPut(`/api/tools/mcp/${id}`, data)
}

export async function deleteMCPServer(id: string): Promise<void> {
  return apiDelete(`/api/tools/mcp/${id}`)
}

export async function testMCPConnection(id: string): Promise<MCPTestResult> {
  return apiPost(`/api/tools/mcp/${id}/test`, {})
}
