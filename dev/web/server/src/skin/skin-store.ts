import { randomUUID } from 'crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'fs'
import { basename, extname, resolve, join } from 'path'
import { skinRoot } from '../data-paths.js'
import type { CharacterVisual, CharacterAssetRef } from '../character/visual-store.js'

/**
 * 皮肤（SKIN_DECOUPLE_PLAN）：把角色里的视觉与动画独立成可复用实体。
 *
 * 目录约定：<dataDir>/skin/<skinId>/
 *   skin.json          — 轻量元数据（name/id/description）
 *   立绘/头像/动画文件  — 文件名即语义，按文件名加载：
 *     portrait.png         立绘
 *     avatar.png           头像
 *     idle.mp4 / thinking.mp4 / working.mp4 / speaking.mp4 / success.mp4 / error.mp4
 *       六个动画（沿用现有 CharacterMotion 枚举）。
 */

export type SkinMotion =
  | 'idle' | 'thinking' | 'working' | 'speaking' | 'success' | 'error'

export const SKIN_MOTIONS: SkinMotion[] = [
  'idle', 'thinking', 'working', 'speaking', 'success', 'error',
]

/** 语义文件名 → 角色。 */
export const SKIN_SLOTS: Record<string, { role: 'portrait' | 'avatar' | 'motion' | 'original'; motion?: SkinMotion }> = {
  'original.png': { role: 'original' },
  'original.jpg': { role: 'original' },
  'original.jpeg': { role: 'original' },
  'original.webp': { role: 'original' },
  'portrait.png': { role: 'portrait' },
  'portrait.jpg': { role: 'portrait' },
  'portrait.jpeg': { role: 'portrait' },
  'portrait.webp': { role: 'portrait' },
  'avatar.png': { role: 'avatar' },
  'avatar.jpg': { role: 'avatar' },
  'avatar.jpeg': { role: 'avatar' },
  'avatar.webp': { role: 'avatar' },
  'idle.mp4': { role: 'motion', motion: 'idle' },
  'thinking.mp4': { role: 'motion', motion: 'thinking' },
  'working.mp4': { role: 'motion', motion: 'working' },
  'speaking.mp4': { role: 'motion', motion: 'speaking' },
  'success.mp4': { role: 'motion', motion: 'success' },
  'error.mp4': { role: 'motion', motion: 'error' },
}

export interface SkinMeta {
  schemaVersion: 1
  id: string
  name: string
  description?: string
  /** 归属角色 id 列表（皮肤可被多角色复用）。 */
  boundCharacters?: string[]
  createdAt?: number
  updatedAt?: number
}

export interface SkinSlotEntry {
  slot: 'portrait' | 'avatar'
  filename: string
  mime: string
}

export interface SkinMotionEntry {
  motion: SkinMotion
  filename: string
  mime: string
}

export interface Skin {
  id: string
  name: string
  description?: string
  /** 原画（裁剪前的大图）。 */
  original?: SkinSlotEntry
  portrait?: SkinSlotEntry
  avatar?: SkinSlotEntry
  motions: Partial<Record<SkinMotion, SkinMotionEntry>>
  boundCharacters?: string[]
  updatedAt?: number
  dir: string
}

const DEFAULT_META: Omit<SkinMeta, 'id' | 'name'> = {
  schemaVersion: 1,
}

function skinDir(skinId: string): string {
  return resolve(skinRoot(), skinId)
}

function manifestPath(skinId: string): string {
  return resolve(skinDir(skinId), 'skin.json')
}

function safeId(input: string): string {
  const cleaned = input.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-')
  return cleaned.replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function baseSlotFilename(filename: string, slot: 'portrait' | 'avatar' | 'original'): string {
  const ext = extname(basename(filename)).toLowerCase()
  const allowed: Record<string, string> = {
    '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpeg', '.webp': 'webp',
  }
  const e = allowed[ext] || 'png'
  return `${slot}.${e}`
}

function motionFilename(motion: SkinMotion, filename: string): string {
  const ext = extname(basename(filename)).toLowerCase() || '.mp4'
  const allowed = new Set(['.mp4', '.webp', '.gif', '.png', '.jpg', '.jpeg'])
  const e = allowed.has(ext) ? ext : '.mp4'
  return `${motion}${e}`
}

function mimeFor(filename: string, fallback = 'application/octet-stream'): string {
  const ext = extname(basename(filename)).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4',
  }
  return map[ext] || fallback
}

