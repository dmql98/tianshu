export type MCPConnectionStatus =
  | { status: 'connected'; toolsCount: number }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'connecting' }

const mcpStatuses = new Map<string, MCPConnectionStatus>()

export function setMCPStatus(name: string, s: MCPConnectionStatus): void {
  mcpStatuses.set(name, s)
}

export function getMCPStatus(name: string): MCPConnectionStatus | undefined {
  return mcpStatuses.get(name)
}

export function getAllMCPStatuses(): Record<string, MCPConnectionStatus> {
  const out: Record<string, MCPConnectionStatus> = {}
  for (const [k, v] of mcpStatuses) out[k] = v
  return out
}
