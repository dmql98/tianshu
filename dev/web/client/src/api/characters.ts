import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUrl } from './client'
import type { Character, CharacterStats } from '@/types'

export const fetchCharacters = () => apiGet<Character[]>('/api/characters')

export const fetchCharacter = (id: string) => apiGet<Character>(`/api/characters/${id}`)

export const fetchCharacterStats = (id: string) => apiGet<CharacterStats>(`/api/characters/${id}/stats`)

// ── 记忆浏览器（用户操作 REST：浏览 / 编辑 / 归档恢复 / 永久删除 / 审计）──
export type MemoryEntryType = 'fact' | 'preference' | 'decision' | 'note'

export interface MemoryEntryItem {
  id: string
  ts: string
  type: MemoryEntryType
  content: string
  archived: boolean
}

export interface MemoryStatsItem {
  mode: 'off' | 'read_only' | 'editable'
  total: number
  active: number
  archived: number
  char_usage: number
  char_limit: number
}

export interface MemoryOverviewItem {
  /** 摘要块（活跃条目渲染：`type｜content`）。 */
  blocks: string[]
  /** 全部活跃条目渲染总字符。 */
  used: number
  /** 生效预算（真实角色配置或后端缺省）。 */
  budget: number
  /** 已超预算（触底保护期常见）。 */
  overBudget: boolean
}

export interface MemoryView {
  entries: MemoryEntryItem[]
  stats: MemoryStatsItem
  overview: MemoryOverviewItem
}

export interface MemoryMutationResponse {
  ok: boolean
  error?: string
  entry?: MemoryEntryItem
  view: MemoryView
}

export interface MemoryAuditRow {
  ts: string
  actor: 'Agent' | '用户'
  action: string
  target?: string
  detail?: string
}

export const fetchCharacterMemory = (id: string) =>
  apiGet<MemoryView>(`/api/characters/${encodeURIComponent(id)}/memory`)

export const updateCharacterMemoryEntry = (id: string, entryId: string, patch: { content?: string; type?: MemoryEntryType }) =>
  apiPatch<MemoryMutationResponse>(`/api/characters/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}`, patch)

export const setCharacterMemoryEntryArchived = (id: string, entryId: string, archived: boolean) =>
  apiPost<MemoryMutationResponse>(`/api/characters/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}/archive`, { archived })

/** 永久删除：仅用户前端手动操作（Agent 工具无此能力）。 */
export const deleteCharacterMemoryEntry = (id: string, entryId: string) =>
  apiDelete<MemoryMutationResponse>(`/api/characters/${encodeURIComponent(id)}/memory/${encodeURIComponent(entryId)}`)

export const fetchCharacterMemoryAudit = (id: string) =>
  apiGet<{ entries: MemoryAuditRow[] }>(`/api/characters/${encodeURIComponent(id)}/memory/audit`)

export const createCharacter = (data: Partial<Character> & { id?: string }) =>
  apiPost<Character>('/api/characters', data)

export const updateCharacter = (id: string, data: Partial<Character>) =>
  apiPut<Character>(`/api/characters/${id}`, data)

export const updateCharacterSkillBinding = (id: string, action: 'bind' | 'unbind', packageId: string) =>
  apiPost<Character>(`/api/characters/${encodeURIComponent(id)}/skill-bindings`, { action, packageId })

export const deleteCharacter = (id: string) =>
  apiDelete(`/api/characters/${id}`)

export type CharacterMotion =
  | 'idle' | 'blink' | 'breathe' | 'listening' | 'thinking' | 'speaking'
  | 'toolCalling' | 'working' | 'success' | 'error' | 'happy' | 'touched'
  | 'wave' | 'walk' | 'jump' | 'sleep'

export interface CharacterAssetRef {
  assetId: string
  kind: 'static' | 'animated-image' | 'video' | 'sprite-sheet' | 'frame-sequence' | 'live2d' | 'spine' | 'rive'
  mime: string
  filename: string
}

export interface CharacterMotionBinding {
  assetId: string
  loop?: boolean
  crop?: { x: number; y: number; scale: number }
}

export interface CharacterVisual {
  schemaVersion: 1
  originalAssetId?: string
  avatarAssetId?: string
  portraitAssetId?: string
  avatarCrop?: { x: number; y: number; scale: number }
  portraitCrop?: { x: number; y: number; scale: number }
  defaultMotion: CharacterMotion
  motions: Partial<Record<CharacterMotion, CharacterMotionBinding>>
  stage?: Record<string, unknown>
}

export interface CharacterVisualResponse {
  visual: CharacterVisual
  assets: CharacterAssetRef[]
}

export const fetchCharacterVisual = (id: string) =>
  apiGet<CharacterVisualResponse>(`/api/characters/${id}/visual`)

export const saveCharacterVisual = (id: string, visual: CharacterVisual) =>
  apiPut<CharacterVisual>(`/api/characters/${id}/visual`, visual)

export const characterAssetUrl = (characterId: string, assetId: string) =>
  apiUrl(`/api/characters/${encodeURIComponent(characterId)}/assets/${encodeURIComponent(assetId)}`)

export const fetchCharacterPresence = (id: string) =>
  apiGet<{
    characterId: string
    characterRevisionId: string | null
    sessionId: string | null
    runId: string | null
    motion: CharacterMotion
    since: number
  }>(`/api/characters/${id}/presence`)

export async function uploadCharacterAsset(
  id: string,
  file: File,
  kind?: CharacterAssetRef['kind'],
  purpose?: 'original',
) {
  const form = new FormData()
  form.append('file', file)
  if (kind) form.append('kind', kind)
  if (purpose) form.append('purpose', purpose)
  const response = await fetch(apiUrl(`/api/characters/${encodeURIComponent(id)}/assets`), {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error(`上传失败：${response.status} ${await response.text()}`)
  return response.json() as Promise<CharacterAssetRef>
}

export const publishCharacterRevision = (id: string) =>
  apiPost<{ id: string; revision_no: number; manifest_hash: string }>(
    `/api/characters/${id}/revisions`,
  )

export async function exportCharacterPackage(id: string): Promise<void> {
  const url = apiUrl(`/api/characters/${encodeURIComponent(id)}/export`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Export failed: ${response.status}`)
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${id}.tianshu-character.gz`
  link.click()
  URL.revokeObjectURL(link.href)
}

export async function importCharacterPackage(
  file: File,
  conflict: 'error' | 'replace' | 'new' = 'error',
): Promise<{ character: Character; revision: unknown }> {
  const form = new FormData()
  form.append('file', file)
  form.append('conflict', conflict)
  const response = await fetch(apiUrl('/api/characters/import'), {
    method: 'POST',
    body: form,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `Import failed: ${response.status}`)
  return body
}