function readMeta(skinId: string): SkinMeta | null {
  const file = manifestPath(skinId)
  if (!existsSync(file)) return null
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value?.schemaVersion === 1 ? value as SkinMeta : null
  } catch {
    return null
  }
}

function readSkinDir(skinId: string): Skin | null {
  const dir = skinDir(skinId)
  if (!existsSync(dir)) return null
  let files: string[] = []
  try {
    files = readdirSync(dir).filter(f => SKIN_SLOTS[f])
  } catch {
    files = []
  }
  const meta = readMeta(skinId)
  const portrait = files.find(f => SKIN_SLOTS[f]?.role === 'portrait')
  const avatar = files.find(f => SKIN_SLOTS[f]?.role === 'avatar')
  const original = files.find(f => SKIN_SLOTS[f]?.role === 'original')
  return {
    id: skinId,
    name: meta?.name || skinId,
    description: meta?.description,
    original: original ? { slot: 'portrait', filename: original, mime: mimeFor(original) } : undefined,
    portrait: portrait ? { slot: 'portrait', filename: portrait, mime: mimeFor(portrait) } : undefined,
    avatar: avatar ? { slot: 'avatar', filename: avatar, mime: mimeFor(avatar) } : undefined,
    motions: SKIN_MOTIONS.reduce((acc, motion) => {
      const f = files.find(file => SKIN_SLOTS[file]?.role === 'motion' && SKIN_SLOTS[file]?.motion === motion)
      if (f) acc[motion] = { motion, filename: f, mime: mimeFor(f) }
      return acc
    }, {} as Partial<Record<SkinMotion, SkinMotionEntry>>),
    boundCharacters: meta?.boundCharacters,
    updatedAt: meta?.updatedAt,
    dir,
  }
}

function ensureDirGenerated(skinId: string, meta: SkinMeta): string {
  const dir = skinDir(skinId)
  mkdirSync(dir, { recursive: true })
  atomicJson(manifestPath(skinId), meta)
  return dir
}

function atomicJson(file: string, value: unknown) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, file)
}

