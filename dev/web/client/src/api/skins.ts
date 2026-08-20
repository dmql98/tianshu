import { apiGet, apiPost, apiPut, apiDelete, apiUrl } from './client'
import type { CharacterMotion } from './characters'

/** 皮肤 6 个动画仅用现有枚举的子集。 */
export type SkinMotion = 'idle' | 'thinking' | 'working' | 'speaking' | 'success' | 'error'

export const SKIN_MOTIONS: SkinMotion[] = ['idle', 'thinking', 'working', 'speaking', 'success', 'error']

export interface SkinSlotEntry {
  slot: 'portrait' | 'avatar'
  filename: string
  mime: string
}

export interface SkinMotionEntry {
  motion: SkinMotion
  filename: string
  mime: string
}

export interface Skin {
  id: string
  name: string
  description?: string
  original?: SkinSlotEntry
  portrait?: SkinSlotEntry
  avatar?: SkinSlotEntry
  motions: Partial<Record<SkinMotion, SkinMotionEntry>>
  boundCharacters?: string[]
  dir: string
}

export const fetchSkins = () => apiGet<Skin[]>('/api/skins')

export const fetchSkin = (id: string) => apiGet<Skin>(`/api/skins/${encodeURIComponent(id)}`)

export const createSkin = (data: { id?: string; name: string; description?: string }) =>
  apiPost<Skin>('/api/skins', data)

export const updateSkin = (id: string, data: { name?: string; description?: string; boundCharacters?: string[] }) =>
  apiPut<Skin>(`/api/skins/${encodeURIComponent(id)}`, data)

export const deleteSkin = (id: string) =>
  apiDelete(`/api/skins/${encodeURIComponent(id)}`)

export const bindSkinCharacter = (id: string, characterId: string, bind: boolean) =>
  apiPost<Skin>(`/api/skins/${encodeURIComponent(id)}/bind`, { characterId, bind })

export function skinFileUrl(skinId: string, filename: string): string {
  return apiUrl(`/api/skins/${encodeURIComponent(skinId)}/file/${encodeURIComponent(filename)}`)
}

/** 上传皮肤文件。slot: 'original' | 'portrait' | 'avatar' | SkinMotion */
export async function uploadSkinFile(id: string, slot: 'original' | 'portrait' | 'avatar' | SkinMotion, file: File): Promise<Skin> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(apiUrl(`/api/skins/${encodeURIComponent(id)}/upload/${slot}`), {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error(`上传失败：${response.status} ${await response.text()}`)
  return response.json() as Promise<Skin>
}

export type { CharacterMotion }
