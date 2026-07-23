import { apiGet, apiPost } from './client'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export interface BrowseResult {
  entries: DirEntry[]
  currentPath: string
  parentPath: string | null
}

export function browseDirectory(path?: string) {
  const q = path ? `?path=${encodeURIComponent(path)}` : ''
  return apiGet<BrowseResult>(`/api/workspace/list${q}`)
}

export function resolvePath(name: string) {
  return apiPost<{ path: string | null }>('/api/workspace/resolve', { name })
}
