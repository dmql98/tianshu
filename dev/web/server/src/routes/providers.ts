import { Hono } from 'hono'
import { providerStore } from '../db/providerStore.js'
import { detectAvailable } from '../providers/index.js'

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

router.get('/', (c) => c.json(providerStore.getAll()))
router.get('/builtin', (c) => c.json(providerStore.getBuiltin()))
router.get('/custom', (c) => c.json(providerStore.getCustom()))
router.get('/detect', (c) => c.json(detectAvailable().map(p => ({
  id: p.id, name: p.name, format: p.format,
  envKey: p.envKey, available: true,
}))))
router.post('/', async (c) => {
  const body = await c.req.json()
  return c.json(providerStore.create(body), 201)
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
      return {
        id: m.id || m.name,
        name: m.name || m.id,
        context_window: apiValue || catalog[mid] || undefined,
      }
    })
    return c.json(models)
  } catch (e: any) {
    return c.json({ error: e.message }, 502)
  }
})

export default router
