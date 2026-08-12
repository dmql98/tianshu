import { Hono } from 'hono'
import { existsSync, readFileSync } from 'fs'
import {
  findSkillPackage,
  listSkillPackages,
  resolvePackageFile,
  resolveSkillReference,
  skillFileLanguage,
  ensureSkillPackageWritable,
  restoreBuiltinSkill,
  type SkillPackageRecord,
} from '../agent/skill-catalog.js'
import { createSkillPackage } from '../agent/skill-package-writer.js'
import { setHidden, readContentState } from '../content/state.js'

const router = new Hono()

function packageJson(pkg: SkillPackageRecord, includeBody = false) {
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
    source: pkg.source,
    readOnly: pkg.readOnly,
    overridesBuiltin: pkg.overridesBuiltin,
    ...(pkg.builtinVersion ? { builtinVersion: pkg.builtinVersion } : {}),
    ...(includeBody ? { body: pkg.rootBody } : {}),
  }
}

/** 内容层状态：隐藏列表与 lastSeenBuiltinVersion（管理接口）。 */
router.get('/content-state', (c) => {
  return c.json(readContentState())
})

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

/**
 * 编辑内置技能：先物化用户副本（copy-on-write），再返回可写副本记录。
 * 后续编辑写操作由技能工作台走用户副本目录。
 */
router.post('/packages/:category/:packageId/materialize', (c) => {
  const { category, packageId } = c.req.param()
  try {
    const pkg = ensureSkillPackageWritable(category, packageId)
    return c.json(packageJson(pkg, true))
  } catch (error: any) {
    return c.json({ error: error.message }, error.message.includes('not found') ? 404 : 400)
  }
})

/** 隐藏内置技能（普通列表不再返回）。 */
router.post('/packages/:category/:packageId/hide', (c) => {
  const { packageId } = c.req.param()
  const pkg = findSkillPackage(packageId, c.req.param('category'))
  if (!pkg) return c.json({ error: 'Skill package not found' }, 404)
  if (pkg.source !== 'builtin') return c.json({ error: 'Only builtin skills can be hidden' }, 400)
  setHidden('skills', packageId, true)
  return c.json({ ok: true, hidden: true })
})

/** 取消隐藏内置技能。 */
router.post('/packages/:category/:packageId/unhide', (c) => {
  const { category, packageId } = c.req.param()
  const pkg = findSkillPackage(packageId, category)
  if (!pkg) return c.json({ error: 'Skill package not found' }, 404)
  setHidden('skills', packageId, false)
  return c.json({ ok: true, hidden: false })
})

/** 恢复内置版本：删除用户副本目录，重新显示当前内置版本。 */
router.post('/packages/:category/:packageId/restore-builtin', (c) => {
  const { category, packageId } = c.req.param()
  const pkg = findSkillPackage(packageId, category)
  if (!pkg) return c.json({ error: 'Skill package not found' }, 404)
  if (pkg.source !== 'user' || !pkg.overridesBuiltin) {
    return c.json({ error: 'Skill has no user copy to restore' }, 400)
  }
  restoreBuiltinSkill(category, packageId)
  setHidden('skills', packageId, false)
  return c.json({ ok: true, restored: true, source: 'builtin' })
})

export default router
