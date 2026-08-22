import { randomUUID } from 'crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'fs'
import { basename, extname, resolve } from 'path'
import { charactersRoot } from '../data-paths.js'
import { getDb } from '../db/schema.js'

export type CharacterMotion =
  | 'idle' | 'blink' | 'breathe' | 'listening' | 'thinking' | 'speaking'
  | 'toolCalling' | 'working' | 'success' | 'error' | 'happy' | 'touched'
  | 'wave' | 'walk' | 'jump' | 'sleep'
export type CharacterAssetKind =
  | 'static' | 'animated-image' | 'video' | 'sprite-sheet' | 'frame-sequence'
  | 'live2d' | 'spine' | 'rive'

export interface CharacterAssetRef {
  assetId: string
  kind: CharacterAssetKind
  mime: string
  filename: string
}

export interface CharacterMotionBinding {
  assetId: string
  loop?: boolean
  /** 动作素材的取景/缩放（与 avatarCrop 同构：x/y 为百分比原点，scale 为缩放）。 */
  crop?: { x: number; y: number; scale: number }
}

export interface CharacterVisual {
  schemaVersion: 1
  originalAssetId?: string
  avatarAssetId?: string
  portraitAssetId?: string
  avatarCrop?: { x: number; y: number; scale: number }
  portraitCrop?: { x: number; y: number; scale: number }
  defaultMotion: CharacterMotion
  motions: Partial<Record<CharacterMotion, CharacterMotionBinding>>
  stage?: Record<string, unknown>
}

const DEFAULT_VISUAL: CharacterVisual = {
  schemaVersion: 1,
  defaultMotion: 'idle',
  motions: {},
}

/**
 * 视觉目录：单层化后所有角色视觉都在 <dataDir>/characters/<id>/visual。
 */
function visualDir(characterId: string) {
  return resolve(charactersRoot(), characterId, 'visual')
}

/** 写入口：视觉落在用户层 <dataDir>/characters/<id>/visual（seed 保证角色目录存在）。 */
function ensureWritableVisual(characterId: string): string {
  return resolve(charactersRoot(), characterId, 'visual')
}

function manifestPath(characterId: string) {
  return resolve(visualDir(characterId), 'visual.json')
}
function assetDir(characterId: string) {
  return resolve(visualDir(characterId), 'assets')
}
function assetIndexPath(characterId: string) {
  return resolve(visualDir(characterId), 'assets.json')
}
function readAssetIndex(characterId: string): CharacterAssetRef[] {
  const file = assetIndexPath(characterId)
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return [] }
}
function atomicJson(file: string, value: unknown) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, file)
}

export const characterVisualStore = {
  get(characterId: string): CharacterVisual {
    const file = manifestPath(characterId)
    if (!existsSync(file)) return DEFAULT_VISUAL
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      return value?.schemaVersion === 1 ? { ...DEFAULT_VISUAL, ...value } : DEFAULT_VISUAL
    } catch {
      return DEFAULT_VISUAL
    }
  },

  save(characterId: string, visual: CharacterVisual): CharacterVisual {
    if (visual.schemaVersion !== 1) throw new Error('Unsupported character visual schema')
    const writableDir = ensureWritableVisual(characterId)
    const assets = new Set(readAssetIndex(characterId).map(asset => asset.assetId))
    const referenced = [
      visual.originalAssetId,
      visual.avatarAssetId,
      visual.portraitAssetId,
      ...Object.values(visual.motions || {}).map(binding => binding?.assetId),
    ].filter(Boolean) as string[]
    const missing = referenced.filter(assetId => !assets.has(assetId))
    if (missing.length) throw new Error(`Unknown character assets: ${missing.join(', ')}`)
    const normalized = {
      ...DEFAULT_VISUAL,
      ...visual,
      motions: visual.motions || {},
    }
    atomicJson(resolve(writableDir, 'visual.json'), normalized)
    return normalized
  },

  listAssets(characterId: string): CharacterAssetRef[] {
    return readAssetIndex(characterId)
  },

  addAsset(characterId: string, input: {
    bytes: Uint8Array
    filename: string
    mime: string
    kind?: CharacterAssetKind
  }): CharacterAssetRef {
    const id = `casset_${randomUUID()}`
    const safeExtension = extname(basename(input.filename)).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12)
    const filename = `${id}${safeExtension}`
    const writableDir = ensureWritableVisual(characterId)
    mkdirSync(resolve(writableDir, 'assets'), { recursive: true })
    writeFileSync(resolve(writableDir, 'assets', filename), input.bytes)
    const mime = input.mime || 'application/octet-stream'
    const kind = input.kind || (
      mime === 'image/gif' || mime === 'image/webp' ? 'animated-image'
        : mime.startsWith('video/') ? 'video'
          : 'static'
    )
    const asset: CharacterAssetRef = {
      assetId: id,
      kind,
      mime,
      filename,
    }
    const assets = [...readAssetIndex(characterId), asset]
    atomicJson(resolve(writableDir, 'assets.json'), assets)
    return asset
  },

  getAsset(characterId: string, assetId: string) {
    const asset = readAssetIndex(characterId).find(item => item.assetId === assetId)
    if (!asset) return null
    const file = resolve(assetDir(characterId), basename(asset.filename))
    if (!existsSync(file)) return null
    return { asset, file, size: statSync(file).size }
  },

  removeAsset(characterId: string, assetId: string): { ok: boolean; reason?: string } {
    const historicalRef = getDb().prepare(`
      SELECT owner_type, owner_id FROM character_asset_refs
      WHERE character_id = ? AND asset_id = ?
      LIMIT 1
    `).get(characterId, assetId) as { owner_type: string; owner_id: string } | undefined
    if (historicalRef) {
      return {
        ok: false,
        reason: `Asset is protected by ${historicalRef.owner_type} ${historicalRef.owner_id}`,
      }
    }
    const visual = this.get(characterId)
    const referenced = new Set([
      visual.originalAssetId,
      visual.avatarAssetId,
      visual.portraitAssetId,
      ...Object.values(visual.motions).map(binding => binding?.assetId),
    ])
    if (referenced.has(assetId)) return { ok: false, reason: 'Asset is referenced by the current visual manifest' }
    return this.forceRemoveAsset(characterId, assetId)
  },

  /** Delete the file and index entry without protection checks (GC only). */
  forceRemoveAsset(characterId: string, assetId: string): { ok: boolean; reason?: string } {
    const assets = readAssetIndex(characterId)
    const asset = assets.find(item => item.assetId === assetId)
    if (!asset) return { ok: false, reason: 'Asset not found' }
    rmSync(resolve(assetDir(characterId), basename(asset.filename)), { force: true })
    atomicJson(assetIndexPath(characterId), assets.filter(item => item.assetId !== assetId))
    return { ok: true }
  },

  /** Drop every asset file and reset the manifest (package replace). */
  clearAssets(characterId: string): void {
    const writableDir = ensureWritableVisual(characterId)
    const assets = readAssetIndex(characterId)
    for (const asset of assets) {
      rmSync(resolve(writableDir, 'assets', basename(asset.filename)), { force: true })
    }
    atomicJson(resolve(writableDir, 'assets.json'), [])
    atomicJson(resolve(writableDir, 'visual.json'), DEFAULT_VISUAL)
  },
}
