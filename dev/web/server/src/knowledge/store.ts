/**
 * 知识库 store（KNOWLEDGE_P1_PLAN §3 / 06 P2 外部转换器）。
 *
 * - 注册表：<dataDir>/knowledge/bases.json，保存所有已注册知识库的元数据
 *   （id/name/description/rootPath）。用临时文件 + 原子替换写入。
 * - 文件系统是事实源：知识库 = 一个目录（rootPath），其下所有 .md 文件
 *   （递归）即文档集合；不建独立文件表，P1 直接扫目录 + 读文件。
 * - P2 外部转换器：originals/{kbId}/ 存原件、normalized/{kbId}/ 存转换后的
 *   Markdown（转换后放回 rootPath 下 normalized/ 同级目录，避免污染用户目录）。
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
import { join, relative, resolve, extname, basename } from 'path'
import { knowledgeRoot } from '../data-paths.js'
import { isPathWithin } from '../tools/utils.js'
import { CONVERTIBLE_EXTS, convertersForExt } from './converter-registry.js'

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  rootPath: string
  createdAt: number
  updatedAt: number
  /** P2：转换记录（原件 → 状态），可选字段兼容旧注册表。 */
  converted?: ConvertedDoc[]
}

/** 知识库目录下扫描出的文件（P1 只支持 .md/.markdown/.txt；P2 起额外识别可转换文档）。 */
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
  /**
   * P2：该扩展名可用的转换器 id 列表（来自内置转换器目录的 inputExtensions 并集）。
   * 空数组 = 既非 Markdown 也无可转换的普通文件。
   */
  converters: string[]
  /** P2：是否已存在 Markdown 副本（rootPath/normalized/{stem}.md 或转换记录指向的 md）。 */
  hasMd: boolean
  /** P2：最近一次转换记录（来自 KnowledgeBase.converted，按 relPath 匹配）。 */
  converted?: ConvertedDoc | null
}

/** 转换产物状态（06 P2 生命周期：pending → converting → indexed / error）。 */
export type DocStatus = 'pending' | 'converting' | 'indexed' | 'error'

/** P2 转换记录（挂在 KnowledgeBase 上，随 bases.json 持久化）。 */
export interface ConvertedDoc {
  /** 原件文件名（含扩展名），如 report.pdf。 */
  fileName: string
  /** 原件相对 rootPath 的路径（POSIX），精确匹配文件列表；旧记录无此字段。 */
  relPath?: string
  /** 转换产物相对 rootPath 的 md 路径（normalized/ 下），如 normalized/report.md。 */
  mdRelPath: string
  /** 转换状态。 */
  status: DocStatus
  /** error 时的原因。 */
  error?: string
  /** 使用的转换器（paddleocr / anydoc）。 */
  converter?: string
  updatedAt: number
}

const BASE_FILE = 'bases.json'

/** 直接可读的知识文档扩展名（.md/.markdown/.txt，保持 P1 行为）。 */
const READABLE_EXTS = new Set(['.md', '.markdown', '.txt'])

/** 扫描时纳入文件列表的可转换扩展名（P2 外部转换器 inputExtensions 并集）。 */
const CONVERTIBLE_EXT_SET = new Set(CONVERTIBLE_EXTS)

function basesFile(): string {
  return join(knowledgeRoot(), BASE_FILE)
}

/** P2：原文件根目录（originals/{kbId}/）。 */
export function originalsDir(kbId: string): string {
  return join(knowledgeRoot(), 'originals', kbId)
}

