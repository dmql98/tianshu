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

/** 库内扫描出的文档文件。 */
export interface KnowledgeFileEntry {
  relPath: string
  name: string
  dir: string
  ext: string
  size: number
  mtimeMs: number
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
