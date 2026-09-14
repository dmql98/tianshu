/**
 * 知识库 REST 路由（KNOWLEDGE_P1_PLAN §4 / 06 P2 外部转换器）。
 *
 * - /api/knowledge/bases        GET 列表 / POST 创建 / PUT 更新（:id）
 * - /api/knowledge/bases/:id    DELETE 删除
 * - /api/knowledge/bases/:id/files   GET 扫描该库目录下的文档（.md/.markdown/.txt）
 * - /api/knowledge/bases/:id/files/*  GET 读取文档内容
 * - /api/knowledge/search       POST 全文搜索（作用于挂载作用域）
 * - /api/knowledge/converters          GET 转换器列表（含可用性探测）
 * - /api/knowledge/converters/:id/detect POST 登记（安装按钮）并触发探测
 * - /api/knowledge/convert/:id          POST 用外部转换器转换文件（file = originals/ 或绝对路径）
 */
import { Hono } from 'hono'
import { knowledgeStore, normalizedDir, originalsDir } from '../knowledge/store.js'
import { searchKnowledge } from '../knowledge/search.js'
import { converterRegistry, BUILTIN_CONVERTERS } from '../knowledge/converter-registry.js'
import { existsSync, readFileSync } from 'fs'
import { basename, isAbsolute, join, relative, resolve } from 'path'

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

// ── P2 外部转换器 ──

knowledgeRouter.get('/converters', (c) => {
  const list = converterRegistry.list()
  return c.json({
    converters: list.map(x => ({
      id: x.id,
      name: x.name,
      installed: x.installed,
      available: x.available,
      detected: x.detected,
      version: x.version,
      inputExtensions: x.inputExtensions,
      installCommand: x.installCommand,
    })),
  })
})

knowledgeRouter.post('/converters/:id/detect', (c) => {
  try {
    const id = c.req.param('id')
    const known = BUILTIN_CONVERTERS.some(x => x.id === id)
    if (!known) return c.json({ error: '未知转换器' }, 404)
    const desc = converterRegistry.install(id)
    if (!desc) return c.json({ error: '未知转换器' }, 404)
    return c.json({
      converter: {
        id: desc.id,
        name: desc.name,
        installed: desc.installed,
        available: desc.available,
        version: desc.version,
        inputExtensions: desc.inputExtensions,
      },
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '探测失败' }, 400)
  }
})

knowledgeRouter.post('/convert/:id', async (c) => {
  const converterId = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { kb_id?: unknown; file?: unknown }
  const kbId = String(body.kb_id ?? '')
  const file = String(body.file ?? '')
  if (!kbId) return c.json({ error: '缺少 kb_id' }, 400)
  if (!file) return c.json({ error: '缺少 file' }, 400)
  const kb = knowledgeStore.get(kbId)
  if (!kb) return c.json({ error: '知识库不存在' }, 404)

  // 解析源文件：originals/{kbId}/{file} → 绝对路径 → rootPath 相对路径
  let sourcePath: string | null = null
  const origCandidate = join(originalsDir(kbId), basename(file))
  if (existsSync(origCandidate)) sourcePath = origCandidate
  else if (isAbsolute(file) && existsSync(file)) sourcePath = file
  else {
    const inRoot = resolve(kb.rootPath, file)
    if (existsSync(inRoot)) sourcePath = inRoot
  }
  if (!sourcePath) return c.json({ error: `找不到源文件: ${file}` }, 404)

  const fileName = basename(sourcePath)
  // relPath 精确到 rootPath 内的相对路径（POSIX），供文件列表 md 标签匹配。
  const relPath = isAbsolute(file) && file.replace(/\\/g, '/') !== resolve(kb.rootPath, file).replace(/\\/g, '/')
    ? undefined
    : relative(kb.rootPath, sourcePath).replace(/\\/g, '/')
  const mdRel = `normalized/${fileName.replace(/\.[^.]+$/, '')}.md`
  knowledgeStore.upsertConverted(kbId, {
    fileName, relPath, mdRelPath: mdRel, status: 'converting', converter: converterId, updatedAt: Date.now(),
  })
  const result = await converterRegistry.convert(converterId, sourcePath, normalizedDir(kbId))
  if (!result.ok) {
    knowledgeStore.upsertConverted(kbId, {
      fileName, relPath, mdRelPath: mdRel, status: 'error', error: result.error, converter: converterId, updatedAt: Date.now(),
    })
    return c.json({ error: result.error, status: 'error' }, 400)
  }
  const content = readFileSync(result.outputPath, 'utf-8')
  const savedRel = knowledgeStore.saveNormalized(kbId, fileName, content)
  knowledgeStore.upsertConverted(kbId, {
    fileName, relPath, mdRelPath: savedRel, status: 'indexed', converter: converterId, updatedAt: Date.now(),
  })
  return c.json({ ok: true, kbId, converter: converterId, source: fileName, relPath, mdRelPath: savedRel, bytes: content.length })
})

// ── 读取转换后的 Markdown 副本（normalized/{kbId}/ 内，按 relPath 映射）──

knowledgeRouter.get('/bases/:id/normalized/:path{.*}', (c) => {
  const kbId = c.req.param('id')
  const mdPath = c.req.param('path') ?? ''
  if (!mdPath) return c.json({ error: '缺少文档路径' }, 400)
  const content = knowledgeStore.readNormalized(kbId, basename(mdPath))
  if (content === null) return c.json({ error: 'Markdown 副本不存在' }, 404)
  return c.json({ content, relPath: mdPath })
})
