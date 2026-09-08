/**
 * 知识库 REST 路由（KNOWLEDGE_P1_PLAN §4）。
 *
 * - /api/knowledge/bases        GET 列表 / POST 创建 / PUT 更新（:id）
 * - /api/knowledge/bases/:id    DELETE 删除
 * - /api/knowledge/bases/:id/files   GET 扫描该库目录下的文档（.md/.markdown/.txt）
 * - /api/knowledge/bases/:id/files/*  GET 读取文档内容
 * - /api/knowledge/search       POST 全文搜索（作用于挂载作用域）
 */
import { Hono } from 'hono'
import { knowledgeStore } from '../knowledge/store.js'
import { searchKnowledge } from '../knowledge/search.js'

export const knowledgeRouter = new Hono()

// ── bases 注册表 ──

knowledgeRouter.get('/bases', (c) => {
  return c.json({ bases: knowledgeStore.list() })
})

knowledgeRouter.post('/bases', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const kb = knowledgeStore.create({
      name: String(body.name ?? ''),
      description: body.description == null ? undefined : String(body.description),
      rootPath: String(body.rootPath ?? ''),
    })
    return c.json({ kb }, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '创建失败' }, 400)
  }
})

knowledgeRouter.put('/bases/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const kb = knowledgeStore.update(c.req.param('id'), {
      name: body.name == null ? undefined : String(body.name),
      description: body.description == null ? undefined : String(body.description),
    })
    if (!kb) return c.json({ error: '知识库不存在' }, 404)
    return c.json({ kb })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '更新失败' }, 400)
  }
})

knowledgeRouter.delete('/bases/:id', (c) => {
  if (!knowledgeStore.delete(c.req.param('id'))) {
    return c.json({ error: '知识库不存在' }, 404)
  }
  return c.json({ ok: true })
})

// ── 文件浏览 ──

knowledgeRouter.get('/bases/:id/files', (c) => {
  const result = knowledgeStore.listFiles(c.req.param('id'))
  if (!result) return c.json({ error: '知识库不存在' }, 404)
  return c.json({ kb: result.kb, files: result.files })
})

knowledgeRouter.get('/bases/:id/files/:path{.*}', (c) => {
  const relPath = c.req.param('path') ?? ''
  if (!relPath) return c.json({ error: '缺少文档路径' }, 400)
  try {
    const doc = knowledgeStore.readFile(c.req.param('id'), relPath)
    if (!doc) return c.json({ error: '文档不存在' }, 404)
    return c.json({ content: doc.content, relPath })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '读取失败' }, 400)
  }
})

// ── 搜索（F1 提供 search 端点；后续可加 role 权限） ──

knowledgeRouter.post('/search', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { query?: unknown; kb_ids?: unknown; limit?: unknown }
  const query = String(body.query ?? '').trim()
  if (!query) return c.json({ error: '缺少查询词' }, 400)
  const kbIds = Array.isArray(body.kb_ids) ? body.kb_ids.filter((x): x is string => typeof x === 'string') : undefined
  const limit = typeof body.limit === 'number' ? Math.min(Math.max(1, Math.floor(body.limit)), 50) : 10
  const hits = searchKnowledge(query, { kbIds, limit })
  return c.json({ query, hits })
})
