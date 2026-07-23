import { apiGet } from './client'

export interface SkillMeta {
  name: string
  description: string
  tags: string[]
  category: string
  version?: string
  author?: string
}

export interface SkillFile {
  name: string
  path: string
  type: 'reference' | 'script' | 'template' | 'test' | 'asset' | 'other'
}

export interface SkillDetail extends SkillMeta {
  body: string
  files: SkillFile[]
}

export interface FileContent {
  content: string
  language: string
  name: string
}

export async function fetchSkills(): Promise<{ skills: SkillMeta[]; tags: string[] }> {
  return apiGet('/api/skills')
}

export async function fetchSkillDetail(category: string, skill: string): Promise<SkillDetail> {
  return apiGet(`/api/skills/${category}/${skill}/files`)
}

export async function fetchSkillFile(category: string, skill: string, filePath: string): Promise<FileContent> {
  return apiGet(`/api/skills/${category}/${skill}/file/${filePath}`)
}
