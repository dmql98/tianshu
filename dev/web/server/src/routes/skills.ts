import { Hono } from 'hono'
import { existsSync, readFileSync } from 'fs'
import {
  findSkillPackage,
  listSkillPackages,
  resolvePackageFile,
  resolveSkillReference,
  skillFileLanguage,
} from '../agent/skill-catalog.js'
import { createSkillPackage } from '../agent/skill-package-writer.js'

const router = new Hono()

function packageJson(pkg: ReturnType<typeof listSkillPackages>[number], includeBody = false) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    category: pkg.category,
    version: pkg.version,
    author: pkg.author,
    tags: pkg.tags,
    root: pkg.root,
    childCount: pkg.children.length,
    children: pkg.children,
    files: pkg.files,
    ...(includeBody ? { body: pkg.rootBody } : {}),
  }
}

router.get('/packages', (c) => {
  const packages = listSkillPackages().map(pkg => packageJson(pkg))
  return c.json({ packages, tags: [...new Set(packages.flatMap(pkg => pkg.tags))].sort() })
})

router.post('/packages', async (c) => {
  try {
    const body = await c.req.json() as {
      id?: string
      category?: string
      content?: string
      name?: string
      description?: string
      version?: string
      author?: string
      tags?: string[]
    }
    if (!body.id || !body.category || !body.content) {
      return c.json({ error: 'id, category and content are required' }, 400)
    }
    const created = createSkillPackage({
      id: body.id,
      category: body.category,
      content: body.content,
      name: body.name,
      description: body.description,
      version: body.version,
      author: body.author,
      tags: body.tags,
    })
    const pkg = findSkillPackage(created.manifest.id, created.manifest.category)
    return c.json(pkg ? packageJson(pkg, true) : created.manifest, 201)
  } catch (error: any) {
    const status = /already exists/.test(error.message) ? 409 : 400
    return c.json({ error: error.message }, status)
  }
})

router.get('/packages/:category/:packageId', (c) => {
  const { category, packageId } = c.req.param()
  const pkg = findSkillPackage(packageId, category)
  return pkg ? c.json(packageJson(pkg, true)) : c.json({ error: 'Skill package not found' }, 404)
})

router.get('/packages/:category/:packageId/skills/:skillId', (c) => {
  const { category, packageId, skillId } = c.req.param()
  const pkg = findSkillPackage(packageId, category)
  if (!pkg) return c.json({ error: 'Skill package not found' }, 404)
  const found = resolveSkillReference(`${packageId}/${skillId}`)
  if (!found?.child || found.pkg.category !== category) return c.json({ error: 'Child skill not found' }, 404)
  return c.json({
    packageId,
    category,
    ...found.child,
    body: found.body,
    files: found.files,
  })
})

router.get('/packages/:category/:packageId/file/*', (c) => {
  const { category, packageId } = c.req.param()
  const pkg = findSkillPackage(packageId, category)
  if (!pkg) return c.json({ error: 'Skill package not found' }, 404)
  try {
    const marker = `/api/skills/packages/${category}/${packageId}/file/`
    const filePath = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(marker) + marker.length))
    const fullPath = resolvePackageFile(pkg, filePath)
    if (!existsSync(fullPath)) return c.json({ error: 'File not found' }, 404)
    return c.json({ content: readFileSync(fullPath, 'utf-8'), language: skillFileLanguage(fullPath), name: filePath.split('/').pop() })
  } catch (error: any) {
    return c.json({ error: error.message }, 400)
  }
})

router.get('/packages/:category/:packageId/skills/:skillId/file/*', (c) => {
  const { category, packageId, skillId } = c.req.param()
  const pkg = findSkillPackage(packageId, category)
  if (!pkg || !pkg.children.some(child => child.id === skillId)) return c.json({ error: 'Child skill not found' }, 404)
  try {
    const marker = `/api/skills/packages/${category}/${packageId}/skills/${skillId}/file/`
    const filePath = decodeURIComponent(c.req.path.slice(c.req.path.indexOf(marker) + marker.length))
    const fullPath = resolvePackageFile(pkg, filePath, skillId)
    if (!existsSync(fullPath)) return c.json({ error: 'File not found' }, 404)
    return c.json({ content: readFileSync(fullPath, 'utf-8'), language: skillFileLanguage(fullPath), name: filePath.split('/').pop() })
  } catch (error: any) {
    return c.json({ error: error.message }, 400)
  }
})

export default router
