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

export const fetchSkills = (): Promise<{ skills: SkillMeta[]; tags: string[] }> =>
  apiGet('/api/skills')

export const fetchSkillDetail = (category: string, skill: string): Promise<SkillDetail> =>
  apiGet(`/api/skills/${category}/${skill}/files`)

export const fetchSkillFile = (category: string, skill: string, filePath: string): Promise<FileContent> =>
  apiGet(`/api/skills/${category}/${skill}/file/${filePath}`)