/** P2：转换产物根目录（normalized/{kbId}/）。 */
export function normalizedDir(kbId: string): string {
  return join(knowledgeRoot(), 'normalized', kbId)
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

/** 是否直接可读的知识文档扩展名（.md/.markdown/.txt）。 */
export function isSupportedKnowledgeExt(ext: string): boolean {
  return READABLE_EXTS.has(ext.toLowerCase())
}

/** 该扩展名是否可被某个内置转换器处理。 */
export function isConvertibleKnowledgeExt(ext: string): boolean {
  return CONVERTIBLE_EXT_SET.has(ext.toLowerCase())
}

/** 提取转换记录列表（旧注册表无此字段时返回 []）。 */
function convertedList(kb: KnowledgeBase): ConvertedDoc[] {
  return Array.isArray((kb as any).converted) ? (kb as any).converted as ConvertedDoc[] : []
}

/** 写回转换记录并持久化。 */
function saveConverted(kb: KnowledgeBase, converted: ConvertedDoc[]): void {
  const bases = readBases()
  const idx = bases.findIndex(b => b.id === kb.id)
  if (idx < 0) return
  bases[idx] = { ...bases[idx], converted, updatedAt: Date.now() }
  writeBases(bases)
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

  /** P2：登记/更新一个转换记录（原件 → 转换状态）。 */
  upsertConverted(kbId: string, doc: ConvertedDoc): void {
    const kb = this.get(kbId)
    if (!kb) throw new Error(`知识库不存在: ${kbId}`)
    const list = convertedList(kb)
    const idx = list.findIndex(c => c.relPath ? c.relPath === doc.relPath : c.fileName === doc.fileName)
    const next = [...list]
    if (idx >= 0) next[idx] = { ...next[idx], ...doc }
    else next.push(doc)
    saveConverted(kb, next)
  },

  /** P2：查询一个转换记录（按 relPath 优先，回退 fileName）。 */
  getConverted(kbId: string, fileName: string, relPath?: string): ConvertedDoc | null {
    const kb = this.get(kbId)
    if (!kb) return null
    const list = convertedList(kb)
    if (relPath) {
      const hit = list.find(c => c.relPath === relPath)
      if (hit) return hit
    }
    return list.find(c => c.fileName === fileName) ?? null
  },

  /** P2：列出该库全部转换记录。 */
  listConverted(kbId: string): ConvertedDoc[] {
    const kb = this.get(kbId)
    if (!kb) return []
    return convertedList(kb)
  },

  /**
   * 递归扫描知识库目录下的支持文档，返回按目录分组可还原的文件列表。
   * rootPath 缺失时返回 []。
   */
  listFiles(kbId: string): { kb: KnowledgeBase; files: KnowledgeFileEntry[] } | null {
    const kb = this.get(kbId)
    if (!kb) return null
    const files: KnowledgeFileEntry[] = []
    const convertedByRel = new Map<string, ConvertedDoc>()
    for (const c of convertedList(kb)) {
      if (c.relPath) convertedByRel.set(c.relPath, c)
    }
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
          // 跳过数据目录（originals/normalized 在 dataDir 内，本就不在 rootPath；防御：跳过名为 normalized 的目录）
          if (e.name === 'normalized') continue
          walk(full)
        } else if (e.isFile()) {
          const ext = extname(e.name).toLowerCase()
          if (!isSupportedKnowledgeExt(ext) && !isConvertibleKnowledgeExt(ext)) continue
          if (!isPathWithin(kb.rootPath, full)) continue
          let st: ReturnType<typeof statSync> | null = null
          try { st = statSync(full) } catch { /* ignore */ }
          if (!st) continue
          const rel = toPosix(relative(kb.rootPath, full))
          const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          const stem = e.name.replace(/\.[^.]+$/, '')
          const mdInNormalized = join(kb.rootPath, 'normalized', `${stem}.md`)
          const hasMd = existsSync(mdInNormalized) || (convertedByRel.get(rel)?.status === 'indexed')
          const converters = isConvertibleKnowledgeExt(ext) ? convertersForExt(ext) : []
          files.push({
            relPath: rel,
            name: e.name,
            dir: dirRel,
            ext,
            size: st.size,
            mtimeMs: st.mtimeMs,
            converters,
            hasMd,
            converted: convertedByRel.get(rel) ?? null,
          })
        }
      }
    }
    if (existsSync(kb.rootPath)) walk(kb.rootPath)
    // 确定性排序：UTF-16 字典序（localeCompare 在中文环境受 ICU 版本影响，不可预测）
    files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
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

  /** P2：写原件到 originals/{kbId}/{fileName}（返回绝对路径）。 */
  saveOriginal(kbId: string, fileName: string, data: Buffer | string): string {
    const dir = originalsDir(kbId)
    mkdirSync(dir, { recursive: true })
    const safe = basename(fileName)
    const full = join(dir, safe)
    writeFileSync(full, data)
    return full
  },

  /** P2：写转换产物到 normalized/{kbId}/{stem}.md（返回逻辑路径 normalized/{stem}.md）。 */
  saveNormalized(kbId: string, fileName: string, content: string): string {
    const dir = normalizedDir(kbId)
    mkdirSync(dir, { recursive: true })
    const stem = basename(fileName).replace(/\.[^.]+$/, '')
    const mdName = `${stem}.md`
    writeFileSync(join(dir, mdName), content, 'utf-8')
    return `normalized/${mdName}`
  },

  /** P2：读取转换产物内容（normalized/{kbId}/ 下，按文件名）。 */
  readNormalized(kbId: string, mdFileName: string): string | null {
    const full = join(normalizedDir(kbId), basename(mdFileName))
    if (!existsSync(full)) return null
    return readFileSync(full, 'utf-8')
  },
}