export const skinStore = {
  list(): Skin[] {
    const root = skinRoot()
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => readSkinDir(d.name))
      .filter((s): s is Skin => s !== null)
  },

  get(skinId: string): Skin | null {
    return readSkinDir(skinId)
  },

  /**
   * 新建皮肤：仅写 skin.json（ID + 名称），文件后续逐个上传。
   */
  create(input: { id?: string; name: string; description?: string }): Skin {
    const id = safeId(input.id || input.name)
    if (!id) throw new Error('Skin id must be a non-empty name')
    if (existing(skinId => skinId === id)) throw new Error(`Skin already exists: ${id}`)
    const now = Date.now()
    const meta: SkinMeta = { ...DEFAULT_META, id, name: input.name, description: input.description, createdAt: now, updatedAt: now }
    ensureDirGenerated(id, meta)
    const skin = readSkinDir(id)
    if (!skin) throw new Error('Failed to create skin')
    return skin
  },

  /** 更新元数据（名称/描述/归属角色）。 */
  update(skinId: string, patch: { name?: string; description?: string; boundCharacters?: string[] }) {
    const meta = readMeta(skinId)
    if (!meta) throw new Error(`Skin not found: ${skinId}`)
    const next: SkinMeta = {
      ...meta,
      name: patch.name !== undefined ? patch.name : meta.name,
      description: patch.description !== undefined ? patch.description : meta.description,
      boundCharacters: patch.boundCharacters !== undefined ? patch.boundCharacters : meta.boundCharacters,
      updatedAt: Date.now(),
    }
    atomicJson(manifestPath(skinId), next)
    return readSkinDir(skinId)
  },

  /**
   * 上传文件。
   * slot: 'portrait' | 'avatar' | SkinMotion
   * 文件名即语义，按 slot 落盘为固定语义文件名。
   */
  upload(skinId: string, slot: 'portrait' | 'avatar' | 'original' | SkinMotion, input: {
    bytes: Uint8Array
    filename: string
    mime: string
  }) {
    const meta = readMeta(skinId)
    if (!meta) throw new Error(`Skin not found: ${skinId}`)
    const dir = skinDir(skinId)
    mkdirSync(dir, { recursive: true })
    const target = slot === 'portrait' || slot === 'avatar' || slot === 'original'
      ? baseSlotFilename(input.filename, slot)
      : motionFilename(slot, input.filename)
    // 先删掉旧的语义文件，避免历史扩展名残留。
    if (slot === 'portrait' || slot === 'avatar' || slot === 'original') {
      const old = readdirSync(dir).find(f => SKIN_SLOTS[f]?.role === slot)
      if (old && old !== target) { try { rmSync(join(dir, old)) } catch {} }
    } else {
      const old = readdirSync(dir).find(f => SKIN_SLOTS[f]?.role === 'motion' && SKIN_SLOTS[f]?.motion === slot)
      if (old && old !== target) { try { rmSync(join(dir, old)) } catch {} }
    }
    writeFileSync(resolve(dir, target), input.bytes)
    const updated: SkinMeta = { ...meta, updatedAt: Date.now() }
    atomicJson(manifestPath(skinId), updated)
    return readSkinDir(skinId)
  },

  /** 读取某个语义文件内容（供静态服务）。 */
  getFile(skinId: string, filename: string): { file: string; mime: string; size: number } | null {
    const dir = skinDir(skinId)
    if (!isSafeFilename(filename)) return null
    const file = resolve(dir, filename)
    if (!existsSync(file)) return null
    if (resolve(file).startsWith(resolve(dir))) {
      return { file, mime: mimeFor(filename), size: statSync(file).size }
    }
    return null
  },

  remove(skinId: string): { ok: boolean; reason?: string } {
    const dir = skinDir(skinId)
    if (!existsSync(dir)) return { ok: false, reason: 'Skin not found' }
    rmSync(dir, { recursive: true, force: true })
    return { ok: true }
  },

  /** 绑定/解绑一个角色（记录归属，供 UI 显示；皮肤本身可复用）。 */
  bindCharacter(skinId: string, characterId: string, bind: boolean) {
    const meta = readMeta(skinId)
    if (!meta) throw new Error(`Skin not found: ${skinId}`)
    const set = new Set(meta.boundCharacters || [])
    if (bind) set.add(characterId)
    else set.delete(characterId)
    const next = { ...meta, boundCharacters: [...set], updatedAt: Date.now() }
    atomicJson(manifestPath(skinId), next)
    return readSkinDir(skinId)
  },
}

/** 生成器内部重复检查辅助。 */
function existing(predicate: (id: string) => boolean): boolean {
  const root = skinRoot()
  if (!existsSync(root)) return false
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .some(d => predicate(d.name))
}

function isSafeFilename(filename: string): boolean {
  if (!filename || filename.includes('..') || filename.includes('\\') || filename.includes('/')) return false
  return true
}

