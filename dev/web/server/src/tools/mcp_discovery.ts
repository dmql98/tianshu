import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getDataDir } from '../config.js'

export type MCPSource = 'opencode' | 'claude' | 'cursor'

export type MCPTransport = 'stdio' | 'sse' | 'http' | 'unknown'

export interface DiscoveredMCPServer {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeout?: number
  source: MCPSource
  sourceFile: string
  transport: MCPTransport
  url?: string
  enabled?: boolean
  importable: boolean
}

function home(): string {
  return homedir()
}

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') return join(home(), p.slice(2))
  return p
}

function configPaths(spec: string[]): string[] {
  return spec.map(p => expandHome(p))
}

function readConfig(file: string): any | null {
  if (!existsSync(file)) return null
  try {
    return parseJSONC(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function parseJSONC(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '')
    const noLine = noBlock.replace(/^\s*\/\/.*$/gm, '')
    return JSON.parse(noLine)
  }
}

// Normalize `command` which may be a string or an array (opencode style),
// combined with an optional separate `args` array (claude/cursor style).
function toCommandParts(command: unknown, args?: unknown): { command: string; args: string[] } | null {
  const extra = Array.isArray(args) ? args.map(String).filter(Boolean) : []
  if (Array.isArray(command)) {
    const parts = command.map(String).filter(Boolean)
    if (parts.length === 0) return null
    return { command: parts[0], args: [...parts.slice(1), ...extra] }
  }
  if (typeof command === 'string' && command.trim()) {
    const parts = command.trim().split(/\s+/).filter(Boolean)
    return { command: parts[0], args: [...parts.slice(1), ...extra] }
  }
  if (extra.length > 0) {
    return { command: extra[0], args: extra.slice(1) }
  }
  return null
}

function normalizeEnv(env: unknown): Record<string, string> {
  if (!env || typeof env !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v
    else if (v != null) out[k] = String(v)
  }
  return out
}

function remoteTransport(type: unknown, url?: string): MCPTransport {
  const t = String(type || '')
  if (t === 'http') return 'http'
  if (t === 'sse' || url) return 'sse'
  return 'unknown'
}

function normalizeEntry(
  name: string,
  entry: any,
  source: MCPSource,
  extra?: { replaceWorkspace?: boolean },
): DiscoveredMCPServer | null {
  if (!entry || typeof entry !== 'object') return null

  const type = entry.type as string | undefined
  const url = entry.url as string | undefined
  const isRemote = type === 'sse' || type === 'http' || (type as string) === 'remote' || !!url

  if (isRemote) {
    return {
      name,
      command: '',
      args: [],
      env: {},
      source,
      sourceFile: '',
      transport: remoteTransport(type, url),
      url: url || entry.endpoint || undefined,
      enabled: entry.enabled,
      importable: false,
    }
  }

  let parts = toCommandParts(entry.command, entry.args)
  if (!parts) return null
  if (extra?.replaceWorkspace) {
    parts = {
      command: parts.command,
      args: parts.args.map(a => a.replace(/\$\{workspaceFolder\}/g, getDataDir())),
    }
  }

  return {
    name,
    ...parts,
    env: normalizeEnv(entry.env ?? entry.environment),
    source,
    sourceFile: '',
    transport: 'stdio',
    enabled: entry.enabled,
    importable: true,
  }
}

function dedupe(servers: DiscoveredMCPServer[]): DiscoveredMCPServer[] {
  const seen = new Set<string>()
  const out: DiscoveredMCPServer[] = []
  for (const s of servers) {
    const key = `${s.source}:${s.name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

function collect(source: MCPSource, spec: string[], parser: (name: string, entry: any) => DiscoveredMCPServer | null): DiscoveredMCPServer[] {
  const out: DiscoveredMCPServer[] = []
  for (const file of configPaths(spec)) {
    const raw = readConfig(file)
    if (!raw) continue
    let servers: Record<string, any> = {}
    if (source === 'opencode') {
      servers = raw.mcp || {}
    } else {
      servers = raw.mcpServers || {}
    }
    for (const [name, entry] of Object.entries(servers)) {
      const norm = parser(name, entry)
      if (norm) {
        norm.sourceFile = file
        out.push(norm)
      }
    }
  }
  return out
}

const OPENCODE_SPEC = [
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc',
  '~/.opencode.json',
]

const CLAUDE_SPEC = [
  '~/.claude.json',
  '~/.claude/settings.json',
  '~/.claude/mcp-servers.json',
]

const CURSOR_SPEC = [
  '~/.cursor/mcp.json',
  '~/.cursor/mcp.jsonc',
]

export function discoverOpenCodeServers(): DiscoveredMCPServer[] {
  return collect('opencode', OPENCODE_SPEC, (name, entry) =>
    normalizeEntry(name, entry, 'opencode'),
  )
}

export function discoverClaudeServers(): DiscoveredMCPServer[] {
  return collect('claude', CLAUDE_SPEC, (name, entry) =>
    normalizeEntry(name, entry, 'claude'),
  )
}

export function discoverCursorServers(): DiscoveredMCPServer[] {
  return collect('cursor', CURSOR_SPEC, (name, entry) =>
    normalizeEntry(name, entry, 'cursor', { replaceWorkspace: true }),
  )
}

export function discoverMCPServers(): DiscoveredMCPServer[] {
  const found = dedupe([
    ...discoverOpenCodeServers(),
    ...discoverClaudeServers(),
    ...discoverCursorServers(),
  ])
  return found.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
}

export { normalizeEntry as normalizeDiscoveredEntry }
