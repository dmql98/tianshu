/**
 * 知识库 store（KNOWLEDGE_P1_PLAN §3）。
 *
 * - 注册表：<dataDir>/knowledge/bases.json，保存所有已注册知识库的元数据
 *   （id/name/description/rootPath）。用临时文件 + 原子替换写入。
 * - 文件系统是事实源：知识库 = 一个目录（rootPath），其下所有 .md 文件
 *   （递归）即文档集合；不建独立文件表，P1 直接扫目录 + 读文件。
 * - 读取限定在 rootPath 内（isPathWithin 校验），防止路径穿越。
 */
import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join, relative, resolve, extname } from 'path'
import { knowledgeRoot } from '../data-paths.js'
import { isPathWithin } from '../tools/utils.js'

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  rootPath: string
  createdAt: number
  updatedAt: number
}

/** 知识库目录下扫描出的文档文件（P1 只支持 .md/.markdown/.txt）。 */
export interface KnowledgeFileEntry {
  /** 相对 rootPath 的路径，POSIX 风格（前端目录树依据）。 */
  relPath: string
  /** 文件名（含扩展名）。 */
  name: string
  /** 目录（相对 rootPath，POSIX）；根目录为 ''。 */
  dir: string
  ext: string
  size: number
  mtimeMs: number
}

const BASE_FILE = 'bases.json'

const SUPPORTED_EXTS = new Set(['.md', '.markdown', '.txt'])

function basesFile(): string {
  return join(knowledgeRoot(), BASE_FILE)
}

function ensureRoot(): void {
  mkdirSync(knowledgeRoot(), { recursive: true })
}

function readBases(): KnowledgeBase[] {
  const file = basesFile()
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((b): b is KnowledgeBase =>
      !!b && typeof b === 'object' && typeof (b as KnowledgeBase).id === 'string')
  } catch {
    // 注册表损坏：不抛错，按空处理（下一次写入会重建）。
    console.error('[knowledge] bases.json 解析失败，按空注册表处理')
    return []
  }
}

function writeBases(bases: KnowledgeBase[]): void {
  ensureRoot()
  const file = basesFile()
  const tmp = `${file}.tmp-${randomUUID().slice(0, 8)}`
  writeFileSync(tmp, JSON.stringify(bases, null, 2), 'utf-8')
  renameSync(tmp, file)
}

function toPosix(p: string): string {
  return p.split('\\').join('/')
}

/** 是否支持的知识文档扩展名。 */
export function isSupportedKnowledgeExt(ext: string): boolean {
  return SUPPORTED_EXTS.has(ext.toLowerCase())
}

export const knowledgeStore = {
  list(): KnowledgeBase[] {
    return readBases()
  },

  get(id: string): KnowledgeBase | null {
    return readBases().find(b => b.id === id) ?? null
  },

  /**
   * 创建知识库：仅登记元数据，不校验 rootPath 存在（允许创建后放文件）。
   * 要求 name/path 非空、name 唯一、rootPath 为绝对路径且不与现有库重复。
   */
  create(data: { name: string; description?: string; rootPath: string }): KnowledgeBase {
    const name = (data.name || '').trim()
    const rawPath = (data.rootPath || '').trim()
    if (!name) throw new Error('知识库名称不能为空')
    if (!rawPath) throw new Error('知识库路径不能为空')
    if (!/^[A-Za-z]:[\\/]/.test(rawPath) && !rawPath.startsWith('/')) {
      throw new Error('知识库路径必须是绝对路径')
    }
    const rootPath = resolve(rawPath)
    const bases = readBases()
    if (bases.some(b => b.name === name)) throw new Error(`知识库名称已存在: ${name}`)
    if (bases.some(b => resolve(b.rootPath) === rootPath)) throw new Error(`该目录已注册为知识库: ${rootPath}`)
    const now = Date.now()
    const kb: KnowledgeBase = {
      id: randomUUID(),
      name,
      description: (data.description || '').trim(),
      rootPath,
      createdAt: now,
      updatedAt: now,
    }
    bases.push(kb)
    writeBases(bases)
    return kb
  },

  /** 更新知识库（名称/描述）。rootPath 不允许变更（避免挂载/搜索历史错位）。 */
  update(id: string, patch: { name?: string; description?: string }): KnowledgeBase | null {
    const bases = readBases()
    const idx = bases.findIndex(b => b.id === id)
    if (idx < 0) return null
    const name = patch.name !== undefined ? patch.name.trim() : bases[idx].name
    if (patch.name !== undefined && !name) throw new Error('知识库名称不能为空')
    if (patch.name !== undefined && bases.some((b, i) => i !== idx && b.name === name)) {
      throw new Error(`知识库名称已存在: ${name}`)
    }
    bases[idx] = { ...bases[idx], name, description: patch.description ?? bases[idx].description, updatedAt: Date.now() }
    writeBases(bases)
    return bases[idx]
  },

  /** 删除知识库：只删注册表记录，不删目录（目录是用户文件，归属用户）。 */
  delete(id: string): boolean {
    const bases = readBases()
    const next = bases.filter(b => b.id !== id)
    if (next.length === bases.length) return false
    writeBases(next)
    return true
  },

  /**
   * 递归扫描知识库目录下的支持文档，返回按目录分组可还原的文件列表。
   * rootPath 缺失时返回 []。
   */
  listFiles(kbId: string): { kb: KnowledgeBase; files: KnowledgeFileEntry[] } | null {
    const kb = this.get(kbId)
    if (!kb) return null
    const files: KnowledgeFileEntry[] = []
    const walk = (dir: string) => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          walk(full)
        } else if (e.isFile() && isSupportedKnowledgeExt(extname(e.name))) {
          if (!isPathWithin(kb.rootPath, full)) continue
          let st: ReturnType<typeof statSync> | null = null
          try { st = statSync(full) } catch { /* ignore */ }
          if (!st) continue
          const rel = toPosix(relative(kb.rootPath, full))
          const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          files.push({
            relPath: rel,
            name: e.name,
            dir: dirRel,
            ext: extname(e.name).toLowerCase(),
            size: st.size,
            mtimeMs: st.mtimeMs,
          })
        }
      }
    }
    if (existsSync(kb.rootPath)) walk(kb.rootPath)
    files.sort((a, b) => a.relPath.localeCompare(b.relPath))
    return { kb, files }
  },

  /**
   * 读取知识库内文档内容（UTF-8）。relPath 必须落在 rootPath 内。
   * 返回 null 表示文档不存在；抛错表示路径越界。
   */
  readFile(kbId: string, relPath: string): { content: string; fullPath: string } | null {
    const kb = this.get(kbId)
    if (!kb) return null
    const full = resolve(kb.rootPath, relPath)
    if (!isPathWithin(kb.rootPath, full)) throw new Error('Knowledge read escapes the knowledge base root')
    if (!existsSync(full) || !statSync(full).isFile()) return null
    return { content: readFileSync(full, 'utf-8'), fullPath: full }
  },
}
