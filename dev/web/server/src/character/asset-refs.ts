import { getDb } from '../db/schema.js'

/**
 * Character asset reference registry: every durable owner of an asset
 * (revision, run, occurrence, player lease) pins it in character_asset_refs
 * so the GC and deletion guards can see who still needs the file.
 */

export function assetIdsFromVisual(visual: Record<string, unknown> | null): string[] {
  if (!visual) return []
  const ids = new Set<string>()
  const v = visual as {
    originalAssetId?: string
    avatarAssetId?: string
    portraitAssetId?: string
    motions?: Record<string, { assetId?: string }>
  }
  if (v.originalAssetId) ids.add(v.originalAssetId)
  if (v.avatarAssetId) ids.add(v.avatarAssetId)
  if (v.portraitAssetId) ids.add(v.portraitAssetId)
  for (const binding of Object.values(v.motions || {})) {
    if (binding?.assetId) ids.add(binding.assetId)
  }
  return [...ids]
}

export function registerAssetRefs(input: {
  ownerType: string
  ownerId: string
  characterId: string
  visual: Record<string, unknown> | null
  revisionId?: string
  retentionUntil?: number | null
}): void {
  const db = getDb()
  const now = Date.now()
  for (const assetId of assetIdsFromVisual(input.visual)) {
    db.prepare(`
      INSERT OR IGNORE INTO character_asset_refs
        (owner_type, owner_id, character_id, asset_id, revision_id, retention_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.ownerType, input.ownerId, input.characterId, assetId, input.revisionId || null, input.retentionUntil ?? null, now)
  }
}

/** Refresh a transient "player lease" so an asset in active use survives GC. */
export function touchPlayerLease(characterId: string, assetId: string, leaseMs: number): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(`
    INSERT INTO character_asset_refs
      (owner_type, owner_id, character_id, asset_id, revision_id, retention_until, created_at)
    VALUES ('player-lease', ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(owner_type, owner_id, asset_id)
    DO UPDATE SET retention_until = excluded.retention_until
  `).run(`lease_${characterId}_${assetId}`, characterId, assetId, now + leaseMs, now)
}

export function hasProtectingRef(characterId: string, assetId: string, now = Date.now()): boolean {
  const row = getDb().prepare(`
    SELECT 1 FROM character_asset_refs
    WHERE character_id = ? AND asset_id = ?
      AND (owner_type != 'player-lease' OR retention_until > ?)
    LIMIT 1
  `).get(characterId, assetId, now)
  return !!row
}
