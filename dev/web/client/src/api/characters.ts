import { apiGet, apiPost, apiPut, apiDelete, apiUrl } from './client'
import type { Character, CharacterStats } from '@/types'

export const fetchCharacters = () => apiGet<Character[]>('/api/characters')

export const fetchCharacter = (id: string) => apiGet<Character>(`/api/characters/${id}`)

export const fetchCharacterStats = (id: string) => apiGet<CharacterStats>(`/api/characters/${id}/stats`)

export const createCharacter = (data: Partial<Character> & { id?: string }) =>
  apiPost<Character>('/api/characters', data)

export const updateCharacter = (id: string, data: Partial<Character>) =>
  apiPut<Character>(`/api/characters/${id}`, data)

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

export interface CharacterVisual {
  schemaVersion: 1
  originalAssetId?: string
  avatarAssetId?: string
  portraitAssetId?: string
  avatarCrop?: { x: number; y: number; scale: number }
  portraitCrop?: { x: number; y: number; scale: number }
  defaultMotion: CharacterMotion
  motions: Partial<Record<CharacterMotion, { assetId: string; loop?: boolean }>>
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
