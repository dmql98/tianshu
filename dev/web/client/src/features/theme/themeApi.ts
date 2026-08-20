/**
 * 自定义主题客户端 API（TIANSHU_THEME_SWITCHING_PLAN §8）。
 *
 * 服务端 <dataDir>/themes 是自定义主题的唯一事实来源；前端只通过 API 拉取
 * 列表/定义/资产。图片与完整主题绝不写入 localStorage。
 */
import { apiDelete, apiGet, apiPost, apiPut, apiUrl } from '@/api/client'
import {
  normalizeThemeDefinition,
  type ThemeDefinition,
} from './themeDefinitions'

export interface ThemeAssetMeta {
  name: string
  kind: 'background' | 'preview'
  bytes: number
  mime: string
  width: number
  height: number
}

export interface ThemeDto {
  id: string
  name: string
  appearance: 'light' | 'dark'
  schemaVersion: number
  artwork?: {
    file?: string
    preview?: string
    focusX: number
    focusY: number
    scale: number
    homeOpacity: number
    taskOpacity: number
    dim: number
    flipX?: boolean
    flipY?: boolean
  }
  colors: Record<string, string>
  home?: { title: string }
  createdAt: string
  updatedAt: string
}

/** 服务端主题 → 客户端 ThemeDefinition（资产路径转 API URL）。 */
export function toThemeDefinition(dto: ThemeDto): ThemeDefinition {
  const normalized = normalizeThemeDefinition({
    id: dto.id,
    source: 'custom',
    name: dto.name,
    appearance: dto.appearance,
    tokens: dto.colors,
    artwork: dto.artwork ? {
      url: dto.artwork.file ? apiUrl(`/api/themes/${encodeURIComponent(dto.id)}/assets/${encodeURIComponent(dto.artwork.file)}`) : '',
      previewUrl: dto.artwork.preview
        ? apiUrl(`/api/themes/${encodeURIComponent(dto.id)}/assets/${encodeURIComponent(dto.artwork.preview)}`)
        : undefined,
      focusX: dto.artwork.focusX,
      focusY: dto.artwork.focusY,
      scale: dto.artwork.scale,
      homeOpacity: dto.artwork.homeOpacity,
      taskOpacity: dto.artwork.taskOpacity,
      dim: dto.artwork.dim,
      flipX: dto.artwork.flipX === true,
      flipY: dto.artwork.flipY === true,
    } : undefined,
    ...(dto.home && typeof dto.home.title === 'string' && dto.home.title.trim() ? { home: { title: dto.home.title } } : {}),
    updatedAt: dto.updatedAt,
  })
  return normalized!
}

export async function fetchThemes(): Promise<ThemeDefinition[]> {
  const data = await apiGet<{ themes: ThemeDto[] }>('/api/themes')
  return (data.themes ?? [])
    .map(toThemeDefinition)
    .filter((t): t is ThemeDefinition => t !== null)
}

export async function fetchTheme(id: string): Promise<ThemeDefinition> {
  const dto = await apiGet<ThemeDto>(`/api/themes/${encodeURIComponent(id)}`)
  const theme = toThemeDefinition(dto)
  if (!theme) throw new Error('Invalid theme definition')
  return theme
}

export interface CreateThemeInput {
  name: string
  appearance: 'light' | 'dark'
  colors: Record<string, string>
  /** 首页标题（可选；空标题按未设置处理）。 */
  home?: { title: string }
  artwork: {
    focusX: number
    focusY: number
    scale: number
    homeOpacity: number
    taskOpacity: number
    dim: number
    flipX?: boolean
    flipY?: boolean
  }
  /** 背景图（可选）；浏览器 File 或 Blob。 */
  background?: File | Blob
  preview?: File | Blob
}

function themeFormData(input: CreateThemeInput): FormData {
  const form = new FormData()
  form.append('name', input.name)
  form.append('appearance', input.appearance)
  form.append('colors', JSON.stringify(input.colors))
  form.append('artwork', JSON.stringify(input.artwork))
  if (input.home && input.home.title.trim()) form.append('home', JSON.stringify(input.home))
  if (input.background) form.append('background', input.background, 'background.webp')
  if (input.preview) form.append('preview', input.preview, 'preview.webp')
  return form
}

async function apiMultipart(path: string, method: 'POST' | 'PUT', form: FormData): Promise<ThemeDto> {
  const res = await fetch(apiUrl(path), { method, body: form })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function createTheme(input: CreateThemeInput): Promise<ThemeDefinition> {
  const dto = await apiMultipart('/api/themes', 'POST', themeFormData(input))
  const theme = toThemeDefinition(dto)
  if (!theme) throw new Error('Invalid theme definition')
  return theme
}

export async function updateTheme(id: string, input: CreateThemeInput): Promise<ThemeDefinition> {
  const dto = await apiMultipart(`/api/themes/${encodeURIComponent(id)}`, 'PUT', themeFormData(input))
  const theme = toThemeDefinition(dto)
  if (!theme) throw new Error('Invalid theme definition')
  return theme
}

export async function duplicateTheme(id: string): Promise<ThemeDefinition> {
  const dto = await apiPost<ThemeDto>(`/api/themes/${encodeURIComponent(id)}/duplicate`)
  const theme = toThemeDefinition(dto)
  if (!theme) throw new Error('Invalid theme definition')
  return theme
}

export async function deleteTheme(id: string): Promise<void> {
  await apiDelete(`/api/themes/${encodeURIComponent(id)}`)
}

export async function renameTheme(id: string, name: string): Promise<ThemeDefinition> {
  const dto = await apiPut<ThemeDto>(`/api/themes/${encodeURIComponent(id)}`, { name })
  const theme = toThemeDefinition(dto)
  if (!theme) throw new Error('Invalid theme definition')
  return theme
}

export async function fetchThemeAssets(id: string): Promise<ThemeAssetMeta[]> {
  const data = await apiGet<{ assets: ThemeAssetMeta[] }>(`/api/themes/${encodeURIComponent(id)}/assets`)
  return data.assets ?? []
}

/** 资产 URL（供 <img>/背景引用）。 */
export function themeAssetUrl(id: string, file: string): string {
  return apiUrl(`/api/themes/${encodeURIComponent(id)}/assets/${encodeURIComponent(file)}`)
}
