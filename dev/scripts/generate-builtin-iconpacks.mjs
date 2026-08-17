/**
 * 内置图标包生成：从 content/builtin/iconpacks/<id>/assets/*.svg 重建 pack.json。
 *
 * 统一模型：内置包与用户包同构（pack.json + assets/*.svg）。SVG 文件本身是
 * 唯一事实来源（不再编译进前端）；本脚本负责按资产文件列表生成每个内置包的
 * pack.json（槽位名 = 资产文件名，tint=true 随主题着色）。
 *
 * 用法：node scripts/generate-builtin-iconpacks.mjs
 * 幂等：仅重建 pack.json，不触碰 assets。
 */
import { existsSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const BUILTIN_ICONPACKS_ROOT = join(REPO_ROOT, 'content', 'builtin', 'iconpacks')

/** 内置包元数据（唯一需要人工维护的字段；资产列表自动扫描）。 */
const PACK_META = {
  'lucide': { name: 'Lucide', description: '线性 · 1.8px · 随主题着色' },
  'streamline-freehand': { name: 'Streamline Freehand', description: '手绘线稿 · 实心 · 随主题着色' },
}

function packJson(id, name, description, slots) {
  const now = new Date().toISOString()
  const slotRefs = {}
  for (const slot of slots.sort()) {
    slotRefs[slot] = { file: `${slot}.svg`, tint: true }
  }
  return JSON.stringify({
    schemaVersion: 1,
    id,
    name,
    description,
    source: 'builtin',
    readOnly: true,
    slots: slotRefs,
    createdAt: now,
    updatedAt: now,
  }, null, 2) + '\n'
}

function main() {
  const dirs = ['lucide', 'streamline-freehand']
  for (const id of dirs) {
    const dir = join(BUILTIN_ICONPACKS_ROOT, id)
    const assetsDir = join(dir, 'assets')
    if (!existsSync(assetsDir)) {
      console.warn(`skip ${id}: missing assets dir`)
      continue
    }
    const meta = PACK_META[id]
    if (!meta) {
      console.warn(`skip ${id}: no metadata declared`)
      continue
    }
    const slots = readdirSync(assetsDir)
      .filter(f => f.endsWith('.svg'))
      .map(f => f.slice(0, -4))
    writeFileSync(join(dir, 'pack.json'), packJson(id, meta.name, meta.description, slots), 'utf-8')
    console.log(`→ content/builtin/iconpacks/${id}/pack.json（${slots.length} 枚）`)
  }
}

main()