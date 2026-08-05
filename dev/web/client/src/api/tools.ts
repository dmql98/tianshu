import { apiGet, apiPost, apiPut, apiDelete } from './client'

// ── Tool types ──────────────────────────────────────────────
export interface ToolMeta {
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'external'
  constraintFields?: { key: string; label: string; type: string; placeholder?: string }[]
  status?: MCPConnectionStatus | null
}

// ── MCP types ───────────────────────────────────────────────
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

export interface MCPTestResult {
  ok: boolean
  toolCount?: number
  tools?: { name: string; description: string }[]
  serverName?: string
  error?: string
}

export interface DiscoveredMCPServer {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeout?: number
  source: 'opencode' | 'claude' | 'cursor'
  sourceFile: string
  transport: 'stdio' | 'sse' | 'http' | 'unknown'
  url?: string
  enabled?: boolean
  importable: boolean
  alreadyExists?: boolean
}

export interface DiscoverResult {
  servers: DiscoveredMCPServer[]
}

export interface ImportMCPResult {
  imported: string[]
  skipped: { name: string; reason: string }[]
  errors: { name: string; error: string }[]
}

export interface ToolsData {
  tools: ToolMeta[]
  mcpServers: MCPServer[]
  mcpStatuses: Record<string, MCPConnectionStatus>
}

// ── API calls ───────────────────────────────────────────────

export const fetchTools = (): Promise<ToolsData> =>
  apiGet('/api/tools')

export const createMCPServer = (data: Partial<MCPServer>): Promise<MCPServer> =>
  apiPost('/api/tools/mcp', data)

export const updateMCPServer = (id: string, data: Partial<MCPServer>): Promise<MCPServer> =>
  apiPut(`/api/tools/mcp/${id}`, data)

export const deleteMCPServer = (id: string): Promise<void> =>
  apiDelete(`/api/tools/mcp/${id}`)

export const testMCPConnection = (id: string): Promise<MCPTestResult> =>
  apiPost(`/api/tools/mcp/${id}/test`, {})

export const discoverMCPServers = (): Promise<DiscoverResult> =>
  apiGet('/api/tools/mcp/discover')

export const importMCPServers = (names: string[]): Promise<ImportMCPResult> =>
  apiPost('/api/tools/mcp/import', { names })
