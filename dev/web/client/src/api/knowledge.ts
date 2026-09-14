import { apiGet, apiPost, apiPut, apiDelete } from './client'

/** 知识库元数据（与后端 knowledgeStore 对齐）。 */
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  rootPath: string
  createdAt: number
  updatedAt: number
}

/** 库内扫描出的文件（P2 起：非 md 的可转换文档带 converters 选项）。 */
export interface KnowledgeFileEntry {
  relPath: string
  name: string
  dir: string
  ext: string
  size: number
  mtimeMs: number
  /** 可用的转换器 id 列表（空 = 直接可读或无转换器）。 */
  converters: string[]
  /** 是否已有 Markdown 副本。 */
  hasMd: boolean
  /** 最近一次转换记录（可选）。 */
  converted?: {
    fileName: string
    relPath?: string
    mdRelPath: string
    status: 'pending' | 'converting' | 'indexed' | 'error'
    error?: string
    converter?: string
    updatedAt: number
  } | null
}

/** 搜索命中（score_md 评分，与后端 KnowledgeSearchHit 对齐）。 */
export interface KnowledgeSearchHit {
  handle: string
  kbId: string
  kbName: string
  relPath: string
  heading: string
  snippet: string
  score: number
  startLine: number
  endLine: number
}

/** P2 外部转换器（与后端 converter-registry 对齐）。 */
export interface KnowledgeConverter {
  id: string
  name: string
  installed: boolean
  available: boolean
  detected: boolean
  version?: string
  inputExtensions: string[]
  installCommand: string
}

export const fetchKnowledgeBases = () => apiGet<{ bases: KnowledgeBase[] }>('/api/knowledge/bases')

export const createKnowledgeBase = (data: { name: string; description?: string; rootPath: string }) =>
  apiPost<{ kb: KnowledgeBase }>('/api/knowledge/bases', data)

export const updateKnowledgeBase = (id: string, data: { name?: string; description?: string }) =>
  apiPut<{ kb: KnowledgeBase }>(`/api/knowledge/bases/${encodeURIComponent(id)}`, data)

export const deleteKnowledgeBase = (id: string) =>
  apiDelete(`/api/knowledge/bases/${encodeURIComponent(id)}`)

/** 扫描库内文档（后端每次实时扫目录，P1 无索引）。 */
export const fetchKnowledgeFiles = (id: string) =>
  apiGet<{ kb: KnowledgeBase; files: KnowledgeFileEntry[] }>(`/api/knowledge/bases/${encodeURIComponent(id)}/files`)

/** 读取文档全文（路径按段编码，与后端 :path{.*} 匹配）。 */
export const fetchKnowledgeFileContent = (id: string, relPath: string) =>
  apiGet<{ content: string; relPath: string }>(
    `/api/knowledge/bases/${encodeURIComponent(id)}/files/${relPath.split('/').map(s => encodeURIComponent(s)).join('/')}`,
  )

/** 知识库全文搜索（可限定库作用域）。 */
export const searchKnowledgeApi = (query: string, kbIds?: string[], limit = 10) =>
  apiPost<{ query: string; hits: KnowledgeSearchHit[] }>('/api/knowledge/search', { query, kb_ids: kbIds, limit })

/** P2：转换器列表（含可用性探测）。 */
export const fetchConverters = () =>
  apiGet<{ converters: KnowledgeConverter[] }>('/api/knowledge/converters')

/** P2：登记转换器（安装按钮）并触发探测。 */
export const detectConverter = (id: string) =>
  apiPost<{ converter: KnowledgeConverter }>(`/api/knowledge/converters/${encodeURIComponent(id)}/detect`, {})

/** P2：用外部转换器转换文件（file = 相对 rootPath 的路径或绝对路径）。 */
export const convertWithExternal = (converterId: string, kbId: string, file: string, timeoutMs?: number) =>
  apiPost<{ ok: boolean; kbId: string; converter: string; source: string; relPath?: string; mdRelPath: string; bytes: number }>(
    `/api/knowledge/convert/${encodeURIComponent(converterId)}`,
    { kb_id: kbId, file },
    timeoutMs,
  )

/** P2：读取转换后的 Markdown 副本（normalized/{kbId}/ 内）。 */
export const fetchKnowledgeMdCopy = (id: string, mdRelPath: string) =>
  apiGet<{ content: string; relPath: string }>(
    `/api/knowledge/bases/${encodeURIComponent(id)}/normalized/${mdRelPath.split('/').map(s => encodeURIComponent(s)).join('/')}`,
  )
