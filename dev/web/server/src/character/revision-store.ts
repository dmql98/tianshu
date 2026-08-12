import { createHash, randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { getDb } from '../db/schema.js'
import { characterMetaStore, type CharacterRecord } from '../db/characterStore.js'
import { characterContentStore, characterDir } from './store.js'
import { registerAssetRefs } from './asset-refs.js'

export interface CharacterRevisionSnapshot {
  meta: CharacterRecord
  content: { soul: string; user: string; memory: string }
  visual: Record<string, unknown> | null
}

export interface CharacterRevisionRow {
  id: string
  character_id: string
  revision_no: number
  manifest_hash: string
  snapshot: string
  visual_manifest: string | null
  created_at: number
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function readVisual(characterId: string): Record<string, unknown> | null {
  const file = resolve(characterDir(characterId), 'visual', 'visual.json')
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

function makeSnapshot(characterId: string): CharacterRevisionSnapshot {
  const merged = characterMetaStore.getById(characterId)
  if (!merged) throw new Error(`Character "${characterId}" not found`)
  // 快照只保存角色真实配置（含 runPolicy），不保存双层派生来源字段。
  const { source: _source, readOnly: _readOnly, overridesBuiltin: _overrides, builtinVersion: _version, ...meta } = merged
  return { meta, content: characterContentStore.get(characterId), visual: readVisual(characterId) }
}

export const characterRevisionStore = {
  getDefinition(characterId: string) {
    return getDb().prepare('SELECT * FROM character_definitions WHERE id = ?').get(characterId) as
      | { id: string; current_revision_id: string | null; status: 'active' | 'archived'; created_at: number; updated_at: number }
      | undefined
  },

  getRevision(revisionId: string): CharacterRevisionRow | null {
    return getDb().prepare('SELECT * FROM character_revisions WHERE id = ?').get(revisionId) as CharacterRevisionRow | null
  },

  list(characterId: string): CharacterRevisionRow[] {
    return getDb().prepare(
      'SELECT * FROM character_revisions WHERE character_id = ? ORDER BY revision_no DESC',
    ).all(characterId) as CharacterRevisionRow[]
  },

  publish(characterId: string): CharacterRevisionRow {
    const snapshot = makeSnapshot(characterId)
    const serialized = stableJson(snapshot)
    const manifestHash = createHash('sha256').update(serialized).digest('hex')
    const db = getDb()
    return db.transaction(() => {
      const now = Date.now()
      const definition = this.getDefinition(characterId)
      if (!definition) {
        db.prepare(`
          INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
          VALUES (?, NULL, 'active', ?, ?)
        `).run(characterId, now, now)
      }
      const latest = db.prepare(
        'SELECT * FROM character_revisions WHERE character_id = ? ORDER BY revision_no DESC LIMIT 1',
      ).get(characterId) as CharacterRevisionRow | undefined
      if (latest?.manifest_hash === manifestHash) {
        db.prepare(
          "UPDATE character_definitions SET current_revision_id = ?, status = 'active', updated_at = ? WHERE id = ?",
        ).run(latest.id, now, characterId)
        return latest
      }
      const row: CharacterRevisionRow = {
        id: `crev_${randomUUID()}`,
        character_id: characterId,
        revision_no: (latest?.revision_no || 0) + 1,
        manifest_hash: manifestHash,
        snapshot: JSON.stringify(snapshot),
        visual_manifest: snapshot.visual ? JSON.stringify(snapshot.visual) : null,
        created_at: now,
      }
      db.prepare(`
        INSERT INTO character_revisions
          (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
        VALUES
          (@id, @character_id, @revision_no, @manifest_hash, @snapshot, @visual_manifest, @created_at)
      `).run(row)
      db.prepare(
        "UPDATE character_definitions SET current_revision_id = ?, status = 'active', updated_at = ? WHERE id = ?",
      ).run(row.id, now, characterId)
      const assetIds = new Set<string>()
      if (snapshot.visual) {
        const visual = snapshot.visual as {
          originalAssetId?: string
          avatarAssetId?: string
          portraitAssetId?: string
          motions?: Record<string, { assetId?: string }>
        }
        if (visual.originalAssetId) assetIds.add(visual.originalAssetId)
        if (visual.avatarAssetId) assetIds.add(visual.avatarAssetId)
        if (visual.portraitAssetId) assetIds.add(visual.portraitAssetId)
        for (const binding of Object.values(visual.motions || {})) {
          if (binding?.assetId) assetIds.add(binding.assetId)
        }
      }
      for (const assetId of assetIds) {
        db.prepare(`
          INSERT OR IGNORE INTO character_asset_refs
            (owner_type, owner_id, character_id, asset_id, revision_id, retention_until, created_at)
          VALUES ('revision', ?, ?, ?, ?, NULL, ?)
        `).run(row.id, characterId, assetId, row.id, now)
      }
      return row
    })()
  },

  ensureCurrent(characterId: string): CharacterRevisionRow {
    const definition = this.getDefinition(characterId)
    if (definition?.current_revision_id) {
      const current = this.getRevision(definition.current_revision_id)
      if (current) {
        // The revision snapshot is taken at publish time; the live character
        // definition/content may have changed since (edited via the file,
        // character_manager tool, or HTTP API). Recompute the hash and publish
        // a new revision when stale so follow_latest runs pick up the change
        // instead of forever pinning an old snapshot.
        const fresh = stableJson(makeSnapshot(characterId))
        const freshHash = createHash('sha256').update(fresh).digest('hex')
        if (current.manifest_hash === freshHash) return current
        return this.publish(characterId)
      }
    }
    return this.publish(characterId)
  },

  archive(characterId: string): boolean {
    return getDb().prepare(
      "UPDATE character_definitions SET status = 'archived', updated_at = ? WHERE id = ?",
    ).run(Date.now(), characterId).changes > 0
  },
}
