import { Hono } from 'hono'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, resolve, relative, extname } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const SKILLS_ROOT = resolve(DATA_DIR, 'skills')

interface SkillMeta {
  name: string
  description: string
  tags: string[]
  category: string
  version?: string
  author?: string
}

interface SkillFile {
  name: string
  path: string
  type: 'reference' | 'script' | 'template' | 'test' | 'asset' | 'other'
}

interface SkillDetail extends SkillMeta {
  body: string
  files: SkillFile[]
}

function parseList(value: string): string[] {
  value = value.trim()
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  if (value.startsWith('>') || value.startsWith('|')) {
    return [value.replace(/^[>|]\s*/, '').trim()]
  }
  return [value.replace(/^['"]|['"]$/g, '')]
}

function parseFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\n?/)
  if (!match) return {}

  const fm: Record<string, any> = {}
  const lines = match[1].split('\n')
  let currentKey = ''
  let currentValue = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const keyMatch = trimmed.match(/^(\w[\w_-]*)\s*:\s*(.*)$/)
    if (keyMatch) {
      if (currentKey) {
        fm[currentKey] = currentValue.trim()
      }
      currentKey = keyMatch[1]
      currentValue = keyMatch[2]
    } else if (currentKey && /^\s+/.test(line)) {
      currentValue += ' ' + trimmed
    }
  }
  if (currentKey) {
    fm[currentKey] = currentValue.trim()
  }

  if (Array.isArray(fm.tags)) return fm
  if (fm.tags && typeof fm.tags === 'string') {
    fm.tags = parseList(fm.tags as string)
  }
  return fm
}

function getFileType(dir: string): SkillFile['type'] {
  switch (dir) {
    case 'references': return 'reference'
    case 'scripts': return 'script'
    case 'templates': return 'template'
    case 'tests': return 'test'
    case 'assets': return 'asset'
    default: return 'other'
  }
}

function findSkills(dir: string, category: string): SkillMeta[] {
  const results: SkillMeta[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(dir, entry.name)
      const skillFile = join(skillDir, 'SKILL.md')
      if (!existsSync(skillFile)) continue

      const content = readFileSync(skillFile, 'utf-8')
      const fm = parseFrontmatter(content)
      results.push({
        name: fm.name || entry.name,
        description: fm.description || '',
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        category,
        version: fm.version,
        author: fm.author,
      })
    }
  } catch { /* directory not found */ }
  return results
}

const router = new Hono()

router.get('/', (c) => {
  const all: SkillMeta[] = []
  const allTags = new Set<string>()

  try {
    const categories = readdirSync(SKILLS_ROOT, { withFileTypes: true })
    for (const cat of categories) {
      if (!cat.isDirectory()) continue
      const skills = findSkills(join(SKILLS_ROOT, cat.name), cat.name)
      for (const s of skills) {
        s.tags.forEach(t => allTags.add(t))
        all.push(s)
      }
    }
  } catch { /* skills dir not found */ }

  return c.json({ skills: all, tags: [...allTags].sort() })
})

router.get('/:category/:skill/files', (c) => {
  const { category, skill } = c.req.param()
  const skillDir = join(SKILLS_ROOT, category, skill)
  const skillFile = join(skillDir, 'SKILL.md')

  if (!existsSync(skillFile)) return c.json({ error: 'Skill not found' }, 404)

  const content = readFileSync(skillFile, 'utf-8')
  const fm = parseFrontmatter(content)
  const bodyMatch = content.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n([\s\S]*)$/)
  const body = bodyMatch ? bodyMatch[1].trim() : content

  const files: SkillFile[] = []

  try {
    const entries = readdirSync(skillDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const subDir = join(skillDir, entry.name)
      const fileType = getFileType(entry.name)

      const walkDir = (base: string, prefix: string) => {
        try {
          const items = readdirSync(base, { withFileTypes: true })
          for (const item of items) {
            const full = join(base, item.name)
            const relPath = prefix ? `${prefix}/${item.name}` : item.name
            if (item.isDirectory()) {
              walkDir(full, relPath)
            } else {
              files.push({ name: item.name, path: relPath, type: fileType })
            }
          }
        } catch { /* skip */ }
      }

      walkDir(subDir, entry.name)
    }
  } catch { /* no attachments */ }

  files.sort((a, b) => a.path.localeCompare(b.path))

  return c.json({ name: fm.name || skill, description: fm.description || '', tags: Array.isArray(fm.tags) ? fm.tags : [], category, version: fm.version, author: fm.author, body, files })
})

router.get('/:category/:skill/file/*', (c) => {
  const { category, skill } = c.req.param()
  const filePath = c.req.path.replace(`/api/skills/${category}/${skill}/file/`, '')
  const fullPath = join(SKILLS_ROOT, category, skill, filePath)

  if (!fullPath.startsWith(SKILLS_ROOT)) return c.json({ error: 'Invalid path' }, 400)
  if (!existsSync(fullPath)) return c.json({ error: 'File not found' }, 404)

  const content = readFileSync(fullPath, 'utf-8')
  const ext = extname(fullPath).toLowerCase()
  const lang = ext === '.md' ? 'markdown' : ext === '.sh' ? 'bash' : ext === '.py' ? 'python' : ext === '.yaml' || ext === '.yml' ? 'yaml' : ext === '.json' ? 'json' : ext === '.ts' ? 'typescript' : ext === '.js' ? 'javascript' : ext === '.css' ? 'css' : ext === '.html' ? 'html' : 'text'

  return c.json({ content, language: lang, name: filePath.split('/').pop() })
})

export default router
