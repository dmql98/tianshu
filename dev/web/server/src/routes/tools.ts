import { Hono } from 'hono'
import { readdirSync } from 'fs'
import { resolve } from 'path'
import { mcpServerStore } from '../db/toolStore.js'
import { connectMCPServer, disconnectMCPServer } from '../tools/mcp-client.js'
import { getAllMCPStatuses } from '../tools/mcp-status.js'
import { discoverMCPServers } from '../tools/mcp_discovery.js'
import { readToolMeta } from '../tools/tool-meta.js'
import { isAutoManagedTool } from '../tools/definitions.js'

const TOOLS_DIR = resolve(import.meta.dirname, '../tools')

function readToolMetas(): Array<{ name: string; description: string; source: string; constraintFields: any[] }> {
  const results: Array<{ name: string; description: string; source: string; constraintFields: any[] }> = []
  const entries = readdirSync(TOOLS_DIR, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '_template') continue
    const meta = readToolMeta(e.name)
    if (!meta) continue
    // 自动门控工具（记忆工具 / skill_manager）不进入工具管理列表：它们的注入由
    // memoryMode / 技能列表自动决定，不是可供用户手动配置的开关。
    if (isAutoManagedTool(meta.name || e.name)) continue
    results.push({
      name: meta.name || e.name,
      description: meta.description || '',
      source: meta.source || 'builtin',
      constraintFields: meta.constraintFields || [],
    })
  }
  return results
}

const router = new Hono()

router.get('/', (c) => {
  const mcpServers = mcpServerStore.getAll()
  const mcpStatuses = getAllMCPStatuses()
  const tools = [
    ...readToolMetas(),
    ...mcpServers.map(s => ({
      name: s.name,
      description: `MCP server: ${s.name}`,
      source: 'mcp' as const,
      status: mcpStatuses[s.name] || null,
    })),
  ]
  return c.json({ tools, mcpServers, mcpStatuses })
})

router.post('/mcp', async (c) => {
  const body = await c.req.json()
  const record = mcpServerStore.create(body)
  return c.json(record, 201)
})

router.put('/mcp/:id', async (c) => {
  const body = await c.req.json()
  const updated = mcpServerStore.update(c.req.param('id'), body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})

router.delete('/mcp/:id', (c) => {
  if (!mcpServerStore.delete(c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

router.post('/mcp/:id/test', async (c) => {
  const id = c.req.param('id')
  const config = mcpServerStore.getById(id)
  if (!config) return c.json({ error: 'MCP server not found' }, 404)
  try {
    const client = await connectMCPServer(config)
    const tools = client.tools.map(t => ({ name: t.name, description: t.description }))
    await disconnectMCPServer(client)
    return c.json({ ok: true, toolCount: tools.length, tools, serverName: config.name })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || String(err) }, 200)
  }
})

router.get('/mcp/discover', (c) => {
  const discovered = discoverMCPServers()
  const existing = new Set(mcpServerStore.getAll().map(s => s.name))
  return c.json({
    servers: discovered.map(s => ({ ...s, alreadyExists: existing.has(s.name) })),
  })
})

router.post('/mcp/import', async (c) => {
  const body = await c.req.json()
  const names = body.names
  if (!Array.isArray(names) || names.length === 0) {
    return c.json({ error: 'names (array) is required' }, 400)
  }
  const discovered = discoverMCPServers()
  const byName = new Map(discovered.map(s => [s.name, s]))
  const existing = mcpServerStore.getAll()

  const imported: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  const errors: Array<{ name: string; error: string }> = []

  for (const rawName of names) {
    const name = String(rawName)
    const server = byName.get(name)
    if (!server) {
      skipped.push({ name, reason: 'not found in discovery' })
      continue
    }
    if (!server.importable) {
      skipped.push({ name, reason: `transport ${server.transport} not supported (stdio only)` })
      continue
    }
    if (existing.some(s => s.name === name)) {
      skipped.push({ name, reason: 'already exists' })
      continue
    }
    try {
      mcpServerStore.create({
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
        timeout: server.timeout,
      })
      imported.push(name)
    } catch (err: any) {
      errors.push({ name, error: err.message || String(err) })
    }
  }
  return c.json({ imported, skipped, errors })
})

export default router
