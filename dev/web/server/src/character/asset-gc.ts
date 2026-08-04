import { getDb } from '../db/schema.js'
import { characterVisualStore } from './visual-store.js'
import { assetIdsFromVisual, hasProtectingRef } from './asset-refs.js'

/**
 * Delayed asset GC: archived characters keep their visual assets for a
 * retention window; afterwards any asset without a protecting reference
 * (revision / run / occurrence / live player lease) is removed.
 */

export const ASSET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const PLAYER_LEASE_MS = 60 * 60 * 1000

let gcTimer: ReturnType<typeof setInterval> | null = null

export function startAssetGC(intervalSec = 3600) {
  if (gcTimer) return
  console.log('[asset-gc] Starting (every %ds)', intervalSec)
  gcTimer = setInterval(() => void runAssetGC(), intervalSec * 1000)
  void runAssetGC()
}

export function stopAssetGC() {
  if (gcTimer) {
    clearInterval(gcTimer)
    gcTimer = null
  }
}

export function runAssetGC(): { removed: number } {
  const now = Date.now()
  const archived = getDb().prepare(
    "SELECT id, updated_at FROM character_definitions WHERE status = 'archived'",
  ).all() as Array<{ id: string; updated_at: number }>

  let removed = 0
  for (const def of archived) {
    if (now - def.updated_at < ASSET_RETENTION_MS) continue
    const visual = characterVisualStore.get(def.id)
    const manifestRefs = new Set(assetIdsFromVisual(visual as unknown as Record<string, unknown>))
    for (const asset of characterVisualStore.listAssets(def.id)) {
      if (manifestRefs.has(asset.assetId)) continue
      if (hasProtectingRef(def.id, asset.assetId, now)) continue
      const result = characterVisualStore.forceRemoveAsset(def.id, asset.assetId)
      if (result.ok) {
        removed++
        console.log(`[asset-gc] removed ${asset.assetId} (${asset.filename}) of archived character ${def.id}`)
      }
    }
  }
  if (removed > 0) console.log(`[asset-gc] removed ${removed} assets`)
  return { removed }
}
