import { Hono } from 'hono'
import { readFileSync, statSync } from 'fs'
import { providerStore } from '../db/providerStore.js'
import { loadCatalog, getPreset, getIconPath } from '../provider-catalog/loader.js'

const router = new Hono()

const MODELS_CATALOG_URL = 'https://models.dev/api.json'
const CACHE_TTL = 3600_000 // 1 hour

let catalogCache: { time: number; data: Record<string, number> } | null = null

async function getModelCatalog(): Promise<Record<string, number>> {
  if (catalogCache && Date.now() - catalogCache.time < CACHE_TTL) {
    return catalogCache.data
  }
  try {
    const res = await fetch(MODELS_CATALOG_URL, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return catalogCache?.data ?? {}
    const body = await res.json() as any
    const index: Record<string, number> = {}
    for (const provider of Object.values(body) as any[]) {
      for (const [modelId, model] of Object.entries(provider.models || {}) as any) {
        const ctx = (model as any).limit?.context
        if (ctx) index[modelId.toLowerCase()] = ctx
      }
    }
    catalogCache = { time: Date.now(), data: index }
    return index
  } catch {
    return catalogCache?.data ?? {}
  }
}

/** 环境变量可用性：只返回布尔值，绝不返回实际值。 */
function envAvailable(preset: ReturnType<typeof loadCatalog>['presets'][number]): boolean {
  return (preset.env ?? []).some(name => {
    const v = process.env[name]
    return v !== undefined && v !== ''
  })
}

/**
 * GET /api/providers/builtin — 返回标准化预设列表。
 * 安全：不返回环境变量实际值、不返回已保存的 API Key、不写 providers.json。
 */
router.get('/builtin', (c) => {
  const { presets } = loadCatalog()
  const userIds = new Set(providerStore.getAll().map(p => p.preset_id).filter(Boolean))
  return c.json(presets.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    format: p.format,
    runtime_plugin: p.runtime.plugin,
    base_url: p.baseUrl,
    env: p.env ?? [],
    env_available: envAvailable(p),
    icon_url: `/api/providers/builtin/${encodeURIComponent(p.id)}/icon`,
    popular: p.popular ?? false,
    sort_order: p.sortOrder ?? Number.MAX_SAFE_INTEGER,
    fields: p.fields ?? [],
    added: userIds.has(p.id),
  })))
})

/**
 * GET /api/providers/builtin/:id/icon — 返回预设图标。
 * 只允许访问 loader 已注册的图标，禁止路径拼接；未知 Provider 返回 404。
 */
router.get('/builtin/:id/icon', (c) => {
  const id = c.req.param('id')
  const preset = getPreset(id)
  const iconPath = getIconPath(id)
  if (!preset || !iconPath) return c.json({ error: 'Not found' }, 404)
  let body: string
  let mtimeMs: number
  try {
    body = readFileSync(iconPath, 'utf-8')
    mtimeMs = statSync(iconPath).mtimeMs
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
  const etag = `"${Buffer.from(body).toString('base64').slice(0, 27)}"`
  c.header('Content-Type', 'image/svg+xml')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'public, max-age=86400')
  c.header('ETag', etag)
  c.header('Last-Modified', new Date(mtimeMs).toUTCString())
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304)
  }
  return c.body(body)
})

router.get('/', (c) => c.json(providerStore.getAll()))
router.post('/', async (c) => {
  const body = await c.req.json()
  const { conflict, record } = providerStore.create(body)
  if (conflict) return c.json({ error: '该预设服务商已添加', conflict: true }, 409)
  return c.json(record, 201)
})
router.put('/:id', async (c) => {
  const body = await c.req.json()
  const updated = providerStore.update(c.req.param('id'), body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})
router.delete('/:id', (c) => {
  if (!providerStore.delete(c.req.param('id'))) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

router.post('/:id/test', async (c) => {
  const provider = providerStore.getById(c.req.param('id'))
  if (!provider) return c.json({ error: 'Not found' }, 404)
  try {
    const res = await fetch(`${provider.base_url.replace(/\/+$/, '')}/models`, {
      headers: provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {},
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      // Probe which API protocols report cache hits. chat/completions is the
      // default; responses is reported when /v1/responses returns
      // usage.input_tokens_details.cached_tokens.
      let protocols: { chat: boolean; responses?: boolean } = { chat: true }
      try {
        const { probeResponsesApi } = await import('../llm/client.js')
        const sample = provider.models?.[0]?.id
        if (sample) protocols.responses = await probeResponsesApi(provider.base_url, provider.api_key || '', sample, provider.headers)
      } catch {
        /* protocol probe is best-effort */
      }
      return c.json({ ok: true, status: res.status, protocols })
    } else {
      return c.json({ ok: false, status: res.status, error: `HTTP ${res.status}` })
    }
  } catch (e: any) {
    return c.json({ ok: false, error: e.message || 'Connection failed' })
  }
})

router.get('/:id/models', async (c) => {
  const provider = providerStore.getById(c.req.param('id'))
  if (!provider) return c.json({ error: 'Not found' }, 404)
  try {
    const catalogPromise = getModelCatalog()
    const res = await fetch(`${provider.base_url.replace(/\/+$/, '')}/models`, {
      headers: provider.api_key ? { Authorization: `Bearer ${provider.api_key}` } : {},
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return c.json({ error: `Provider API ${res.status}` }, 502)
    const body = await res.json() as any
    const catalog = await catalogPromise
    const models = (body.data || body.models || []).map((m: any) => {
      const mid = (m.id || m.name || '').toLowerCase()
      const apiValue = m.context_window || m.context_length
      // Preserve per-model overrides (enabled / api_style / hand-set context)
      // so refreshing the list never silently resets them.
      const existing = (provider.models || []).find(x => x.id === (m.id || m.name))
      return {
        id: m.id || m.name,
        name: m.name || m.id,
        context_window: existing?.context_window_overridden
          ? existing?.context_window
          : (apiValue || catalog[mid] || existing?.context_window),
        context_window_overridden: existing?.context_window_overridden,
        enabled: existing?.enabled,
        api_style: existing?.api_style,
      }
    })
    return c.json(models)
  } catch (e: any) {
    return c.json({ error: e.message }, 502)
  }
})

export default router
