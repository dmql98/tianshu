import { apiGet, apiPost } from './client'

export interface SkillFile {
  name: string
  path: string
  type: 'reference' | 'script' | 'template' | 'test' | 'asset' | 'other'
}

export interface SkillPackageChild {
  id: string
  name: string
  description: string
  path: string
  preload: boolean
  tags: string[]
}

export interface SkillPackageMeta {
  id: string
  name: string
  description: string
  tags: string[]
  category: string
  version?: string
  author?: string
  root: string
  childCount: number
  children: SkillPackageChild[]
  files: SkillFile[]
  /** 双层内容来源（BUILTIN_CONTENT_DEVELOPMENT_PLAN §12）。 */
  source?: 'builtin' | 'user'
  readOnly?: boolean
  overridesBuiltin?: boolean
  builtinVersion?: string
}

export interface SkillPackageDetail extends SkillPackageMeta {
  body: string
}

export interface SkillChildDetail extends SkillPackageChild {
  packageId: string
  category: string
  body: string
  files: SkillFile[]
}

export const fetchSkillPackages = (): Promise<{ packages: SkillPackageMeta[]; tags: string[] }> =>
  apiGet('/api/skills/packages')

export const fetchSkillPackage = (category: string, packageId: string): Promise<SkillPackageDetail> =>
  apiGet(`/api/skills/packages/${encodeURIComponent(category)}/${encodeURIComponent(packageId)}`)

export const createSkillPackage = (data: {
  id: string
  name: string
  category: string
  description?: string
  version?: string
  content: string
}): Promise<SkillPackageDetail> => apiPost('/api/skills/packages', data)

export const fetchSkillChild = (category: string, packageId: string, skillId: string): Promise<SkillChildDetail> =>
  apiGet(`/api/skills/packages/${encodeURIComponent(category)}/${encodeURIComponent(packageId)}/skills/${encodeURIComponent(skillId)}`)