/** 把角色旧的 visual 目录迁移为 skin 目录，返回生成的 skinId。 */
export function migrateCharacterVisualToSkin(
  characterId: string,
  visualDir: string,
  opts: { name?: string; copy?: boolean } = {},
): string | null {
  const { copy = false } = opts
  if (!existsSync(visualDir)) return null
  const assetsDir = resolve(visualDir, 'assets')
  if (!existsSync(assetsDir)) return null
  let manifest: any = null
  try {
    manifest = JSON.parse(readFileSync(resolve(visualDir, 'visual.json'), 'utf8'))
  } catch {}
  const assetIndex: any[] = []
  try {
    assetIndex.push(...JSON.parse(readFileSync(resolve(visualDir, 'assets.json'), 'utf8')))
  } catch {}

  const fileForAsset = (assetId?: string): string | undefined => {
    if (!assetId) return undefined
    const ref = assetIndex.find(a => a.assetId === assetId)
    return ref ? resolve(assetsDir, ref.filename) : undefined
  }

  // 收集当前被引用的文件（portrait=originalAssetId||portraitAssetId, avatar=avatarAssetId, motions）
  const srcs: { slot: 'portrait' | 'avatar' | SkinMotion; file?: string }[] = []
  const originalId = manifest?.originalAssetId || manifest?.portraitAssetId
  srcs.push({ slot: 'portrait', file: fileForAsset(originalId) })
  srcs.push({ slot: 'avatar', file: fileForAsset(manifest?.avatarAssetId) })
  for (const motion of SKIN_MOTIONS) {
    srcs.push({ slot: motion, file: fileForAsset(manifest?.motions?.[motion]?.assetId) })
  }
  const present = srcs.filter(s => s.file && existsSync(s.file))
  if (present.length === 0) return null

  const skinId = characterId
  const name = opts.name || characterId
  const dir = skinDir(skinId)
  mkdirSync(dir, { recursive: true })

  const moveFile = (src: string, target: string) => {
    if (copy) writeFileSync(resolve(dir, target), readFileSync(src))
    else renameSync(src, resolve(dir, target))
  }

  for (const s of present) {
    if (!s.file) continue
    const fname = basename(s.file)
    if (s.slot === 'portrait') moveFile(s.file, baseSlotFilename(fname, 'portrait'))
    else if (s.slot === 'avatar') moveFile(s.file, baseSlotFilename(fname, 'avatar'))
    else moveFile(s.file, motionFilename(s.slot, fname))
  }

  const now = Date.now()
  const meta: SkinMeta = { ...DEFAULT_META, id: skinId, name, createdAt: now, updatedAt: now, boundCharacters: [characterId] }
  atomicJson(manifestPath(skinId), meta)
  return skinId
}

/**
 * 把皮肤解析为「角色既有 CharacterVisual + assets」结构（渲染适配）。
 *
 * CharacterRenderer 通过 /api/characters/:id/visual 读取角色视觉；角色绑定皮肤
 * 时无需改动前端，只要视觉接口返回从皮肤解析的虚拟视觉即可让所有渲染点位
 * （列表卡片/预览/会话舞台）自动按皮肤加载。
 *
 * assetId 采用稳定语义 id：`skin:<skinId>:portrait` / `skin:<skinId>:avatar` /
 * `skin:<skinId>:<motion>`，把皮肤 id 编入 URL，保证切换皮肤后 URL 变化，
 * 不会被浏览器按旧 URL 的 immutable 缓存命中。
 */
export function skinToCharacterVisual(skin: Skin): {
  visual: CharacterVisual
  assets: CharacterAssetRef[]
} {
  const assets: CharacterAssetRef[] = []
  const mimeForFile = (filename: string): string => {
    const ext = extname(filename).toLowerCase()
    const map: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4',
    }
    return map[ext] || 'application/octet-stream'
  }
  const kindForFile = (filename: string): CharacterAssetRef['kind'] => {
    const ext = extname(filename).toLowerCase()
    return (['.mp4', '.gif', '.webp'].includes(ext) && ext !== '.png') ? 'video' : 'static'
  }
  const push = (assetId: string, filename: string) => {
    assets.push({ assetId, kind: kindForFile(filename), mime: mimeForFile(filename), filename })
  }

  let originalAssetId: string | undefined
  let avatarAssetId: string | undefined
  let portraitAssetId: string | undefined

  if (skin.portrait) { push(`skin:${skin.id}:portrait`, skin.portrait.filename); portraitAssetId = `skin:${skin.id}:portrait` }
  if (skin.avatar) { push(`skin:${skin.id}:avatar`, skin.avatar.filename); avatarAssetId = `skin:${skin.id}:avatar` }
  if (portraitAssetId) originalAssetId = portraitAssetId

  const motions: CharacterVisual['motions'] = {}
  for (const motion of SKIN_MOTIONS) {
    const entry = skin.motions[motion]
    if (!entry) continue
    const id = `skin:${skin.id}:${motion}`
    push(id, entry.filename)
    motions[motion] = { assetId: id, loop: motion !== 'success' && motion !== 'error' }
  }

  const visual: CharacterVisual = {
    schemaVersion: 1,
    defaultMotion: 'idle',
    originalAssetId,
    avatarAssetId,
    portraitAssetId,
    motions,
  }
  return { visual, assets }
}
