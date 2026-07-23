import { Hono } from 'hono'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { mcpServerStore } from '../db/toolStore.js'
import { connectMCPServer, disconnectMCPServer } from '../tools/mcp-client.js'
import { getAllMCPStatuses } from '../tools/mcp-status.js'

const TOOLS_DIR = resolve(import.meta.dirname, '../tools')

function readToolMetas(): Array<{ name: string; description: string; source: string; constraintFields: any[] }> {
  const results: Array<{ name: string; description: string; source: string; constraintFields: any[] }> = []
  const entries = readdirSync(TOOLS_DIR, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '_template') continue
    const jsonPath = resolve(TOOLS_DIR, e.name, 'tool.json')
    if (!existsSync(jsonPath)) continue
    try {
      let text = readFileSync(jsonPath, 'utf-8')
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
      const meta = JSON.parse(text)
      results.push({
        name: meta.name || e.name,
        description: meta.description || '',
        source: meta.source || 'builtin',
        constraintFields: meta.constraintFields || [],
      })
    } catch { /* skip invalid tool.json */ }
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
    const toolCount = client.tools.length
    await disconnectMCPServer(client)
    return c.json({ ok: true, toolCount, serverName: config.name })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message || String(err) }, 200)
  }
})

export default router
